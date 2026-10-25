/**
 * 装载机仿真。
 *
 * 真车怎么开,这里就怎么算:
 *   · 钥匙 / 中位起动保护(换向开关不在 N 不让打火)/ 驻车制动
 *   · 液力变矩器:挂上档松开油门车也会"蠕行",停车要踩刹车;油门同时决定转速 → 泵流量 → 举升快慢
 *   · 换向 F-N-R、Ⅰ/Ⅱ档;高速直接换向会扣分(伤变速箱)
 *   · 铰接转向:方向盘 → 转向缸 → 前后车架折腰,原地打方向车头车尾一起摆
 *   · 工作装置是 Z 型反转六连杆,状态量就是举升缸和转斗缸的长度,铲斗角由机构解出来
 *   · 铲装:斗口迎着土走(往前插、或者在土里收斗)土才进斗,速度受插入阻力限制;
 *     斗底/斗背压到原状土就顶住(车走不动、溢流);斗满了再往前顶就是推土
 *   · 撒料:按斗底倾角算能兜住多少,翻过头就往外倒 —— 卸车就是这么卸的
 *   · 侧翻:重心(含斗里的土、动臂高度)按离心力 + 坡度投影到"前轮两点 + 后桥摆动中心"的三角形里
 */
import * as THREE from 'three';
import { VehicleSim, articulatedStep } from './base.js';
import { LoaderModel, LOADER, BUCKET_PROFILE as BP, MOUTH, bucketCavity } from './loader-model.js';
import { LOADER_LINKAGE as LK, solveLoader, loaderLiftAngle, loaderTiltLength } from './loader-kin.js';
import { clamp } from '../linkage.js';

const HY = {
  liftUp: 0.15, // m/s 举升缸伸(满油门举升 ≈ 5.5 s)
  liftDown: 0.24, //     下降(≈ 3.4 s)
  tiltIn: 0.27, //       收斗(转斗缸伸)
  tiltOut: 0.36, //      卸料(≈ 1.5 s)
  steer: 0.5, // rad/s 铰接角速度上限
};
const SPEED = { 1: 3.4, 2: 7.2 }; // m/s:Ⅰ档 12 km/h、Ⅱ档 26 km/h
const CREEP = 0.55; // 挂档怠速蠕行 ≈ 2 km/h
const CUT_LOOSE = 1.25; // m³/s 插入松散料堆时进斗的速率上限(一斗要顶 2~3 秒)
const CUT_FIRM = 0.3; //  原状土
const PUSH_LIMIT = 0.07; // 斗底压进土里允许的深度(再深就顶住)
const MASS = { rear: 9800, front: 4200, bucket: 1500, soil: 1700 };

// 碰撞采样点(铲斗设计系):外轮廓 + 齿尖,左中右三列
const BUCKET_SAMPLES = [];
for (const [x, y] of [...BP.outer, BP.tip]) for (const z of [-1.45, 0, 1.45]) BUCKET_SAMPLES.push([x, y, z]);
const OUTLINE = [...BP.outer, BP.tip];
const CAVITY = bucketCavity(0.03);

export class LoaderSim extends VehicleSim {
  constructor(model, terrain) {
    super(model, terrain, { kind: 'loader', idleRpm: 750, maxRpm: 2200, crankTime: 1.0, hours: 2318.2 });
    this.dir = 0; // -1 R | 0 N | 1 F
    this.gear = 1;
    this.st = { x: 0, z: 0, heading: 0, gamma: 0 };
    this.liftL = LK.liftMin + 0.005;
    this.tiltL = loaderTiltLength(LK, LK.alphaMin, 0.05);
    this.alpha = LK.alphaMin;
    this.beta = 0;
    this.accel = 0;
    this.brake = 0;
    this.axleRoll = 0;
    this.capacity = LOADER.capacity;
    this.digging = false;
    this.spilling = false;
    this.slip = 0;
    this.yawRate = 0;
    this.onSpill = null;
    this.controls = { steer: 0, lift: 0, tilt: 0, accel: 0, brake: 0, dir: 0 };
    this._inv = new THREE.Matrix4();
    this._edgePrev = new THREE.Vector3();
    this._edge = new THREE.Vector3();
    this._hasPrev = false;
    this._v = new THREE.Vector3();
    this._w = new THREE.Vector3();
    this._pts = [];
    this.resetMotion();
    this.syncTerrain(true);
  }

  // ── 操纵 ──────────────────────────────────────────────────────────────
  startBlockReason() {
    if (this.dir !== 0) return { text: '起动机不转 —— 换向开关不在空挡', why: '中位起动保护:换向开关必须在 N(空挡)才能打火,防止一着车就窜出去。按 N。' };
    return null;
  }
  setDir(d) {
    if (d === this.dir) return;
    if (this.dir !== 0 && d !== 0 && d !== this.dir && Math.abs(this.speed) > 1.6) this.violate('ldShuttle', 4);
    this.dir = d;
    this.emit('dir', d);
  }
  toggleGear() {
    this.gear = this.gear === 1 ? 2 : 1;
    this.emit('gear', this.gear);
  }
  resetMotion() {
    this.st.x = this.position.x;
    this.st.z = this.position.z;
    this.st.heading = this.heading;
    this.st.gamma = 0;
    this.speed = 0;
    this._hasPrev = false;
  }
  /** 收车姿态:铲斗平放落地 */
  parkPose() {
    this.liftL = LK.liftMin + 0.004;
    this.tiltL = loaderTiltLength(LK, LK.alphaMin, 0.0);
  }
  /** 运输姿态:斗底离地 ~40 cm,铲斗收到底 */
  carryPose() {
    this.liftL = LK.liftMin + 0.12;
    const a = loaderLiftAngle(LK, this.liftL);
    this.tiltL = loaderTiltLength(LK, a, 0.6) ?? LK.tiltMax;
  }
  placeAt(x, z, heading = 0) {
    this.position.set(x, 0, z);
    this.heading = heading;
    this.st.gamma = 0;
    super.placeAt(x, z, heading);
  }
  resetForScenario() {
    this.startEngineNow();
    this.parkBrake = true;
    this.dir = 0;
    this.gear = 1;
    this.bucketLoad = 0;
    this.coolant = 75;
    this.overturned = false;
    this.carryPose();
  }

  // ── 主循环 ────────────────────────────────────────────────────────────
  update(dt, raw) {
    this.time += dt;
    const live = this.running && !this.overturned;
    const accel = live ? Math.max(0, raw.leftY) : 0;
    const brake = Math.max(0, -raw.leftY);
    const steer = live ? raw.leftX : 0;
    const liftCmd = live ? -raw.rightY : 0;
    const tiltCmd = live ? -raw.rightX : 0;
    this.accel = accel;
    this.brake = brake;
    this.controls = { steer: raw.leftX, lift: raw.rightY, tilt: raw.rightX, accel: Math.max(0, raw.leftY), brake, dir: this.dir };
    this.cmds = { boom: liftCmd, bucket: tiltCmd, swing: 0, trackL: 0, trackR: 0 };

    // 发动机:油门踏板直接给转速
    const cfg = this.cfg;
    const target = cfg.idleRpm + accel * (cfg.maxRpm - cfg.idleRpm);
    this._updateEngine(dt, target, this.load);
    const rpmK = this.running ? clamp(this.rpm / cfg.maxRpm, 0, 1) : 0;
    const flow = 0.5 + 0.5 * rpmK; // 齿轮泵:流量跟转速走;怠速也能动,只是慢一半
    let relief = 0;
    let activity = 0;

    // ── 工作装置:两组油缸各自按流量伸缩 ──
    const prevLift = this.liftL;
    const prevTilt = this.tiltL;
    const body0 = live && (Math.abs(liftCmd) > 0.02 || Math.abs(tiltCmd) > 0.02) ? this._contact().bodyMax : 0;
    if (live) {
      if (Math.abs(liftCmd) > 0.02) {
        const v = liftCmd > 0 ? HY.liftUp * flow : HY.liftDown * (0.6 + 0.4 * flow);
        const nl = clamp(this.liftL + liftCmd * v * dt, LK.liftMin, LK.liftMax);
        if (nl === this.liftL) relief = Math.max(relief, Math.abs(liftCmd));
        this.liftL = nl;
      }
      if (Math.abs(tiltCmd) > 0.02) {
        const v = tiltCmd > 0 ? HY.tiltIn * flow : HY.tiltOut * flow;
        const nt = clamp(this.tiltL + tiltCmd * v * dt, LK.tiltMin, LK.tiltMax);
        if (nt === this.tiltL) relief = Math.max(relief, Math.abs(tiltCmd));
        this.tiltL = nt;
      }
    }
    if (this.liftL !== prevLift || this.tiltL !== prevTilt) {
      if (!this._solvePose()) {
        this.liftL = prevLift;
        this.tiltL = prevTilt;
        this._solvePose();
      }
      // 斗底/斗背压进土里太深 → 顶住
      const c = this._contact();
      if (c.bodyMax > PUSH_LIMIT && c.bodyMax > body0 + 1e-4 && !this._into()) {
        this.liftL = prevLift;
        this.tiltL = prevTilt;
        this._solvePose();
        relief = Math.max(relief, 0.8);
      }
      activity += Math.abs(this.liftL - prevLift) / dt + Math.abs(this.tiltL - prevTilt) / dt;
    }

    // ── 行驶:变矩器 + 制动 ──
    const vmax = SPEED[this.gear];
    let want = 0;
    let drive = false;
    if (live && this.dir !== 0 && brake < 0.05) {
      drive = true;
      want = this.dir * (CREEP + accel * (vmax - CREEP) * (0.4 + 0.6 * rpmK));
    }
    if (this.parkBrake && drive && accel > 0.3) {
      this.violate('ldParkDrive', 8);
      this.hint('park', '车走不动 —— 驻车制动还拉着', '起步前先松开驻车制动(按 Q)。带着驻车制动硬走会烧坏制动片。');
    }
    let acc;
    if (this.parkBrake) acc = -Math.sign(this.speed) * 6;
    else if (brake > 0.05) acc = -Math.sign(this.speed) * (1.0 + brake * 5);
    else if (drive) acc = clamp((want - this.speed) * 1.6, -2.5, 1.6 * (0.5 + 0.5 * accel));
    else acc = -Math.sign(this.speed) * 0.5;
    // 坡道:重力分量
    acc -= Math.sin(this.pitch) * 9.8 * 0.6;
    const prevSpeed = this.speed;
    this.speed += acc * dt;
    if ((this.parkBrake || brake > 0.05 || !drive) && Math.sign(this.speed) !== Math.sign(prevSpeed) && prevSpeed !== 0) this.speed = 0;
    if (Math.abs(this.speed) < 0.01 && !drive) this.speed = 0;
    // 下坡驻车也溜不动
    if (this.parkBrake && Math.abs(this.speed) < 0.05) this.speed = 0;

    // 铰接转向
    const dGammaWant = -steer * HY.steer * (0.45 + 0.55 * rpmK);
    let dGamma = dGammaWant;
    const g1 = this.st.gamma + dGamma * dt;
    if (Math.abs(g1) > LOADER.gammaMax) {
      dGamma = (Math.sign(g1) * LOADER.gammaMax - this.st.gamma) / dt;
      if (Math.abs(steer) > 0.2) relief = Math.max(relief, 0.6);
    }

    const save = { ...this.st };
    const savePos = this.position.clone();
    const contactBefore = this._contact();
    const step = articulatedStep(this.st, this.speed, dGamma, LOADER.lf, LOADER.lr, dt);
    this.yawRate = step.dHeading;
    this.position.x = this.st.x;
    this.position.z = this.st.z;
    this.heading = this.st.heading;
    this.syncTerrain(false, dt);
    // 铲斗插进料堆:插入阻力限速;斗底顶住原状土 → 车走不动
    const c = this._contact();
    this.slip = 0;
    if (c.vol > contactBefore.vol + 1e-5) {
      const into = this._into();
      if (!into || this.bucketLoad >= this.capacity * 1.15) {
        // 推土:斗满了 / 斗背顶着走,土被推着跑;原状土顶不动
        if (c.firm > 0.5 && c.bodyMax > PUSH_LIMIT) {
          this._revert(save, savePos);
          this.speed = 0;
          this.slip = 1;
          relief = Math.max(relief, 0.7);
          this.hint('firm', '铲斗顶住地面了,车走不动', '装载机不是挖掘机 —— 铲斗只能插松散料堆,原状土要先用挖掘机或推土机松动。斗底贴地、斗齿略向下即可。');
        } else this._bulldoze(c, dt);
      } else {
        const rate = (c.firm > 0.5 ? CUT_FIRM : CUT_LOOSE) * dt;
        const add = c.vol - contactBefore.vol;
        if (add > rate) {
          // 插不进去那么快:车速被顶下来(轮胎打滑)
          const k = clamp(rate / add, 0.05, 1);
          this.speed *= 0.5 + 0.5 * k;
          this.slip = 1 - k;
          if (k < 0.25) relief = Math.max(relief, 0.5);
        }
      }
    }
    activity += Math.abs(this.speed) * 0.25 + Math.abs(dGamma) * 0.5;
    this.model.roll(step.front, step.rear * (1 + this.slip * 0.8));

    this._solvePose();
    this._dig(dt);
    this._spill(dt);
    this._stability(dt);
    this._collide(save, savePos);

    const wasTravelling = this.travelling;
    this.travelling = Math.abs(this.speed) > 0.05;
    if (this.travelling && !wasTravelling) {
      if (this.time - this.lastHorn > 8 && this.time - (this.lastTravelStop ?? -99) > 15) this.emit('noHorn');
      this.emit('travelStart');
    }
    if (!this.travelling && wasTravelling) this.lastTravelStop = this.time;
    // 运料时动臂太高:重心高、挡视线
    if (this.bucketLoad > 0.6 && Math.abs(this.speed) > 1.8 && this.lin && this.lin.B.y > 1.6) {
      this.violate('ldHighCarry', 8);
    }
    this.relief += ((relief > 0.3 ? 1 : 0) - this.relief) * Math.min(1, dt * 8);
    this.load = clamp(activity * 0.25 + (this.digging ? 0.5 : 0) + this.relief * 0.4 + accel * 0.3 + this.slip * 0.4, 0, 1);
    this.moving = activity > 0.05;
  }

  _revert(save, savePos) {
    Object.assign(this.st, save);
    this.position.copy(savePos);
    this.heading = save.heading;
    this.syncTerrain(true);
  }

  _solvePose() {
    const a = loaderLiftAngle(LK, this.liftL);
    const s = solveLoader(LK, a, this.tiltL);
    if (!s) return false;
    this.alpha = a;
    this.beta = s.beta;
    this.lin = this.model.setPose({ alpha: a, Lt: this.tiltL, gamma: this.st.gamma, axleRoll: this.axleRoll });
    this.model.root.updateMatrixWorld(true);
    return true;
  }

  // ── 贴地 ──────────────────────────────────────────────────────────────
  syncTerrain(snap, dt = 0.016) {
    const T = this.terrain;
    const h = this.heading;
    const g = this.st.gamma;
    const ch = Math.cos(h);
    const sh = Math.sin(h);
    const W = (lx, lz) => [this.position.x + lx * ch + lz * sh, this.position.z - lx * sh + lz * ch];
    const ht = (lx, lz) => {
      const [x, z] = W(lx, lz);
      return T.heightAt(x, z);
    };
    const tw = LOADER.track / 2;
    // 后桥(摆动):取左右平均;前桥刚性:左右各自
    const rL = ht(-LOADER.lr, -tw);
    const rR = ht(-LOADER.lr, tw);
    const fx = LOADER.lf * Math.cos(g);
    const fz = -LOADER.lf * Math.sin(g);
    const fL = ht(fx - Math.sin(g) * tw * -1, fz + Math.cos(g) * -tw);
    const fR = ht(fx + Math.sin(g) * tw, fz + Math.cos(g) * tw);
    const hr = (rL + rR) / 2;
    const hf = (fL + fR) / 2;
    const span = LOADER.lr + fx;
    const pitch = Math.atan2(hf - hr, span);
    const roll = Math.atan2(fL - fR, LOADER.track);
    const y = hr + (hf - hr) * (LOADER.lr / span);
    // 后桥相对车身的摆角
    const axle = clamp(Math.atan2(rL - rR, LOADER.track) - roll, -0.21, 0.21);
    const k = snap ? 1 : Math.min(1, dt * 8);
    this.position.y += (y - this.position.y) * k;
    this.pitch += (pitch - this.pitch) * k;
    this.roll += (roll - this.roll) * k;
    this.axleRoll += (axle - this.axleRoll) * k;
    this._applyRoot((r) => {
      if (this.tilt.angle > 0) {
        // 侧翻:绕一侧轮胎接地线转
        const side = this.tilt.side;
        const piv = new THREE.Vector3(0, 0, side * tw);
        const m = new THREE.Matrix4()
          .makeTranslation(piv.x, piv.y, piv.z)
          .multiply(new THREE.Matrix4().makeRotationX(side * this.tilt.angle))
          .multiply(new THREE.Matrix4().makeTranslation(-piv.x, -piv.y, -piv.z));
        const base = new THREE.Matrix4().compose(r.position, r.quaternion, new THREE.Vector3(1, 1, 1)).multiply(m);
        base.decompose(r.position, r.quaternion, new THREE.Vector3());
      }
    });
    this._solvePose();
  }

  // ── 铲斗与土 ──────────────────────────────────────────────────────────

  /**
   * 铲斗外轮廓扫到的土。全部在前车架的竖直平面里算(和挖掘机一样):
   * 地形格子 → 前车架局部 → 这一列 x 上铲斗轮廓的最低点 / 斗腔范围。
   */
  _contact(cells = null) {
    const T = this.terrain;
    const fr = this.model.front;
    fr.updateMatrixWorld(true);
    this._inv.copy(fr.matrixWorld).invert();
    const s = this.lin;
    if (!s) return { vol: 0, bodyMax: 0, firm: 0 };
    const cb = Math.cos(s.beta);
    const sb = Math.sin(s.beta);
    const toFF = (x, y) => [s.B.x + x * cb - y * sb, s.B.y + x * sb + y * cb];
    const poly = (this._poly ||= OUTLINE.map(() => [0, 0]));
    let x0 = 1e9;
    let x1 = -1e9;
    for (let i = 0; i < OUTLINE.length; i++) {
      const p = toFF(OUTLINE[i][0], OUTLINE[i][1]);
      poly[i][0] = p[0];
      poly[i][1] = p[1];
      x0 = Math.min(x0, p[0]);
      x1 = Math.max(x1, p[0]);
    }
    // 包围盒(世界)
    const hw = LOADER.bucketW / 2 - 0.03;
    let wx0 = 1e9;
    let wx1 = -1e9;
    let wz0 = 1e9;
    let wz1 = -1e9;
    const v = this._v;
    for (const x of [x0, x1]) {
      for (const z of [-hw, hw]) {
        v.set(x, 0, z).applyMatrix4(fr.matrixWorld);
        wx0 = Math.min(wx0, v.x);
        wx1 = Math.max(wx1, v.x);
        wz0 = Math.min(wz0, v.z);
        wz1 = Math.max(wz1, v.z);
      }
    }
    const i0 = clamp(Math.ceil(T.gx(wx0)), 0, T.N);
    const i1 = clamp(Math.floor(T.gx(wx1)), 0, T.N);
    const j0 = clamp(Math.ceil(T.gz(wz0)), 0, T.N);
    const j1 = clamp(Math.floor(T.gz(wz1)), 0, T.N);
    this._bbox = { i0, j0, i1, j1 };
    const e = this._inv.elements;
    const H = T.heights;
    const cellA = T.cell * T.cell;
    const np = poly.length;
    // 进不进斗不看轮廓哪条边先碰土,而看铲斗是不是迎着斗口在走(_into):
    // 装载机是水平往料堆里插的,土从斗口横着进来
    let vol = 0;
    let bodyMax = 0;
    let firm = 0;
    let n = 0;
    for (let j = j0; j <= j1; j++) {
      const wz = T.wz(j);
      for (let i = i0; i <= i1; i++) {
        const k = T.idx(i, j);
        const wx = T.wx(i);
        const wy = H[k];
        const px = e[0] * wx + e[4] * wy + e[8] * wz + e[12];
        const py = e[1] * wx + e[5] * wy + e[9] * wz + e[13];
        const pz = e[2] * wx + e[6] * wy + e[10] * wz + e[14];
        if (pz < -hw || pz > hw || px < x0 || px > x1) continue;
        let yLow = 1e9;
        let yHigh = -1e9;
        for (let a = 0; a < np; a++) {
          const p0 = poly[a];
          const p1 = poly[(a + 1) % np];
          if ((p0[0] - px) * (p1[0] - px) > 0 || p0[0] === p1[0]) continue;
          const t = (px - p0[0]) / (p1[0] - p0[0]);
          const y = p0[1] + (p1[1] - p0[1]) * t;
          if (y < yLow) yLow = y;
          if (y > yHigh) yHigh = y;
        }
        if (yLow > 1e8) continue;
        const d = Math.min(py, yHigh) - yLow;
        if (d <= 0) continue;
        vol += d * cellA;
        bodyMax = Math.max(bodyMax, py - yLow);
        firm += 1 - T.disturbed[k];
        n++;
        if (cells) cells.push(k, d, 0, yLow);
      }
    }
    return { vol, bodyMax, firm: n ? firm / n : 0, n };
  }

  /** 铲斗是不是迎着斗口在走(往前插 / 在土里收斗) */
  _into() {
    const tip = this.model.getTipWorld(this._edge);
    if (!this._hasPrev) return false;
    const vx = tip.x - this._edgePrev.x;
    const vy = tip.y - this._edgePrev.y;
    const vz = tip.z - this._edgePrev.z;
    // 斗口法线(世界)
    const n = this._mouthWorld();
    const L = Math.hypot(vx, vy, vz);
    if (L < 1e-5) return false;
    return (vx * n.x + vy * n.y + vz * n.z) / L > 0.2;
  }

  _mouthWorld() {
    const b = this.model.bucket;
    const n = (this._n ||= new THREE.Vector3());
    n.set(MOUTH.n[0], MOUTH.n[1], 0).transformDirection(b.matrixWorld);
    return n;
  }

  /** 进斗:斗腔扫过的土按速率上限搬进斗里 */
  _dig(dt) {
    const T = this.terrain;
    const tip = this.model.getTipWorld(this._w);
    const cells = (this._cells ||= []);
    cells.length = 0;
    this.digging = false;
    const into = this._into();
    const room = this.capacity * 1.18 - this.bucketLoad;
    if (into && room > 0) {
      const c = this._contact(cells);
      if (c.vol > 1e-5) {
        const rate = (c.firm > 0.5 ? CUT_FIRM : CUT_LOOSE) * dt;
        const take = Math.min(c.vol, rate, room);
        const k = take / c.vol;
        const cellA = T.cell * T.cell;
        let got = 0;
        for (let i = 0; i < cells.length; i += 4) {
          const d = cells[i + 1] * k;
          T.heights[cells[i]] -= d;
          T.disturbed[cells[i]] = Math.max(T.disturbed[cells[i]], 0.7);
          got += d * cellA;
        }
        this.bucketLoad += got;
        this.digging = got > 1e-4;
        const B = this._bbox;
        T._mark(B.i0, B.j0, B.i1, B.j1);
        T._relax(B.i0 - 3, B.j0 - 3, B.i1 + 3, B.j1 + 3, 3);
      }
    }
    this._edgePrev.copy(tip);
    this._hasPrev = true;
    this.terrain.flush();
    this.model.setSoil(this.bucketLoad / this.capacity);
  }

  /** 推土:被斗背推着走的土堆到斗前 */
  _bulldoze(c, dt) {
    const T = this.terrain;
    const cells = (this._cells2 ||= []);
    cells.length = 0;
    this._contact(cells);
    const cellA = T.cell * T.cell;
    let moved = 0;
    for (let i = 0; i < cells.length; i += 4) {
      const d = Math.max(0, cells[i + 1] - PUSH_LIMIT * 0.3);
      if (d <= 0) continue;
      T.heights[cells[i]] -= d;
      moved += d * cellA;
    }
    if (moved > 0) {
      const tip = this.model.getTipWorld(this._w);
      const h = this.heading + this.st.gamma;
      T.deposit(tip.x + Math.cos(h) * 0.6 * Math.sign(this.speed || 1), tip.z - Math.sin(h) * 0.6 * Math.sign(this.speed || 1), moved, 1.2, true);
      const B = this._bbox;
      T._mark(B.i0, B.j0, B.i1, B.j1);
    }
    this.speed *= 0.97;
  }

  /** 撒料:斗底前倾到兜不住的程度,超出的部分从刃口倒出去 */
  _spill(dt) {
    this.spilling = false;
    if (this.bucketLoad <= 1e-4) return;
    // 斗口还埋在料堆里的时候撒不出去
    const lip = this.model.bucketLocalToWorld(BP.edge[0], BP.edge[1] + 0.1, 0, this._w);
    if (this.terrain.heightAt(lip.x, lip.z) > lip.y) return;
    // 斗底在世界里的倾角:正 = 刃口比斗跟低(往外倒)
    const b = this.model.bucket;
    const d = this._v.set(1, 0, 0).transformDirection(b.matrixWorld);
    const down = Math.asin(clamp(-d.y, -1, 1));
    let keep;
    if (down < -0.2) keep = 1.25;
    else if (down < 0) keep = 1.25 - ((down + 0.2) / 0.2) * 0.25;
    else if (down < 0.42) keep = 1.0 - (down / 0.42) * 0.65;
    else keep = Math.max(0, 0.35 - ((down - 0.42) / 0.35) * 0.35);
    const cap = keep * this.capacity;
    if (this.bucketLoad > cap) {
      const out = Math.min(this.bucketLoad - cap, (0.5 + (this.bucketLoad - cap) * 2.5) * dt);
      this.bucketLoad -= out;
      this.spilling = true;
      // 从刃口沿宽度随机撒
      const z = (Math.random() - 0.5) * (LOADER.bucketW - 0.4);
      const p = this.model.bucketLocalToWorld(BP.edge[0] + 0.05, BP.edge[1] + 0.05, z, this._w).clone();
      const vel = new THREE.Vector3(Math.cos(this.heading + this.st.gamma), 0, -Math.sin(this.heading + this.st.gamma)).multiplyScalar(this.speed + 0.4);
      if (this.onSpill) this.onSpill(p, out, vel);
      else this.terrain.deposit(p.x, p.z, out);
      this.model.setSoil(this.bucketLoad / this.capacity);
    }
  }

  // ── 稳定性(侧翻) ────────────────────────────────────────────────────
  _stability(dt) {
    const s = this.lin;
    if (!s) return;
    const g = this.st.gamma;
    const cg = Math.cos(g);
    const sg = Math.sin(g);
    const ff = (x, y, z) => [x * cg + z * sg, y, -x * sg + z * cg]; // 前车架 → 后车架(root)
    let m = 0;
    let mx = 0;
    let my = 0;
    let mz = 0;
    const addM = (mass, [x, y, z]) => {
      m += mass;
      mx += mass * x;
      my += mass * y;
      mz += mass * z;
    };
    addM(MASS.rear, [-1.45, 1.15, 0]);
    addM(MASS.front, ff(1.1, 1.0, 0));
    const cb = Math.cos(s.beta);
    const sb = Math.sin(s.beta);
    const bc = [s.B.x + 0.75 * cb - 0.15 * sb, s.B.y + 0.75 * sb + 0.15 * cb];
    addM(MASS.bucket + this.bucketLoad * MASS.soil, ff(bc[0], bc[1], 0));
    const cx = mx / m;
    const cy = my / m;
    const cz = mz / m;
    // 等效重力:坡度 + 转弯离心(向心加速度 = v·ω,朝弯道内侧)
    const aLat = this.speed * this.yawRate; // 正 = 向左转 → 离心力朝右(+z)
    const gx = Math.sin(this.pitch) * 9.8;
    const gz = -Math.sin(this.roll) * 9.8 + aLat;
    const gy = 9.8;
    const px = cx - (gx / gy) * cy * 0;
    const pz = cz + (gz / gy) * cy;
    // 支撑三角形:前轮两个接地点 + 后桥摆动中心
    const tw = LOADER.track / 2;
    const FL = ff(LOADER.lf, 0, -tw);
    const FR = ff(LOADER.lf, 0, tw);
    const RP = [-LOADER.lr, 0, 0];
    // 点在有向边左侧为正((x, z) 平面)
    const edge = (A, B) => {
      const ex = B[0] - A[0];
      const ez = B[2] - A[2];
      return (ex * (pz - A[2]) - ez * (px - A[0])) / Math.hypot(ex, ez);
    };
    const orient = Math.sign((RP[0] - FL[0]) * (FR[2] - FL[2]) - (RP[2] - FL[2]) * (FR[0] - FL[0])) || 1;
    const d1 = edge(FL, RP) * orient;
    const d2 = edge(RP, FR) * orient;
    const d3 = edge(FR, FL) * orient;
    const margin = Math.min(d1, d2, d3);
    this.stability = clamp(margin / 0.6, -1, 1);
    const T = this.tilt;
    const side = pz > 0 ? 1 : -1;
    if (margin < 0 && Math.min(d1, d2) === margin) {
      if (T.kind !== 'tip') {
        T.kind = 'tip';
        T.side = side;
        T.vel = 0;
        this.violate('ldTip', 8);
      }
      T.vel += (-margin * 4 + T.angle * 2) * dt;
    } else if (T.kind === 'tip') {
      T.vel += (-0.8 - margin) * dt * 3;
    }
    if (T.kind === 'tip') {
      T.angle += T.vel * dt;
      if (T.angle <= 0) {
        T.angle = 0;
        T.vel = 0;
        T.kind = null;
      } else if (T.angle > 0.5 && !this.overturned) {
        this.overturned = true;
        this.violate('ldOverturn', 0);
      }
      if (this.overturned) T.angle = Math.min(T.angle + dt * 0.9, 1.45);
      this.syncTerrain(true);
    }
  }

  // ── 碰撞 ──────────────────────────────────────────────────────────────
  _collide(save, savePos) {
    if (!this.obstacles.length) return;
    const b = this.model.bucket;
    const pts = this._pts;
    pts.length = 0;
    let i = 0;
    for (const [x, y, z] of BUCKET_SAMPLES) {
      pts.push((this['_bp' + i] ||= new THREE.Vector3()).set(x, y, z).applyMatrix4(b.matrixWorld));
      i++;
    }
    let hit = this.hitTest(pts, 'bucket');
    if (!hit && (this.travelling || Math.abs(this.yawRate) > 0.01)) {
      // 车身四角 + 配重尾部(转向时车尾会甩出去)
      const r = this.model.root.matrixWorld;
      const f = this.model.front.matrixWorld;
      const body = [
        [r, -3.4, 0.9, 1.05],
        [r, -3.4, 0.9, -1.05],
        [r, -3.4, 0.9, 0],
        [r, -1.6, 0.8, 1.42],
        [r, -1.6, 0.8, -1.42],
        [f, 1.6, 0.8, 1.42],
        [f, 1.6, 0.8, -1.42],
        [f, 2.4, 1.2, 0],
      ];
      pts.length = 0;
      for (const [mm, x, y, z] of body) pts.push(new THREE.Vector3(x, y, z).applyMatrix4(mm));
      hit = this.hitTest(pts, 'chassis');
    }
    if (hit && hit.kind === 'block') {
      const impact = Math.abs(this.speed) + 0.4;
      this._revert(save, savePos);
      this.speed = 0;
      this.emit('hit', { obstacle: hit.obstacle, impact }, 1.2);
    } else if (hit && hit.kind === 'knock') {
      this.emit('knock', { obstacle: hit.obstacle });
    }
  }

  // ── 给界面 ────────────────────────────────────────────────────────────
  status() {
    return {
      ...this.baseStatus(),
      dir: this.dir,
      gear: this.gear,
      braking: this.brake > 0.05 || this.parkBrake,
      warn: this.overturned ? '整机倾翻' : this.tilt.kind === 'tip' ? '侧翻危险!' : null,
    };
  }

  /** 斗齿离地、动臂铰点高度等(HUD 用) */
  readout() {
    const tip = this.model.getTipWorld(this._w);
    const ground = this.terrain.heightAt(tip.x, tip.z);
    return {
      tipAbove: tip.y - ground,
      hingeH: this.lin ? this.lin.B.y : 0,
      bucketDeg: (this.beta * 180) / Math.PI,
      gammaDeg: (this.st.gamma * 180) / Math.PI,
    };
  }

  soundParams() {
    return {
      rpm: this.rpm,
      load: this.load,
      hyd: clamp(Math.abs(this.cmds.boom || 0) + Math.abs(this.cmds.bucket || 0), 0, 1),
      relief: this.relief,
      travel: clamp(Math.abs(this.speed) / 4, 0, 1) * 0.35,
      clank: false,
      crank: this.engine === 'crank',
      running: this.running,
      horn: this.horn,
      travelAlarm: this.dir === -1 && this.running,
      warn: this.tilt.kind === 'tip',
    };
  }
}

export function createLoader(M, terrain) {
  const model = new LoaderModel(M);
  const sim = new LoaderSim(model, terrain);
  return { model, sim };
}
