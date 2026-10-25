/**
 * 单钢轮振动压路机仿真。
 *
 *   · 静液压行走:行走手柄推多少走多快,松手留在原位(不会自己回中);中位有卡槽 = 停车制动
 *     所以换向必须"拉回中位 → 停一下 → 再往反方向推",一把拉过去会卡在中位
 *   · Ⅰ档作业(≤ 6 km/h,可振动)/ Ⅱ档行驶(≤ 11 km/h,不许振动)
 *   · 振动:手柄上的按钮开关;高/低振幅;振动频率跟发动机转速走 —— 低转速振动机器会"跳"
 *   · 压实:钢轮压过的每一格记一遍(一次连续经过只算一遍),压实度按遍数指数逼近 1;
 *     振动 + 低速压得实,静压 / 快速压得虚;压实的同时土面沉降、颜色变浅
 *   · 规矩:原地振动(会振出坑)、振动时换向、振动碾压太快、靠近填方边缘、侧倾
 */
import * as THREE from 'three';
import { VehicleSim, articulatedStep } from './base.js';
import { RollerModel, ROLLER } from './roller-model.js';
import { clamp } from '../linkage.js';

const SPEED = { 1: 1.7, 2: 3.1 }; // m/s
const RPM = [900, 1700, 2200]; // 油门开关三档:怠速 / 中速 / 作业
const VIBE_K = { high: 0.48, low: 0.36, static: 0.12 }; // 每遍压实度增量系数
const SETTLE = 0.06; // 松土压到 100% 的沉降(米)

export class RollerSim extends VehicleSim {
  constructor(model, terrain) {
    super(model, terrain, { kind: 'roller', idleRpm: 900, maxRpm: 2200, crankTime: 1.1, hours: 1544.8 });
    this.st = { x: 0, z: 0, heading: 0, gamma: 0 };
    this.lever = 0; // -1..1 行走手柄
    this._detent = false;
    this.range = 1;
    this.throttleStep = 0;
    this.vibe = false; // 振动开关
    this.amp = 'high';
    this.vibeLive = false; // 实际在振
    this.vibeHz = 0;
    this.shake = 0;
    this.yawRate = 0;
    this.staticT = 0;
    this.controls = { steer: 0, lever: 0, vibe: false };
    const N = terrain.stride * terrain.stride;
    this.comp = terrain.compact; // 压实度 0~1(存在地形上,换场地时跟着清零)
    this.passes = new Uint8Array(N); // 遍数
    this.lastFrame = new Int32Array(N).fill(-10);
    this.frame = 0;
    this.resetMotion();
    this.syncTerrain(true);
  }

  startBlockReason() {
    if (Math.abs(this.lever) > 0.02) return { text: '起动机不转 —— 行走手柄不在中位', why: '中位起动保护:行走手柄必须在中位(卡槽里)才能打火。按 N 把手柄拉回中位。' };
    return null;
  }
  resetMotion() {
    this.st.x = this.position.x;
    this.st.z = this.position.z;
    this.st.heading = this.heading;
    this.st.gamma = 0;
    this.speed = 0;
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
    this.lever = 0;
    this.range = 1;
    this.throttleStep = 0;
    this.vibe = false;
    this.amp = 'high';
    this.coolant = 75;
    this.overturned = false;
    this.clearCompaction();
  }
  clearCompaction() {
    this.passes.fill(0);
    this.lastFrame.fill(-10);
  }
  setThrottle(n) {
    this.throttleStep = clamp(n, 0, 2);
  }
  toggleVibe() {
    if (!this.vibe && this.range === 2) {
      this.hint('vibeHi', '行驶档(Ⅱ档)不能振动', '振动压实只能在作业档(Ⅰ档)低速进行。先按 V 换到Ⅰ档。');
      return false;
    }
    this.vibe = !this.vibe;
    return true;
  }
  toggleRange() {
    if (Math.abs(this.speed) > 0.1) {
      this.hint('rangeMove', '行驶中不能换档', '先把行走手柄拉回中位、停稳,再换档。');
      return false;
    }
    this.range = this.range === 1 ? 2 : 1;
    if (this.range === 2) this.vibe = false;
    return true;
  }
  centerLever() {
    if (this.vibe && Math.abs(this.speed) > 0.1) this.hint('vibeStop', '停车前先关振动', '振动还开着就停车,钢轮在原地振,会把路面振出一个坑。');
    this.lever = 0;
  }

  // ── 主循环 ────────────────────────────────────────────────────────────
  update(dt, raw) {
    this.time += dt;
    this.frame++;
    const live = this.running && !this.overturned;
    const steer = live ? raw.leftX : 0;
    // 行走手柄:按住 W/S 往前/往后推,松手留在原位;过中位时卡一下
    const push = raw.leftY;
    const prev = this.lever;
    if (Math.abs(push) > 0.02 && !this._detent) {
      let nl = clamp(this.lever + push * 0.85 * dt, -1, 1);
      if (prev !== 0 && Math.sign(nl) !== Math.sign(prev)) {
        nl = 0;
        this._detent = true;
      }
      this.lever = nl;
    }
    if (Math.abs(push) < 0.02) this._detent = false;
    // 振动状态下手柄过中位 = 带振动换向
    if (prev !== 0 && this.lever === 0 && this.vibeLive) this.violate('rlVibeReverse', 5);
    this.controls = { steer: raw.leftX, lever: this.lever, vibe: this.vibe };
    this.cmds = { swing: 0, boom: 0 };

    const target = RPM[this.throttleStep];
    this._updateEngine(dt, target, this.load);
    const rpmK = this.running ? clamp(this.rpm / this.cfg.maxRpm, 0, 1) : 0;

    // ── 行走 ──
    let want = 0;
    if (live && !this.parkBrake) want = this.lever * SPEED[this.range] * clamp(rpmK * 1.15, 0, 1);
    if (this.parkBrake && Math.abs(this.lever) > 0.15 && live) {
      this.violate('rlParkDrive', 8);
      this.hint('park', '车走不动 —— 停车制动还按着', '起步前先松开停车制动(按 Q)。');
    }
    const acc = clamp((want - this.speed) * 1.8, -1.6, 0.9);
    this.speed += acc * dt;
    // 坡道
    this.speed -= Math.sin(this.pitch) * 9.8 * 0.15 * dt * (this.lever === 0 ? 0 : 1);
    if (Math.abs(want) < 0.01 && Math.abs(this.speed) < 0.02) this.speed = 0;

    let dGamma = -steer * 0.42 * (0.45 + 0.55 * rpmK);
    const g1 = this.st.gamma + dGamma * dt;
    let relief = 0;
    if (Math.abs(g1) > ROLLER.gammaMax) {
      dGamma = (Math.sign(g1) * ROLLER.gammaMax - this.st.gamma) / dt;
      if (Math.abs(steer) > 0.2) relief = 0.6;
    }
    const save = { ...this.st };
    const savePos = this.position.clone();
    const step = articulatedStep(this.st, this.speed, dGamma, ROLLER.lf, ROLLER.lr, dt);
    this.yawRate = step.dHeading;
    this.position.x = this.st.x;
    this.position.z = this.st.z;
    this.heading = this.st.heading;

    // ── 振动 ──
    this.vibeLive = live && this.vibe && this.range === 1;
    this.vibeHz = this.vibeLive ? 32 * (this.rpm / this.cfg.maxRpm) : 0;
    const amp = this.amp === 'high' ? 1 : 0.55;
    this.shake = this.vibeLive ? Math.sin(this.time * this.vibeHz * Math.PI * 2) * 0.006 * amp : 0;
    if (this.vibeLive) {
      if (Math.abs(this.speed) < 0.08) {
        this.staticT += dt;
        if (this.staticT > 1.2) this.violate('rlStaticVibe', 8);
      } else this.staticT = 0;
      if (this.rpm < 1900) {
        this.violate('rlLowRpmVibe', 10);
        this.hint('lowrpm', '转速太低还在振动', '振动频率跟发动机转速走,转速低了频率就低,钢轮会"跳"着走,压不实还伤机器。振动作业要把油门开到最高档(按 +)。');
      }
      if (Math.abs(this.speed) > 1.25) this.violate('rlFast', 8);
    } else this.staticT = 0;

    this.syncTerrain(false, dt);
    this.model.roll(step.front, step.rear);
    this._compact(dt);
    this._edgeCheck(dt);
    this._collide(save, savePos);

    const wasTravelling = this.travelling;
    this.travelling = Math.abs(this.speed) > 0.05;
    if (this.travelling && !wasTravelling) {
      if (this.time - this.lastHorn > 8 && this.time - (this.lastTravelStop ?? -99) > 15) this.emit('noHorn');
      this.emit('travelStart');
    }
    if (!this.travelling && wasTravelling) this.lastTravelStop = this.time;
    this.relief += ((relief > 0.3 ? 1 : 0) - this.relief) * Math.min(1, dt * 8);
    this.load = clamp(Math.abs(this.speed) * 0.25 + (this.vibeLive ? 0.45 * amp : 0) + this.relief * 0.3, 0, 1);
    this.moving = this.travelling || Math.abs(dGamma) > 0.02 || this.vibeLive;
  }

  _revert(save, savePos) {
    Object.assign(this.st, save);
    this.position.copy(savePos);
    this.heading = save.heading;
    this.syncTerrain(true);
  }

  // ── 贴地:钢轮是刚性的长圆柱,取整个轮宽下最高的点 ─────────────────
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
    const tw = ROLLER.track / 2 + 0.06;
    const rL = ht(-ROLLER.lr, -tw);
    const rR = ht(-ROLLER.lr, tw);
    // 钢轮:沿轮宽取 5 点,左右两半各取最高
    const fx = ROLLER.lf * Math.cos(g);
    const fz = -ROLLER.lf * Math.sin(g);
    const dw = ROLLER.drumW / 2 - 0.05;
    const drum = [];
    for (const t of [-1, -0.5, 0, 0.5, 1]) drum.push(ht(fx + Math.sin(g) * dw * t, fz + Math.cos(g) * dw * t));
    const fL = Math.max(drum[0], drum[1], drum[2] - 0.02);
    const fR = Math.max(drum[4], drum[3], drum[2] - 0.02);
    const hf = Math.max(drum[2], (fL + fR) / 2);
    const hr = (rL + rR) / 2;
    const span = ROLLER.lr + fx;
    const pitch = Math.atan2(hf - hr, span);
    // 前车架能绕纵轴摆(摆动铰),侧倾主要由后桥决定;但钢轮那头也会拖一点
    const roll = Math.atan2(rL - rR, ROLLER.track) * 0.7 + Math.atan2(fL - fR, ROLLER.drumW) * 0.3;
    const y = hr + (hf - hr) * (ROLLER.lr / span);
    const k = snap ? 1 : Math.min(1, dt * 8);
    this.position.y += (y - this.position.y) * k;
    this.pitch += (pitch - this.pitch) * k;
    this.roll += (roll - this.roll) * k;
    this.drumRoll = Math.atan2(fL - fR, ROLLER.drumW) - this.roll;
    this._applyRoot((r) => {
      if (this.tilt.angle > 0) {
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
    this.model.setPose({ gamma: this.st.gamma, shake: this.shake });
    this.model.front.rotation.x = clamp(this.drumRoll || 0, -0.2, 0.2);
    this.model.root.updateMatrixWorld(true);
  }

  // ── 压实 ──────────────────────────────────────────────────────────────
  _compact(dt) {
    const T = this.terrain;
    const fr = this.model.front;
    // 钢轮接地线:前车架局部 (lf, 0, z),沿轮宽
    const a = (this._ca ||= new THREE.Vector3());
    const b = (this._cb ||= new THREE.Vector3());
    const hw = ROLLER.drumW / 2 - 0.03;
    a.set(ROLLER.lf, 0, -hw).applyMatrix4(fr.matrixWorld);
    b.set(ROLLER.lf, 0, hw).applyMatrix4(fr.matrixWorld);
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.ceil(len / (T.cell * 0.5));
    const k = this.vibeLive ? (this.amp === 'high' ? VIBE_K.high : VIBE_K.low) : VIBE_K.static;
    const speedF = clamp(1.3 - Math.abs(this.speed) / 2.5, 0.5, 1.1); // 2~4 km/h 最合适,越快越虚
    const rpmF = this.vibeLive ? clamp(this.rpm / 2100, 0.4, 1) : 1;
    let touched = 0;
    let i0 = 1e9;
    let i1 = -1;
    let j0 = 1e9;
    let j1 = -1;
    const seen = (this._seen ||= new Set());
    seen.clear();
    // 接触带前后各半格,保证每格都被扫到
    const hx = Math.cos(this.heading + this.st.gamma) * T.cell * 0.5;
    const hz = -Math.sin(this.heading + this.st.gamma) * T.cell * 0.5;
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      for (const o of [-1, 0, 1]) {
        const x = a.x + (b.x - a.x) * t + hx * o;
        const z = a.z + (b.z - a.z) * t + hz * o;
        const i = Math.round(T.gx(x));
        const j = Math.round(T.gz(z));
        if (i < 0 || j < 0 || i > T.N || j > T.N) continue;
        const kk = T.idx(i, j);
        if (seen.has(kk)) continue;
        seen.add(kk);
        // 钢轮是刚性的:比接地线低太多的坑里压不到
        const groundY = T.heights[kk];
        const contactY = a.y + (b.y - a.y) * t;
        if (contactY - groundY > 0.035) continue;
        const cont = this.lastFrame[kk] >= this.frame - 2;
        this.lastFrame[kk] = this.frame;
        touched++;
        if (cont) continue;
        // 新的一遍
        if (this.passes[kk] < 255) this.passes[kk]++;
        const c0 = this.comp[kk];
        const c1 = c0 + (1 - c0) * k * speedF * rpmF;
        this.comp[kk] = c1;
        const loose = T.disturbed[kk];
        T.heights[kk] -= (c1 - c0) * SETTLE * (0.4 + loose);
        T.disturbed[kk] = Math.max(0, loose - (c1 - c0) * 1.1);
        i0 = Math.min(i0, i);
        i1 = Math.max(i1, i);
        j0 = Math.min(j0, j);
        j1 = Math.max(j1, j);
      }
    }
    // 原地振动:越振越往下陷,振出一道坑
    if (this.vibeLive && Math.abs(this.speed) < 0.08) {
      for (const kk of seen) {
        T.heights[kk] -= dt * 0.012 * (0.3 + T.disturbed[kk]);
        T.disturbed[kk] = Math.min(1, T.disturbed[kk] + dt * 0.05);
      }
      const c = Math.round(T.gx((a.x + b.x) / 2));
      const d = Math.round(T.gz((a.z + b.z) / 2));
      i0 = Math.min(i0, c - 6);
      i1 = Math.max(i1, c + 6);
      j0 = Math.min(j0, d - 6);
      j1 = Math.max(j1, d + 6);
    }
    if (i1 >= 0) {
      T._mark(i0 - 1, j0 - 1, i1 + 1, j1 + 1);
      T.flush();
    }
    this.contactCells = touched;
  }

  /** 区域压实统计:cells 里压实度 ≥ target 的比例、平均遍数 */
  coverage(cx, cz, hx, hz, target = 0.8) {
    const T = this.terrain;
    const i0 = clamp(Math.ceil(T.gx(cx - hx)), 0, T.N);
    const i1 = clamp(Math.floor(T.gx(cx + hx)), 0, T.N);
    const j0 = clamp(Math.ceil(T.gz(cz - hz)), 0, T.N);
    const j1 = clamp(Math.floor(T.gz(cz + hz)), 0, T.N);
    let n = 0;
    let ok = 0;
    let p = 0;
    let c = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = T.idx(i, j);
        n++;
        if (this.comp[k] >= target) ok++;
        p += this.passes[k];
        c += this.comp[k];
      }
    }
    return { frac: n ? ok / n : 0, passes: n ? p / n : 0, comp: n ? c / n : 0 };
  }

  // ── 侧倾 / 填方边缘 ──────────────────────────────────────────────────
  _edgeCheck(dt) {
    const T = this.tilt;
    const r = Math.abs(this.roll) + Math.abs(this.drumRoll || 0) * 0.5;
    this.stability = clamp(1 - r / 0.32, -1, 1);
    if (r > 0.17) this.violate('rlEdge', 6);
    if (r > 0.3 && T.kind !== 'tip') {
      T.kind = 'tip';
      T.side = this.roll > 0 ? -1 : 1;
      T.vel = 0;
      this.violate('rlTip', 6);
    }
    if (T.kind === 'tip') {
      T.vel += (r > 0.26 ? 1.5 : -2) * dt;
      T.angle = Math.max(0, T.angle + T.vel * dt);
      if (T.angle === 0 && T.vel < 0) {
        T.kind = null;
        T.vel = 0;
      }
      if (T.angle > 0.5 && !this.overturned) {
        this.overturned = true;
        this.violate('rlOverturn', 0);
      }
      if (this.overturned) T.angle = Math.min(T.angle + dt * 0.8, 1.45);
    }
  }

  _collide(save, savePos) {
    if (!this.obstacles.length || !(this.travelling || Math.abs(this.yawRate) > 0.01)) return;
    const r = this.model.root.matrixWorld;
    const f = this.model.front.matrixWorld;
    const pts = [
      [f, ROLLER.lf + 1.15, 0.8, 0],
      [f, ROLLER.lf + 1.15, 0.8, 1.25],
      [f, ROLLER.lf + 1.15, 0.8, -1.25],
      [f, ROLLER.lf + 0.85, 0.3, 0],
      [f, ROLLER.lf - 1.1, 0.8, 1.3],
      [f, ROLLER.lf - 1.1, 0.8, -1.3],
      [r, -3.4, 0.9, 0],
      [r, -3.4, 0.9, 1.0],
      [r, -3.4, 0.9, -1.0],
      [r, -1.35, 0.8, 1.25],
      [r, -1.35, 0.8, -1.25],
    ].map(([m, x, y, z]) => new THREE.Vector3(x, y, z).applyMatrix4(m));
    const hit = this.hitTest(pts, 'chassis');
    if (hit && hit.kind === 'block') {
      const impact = Math.abs(this.speed) + 0.3;
      this._revert(save, savePos);
      this.speed = 0;
      this.lever = 0;
      this.emit('hit', { obstacle: hit.obstacle, impact }, 1.2);
    } else if (hit && hit.kind === 'knock') this.emit('knock', { obstacle: hit.obstacle });
  }

  // ── 给界面 ────────────────────────────────────────────────────────────
  status() {
    return {
      ...this.baseStatus(),
      drawMonitor: (mon) => this.drawMonitor(mon),
    };
  }

  /** 仪表屏:转速、车速、振动状态 + 压实遍数图(以车为中心,车头朝上) */
  drawMonitor(mon) {
    const g = mon.ctx;
    const w = mon.canvas.width;
    const h = mon.canvas.height;
    g.fillStyle = this.power ? '#0b1420' : '#050607';
    g.fillRect(0, 0, w, h);
    if (!this.power) {
      mon.tex.needsUpdate = true;
      return;
    }
    if (this.selfTest > 0) {
      g.fillStyle = '#1d6fd1';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff';
      g.font = 'bold 30px "Microsoft YaHei", sans-serif';
      g.textAlign = 'center';
      g.fillText('锐工 RG620', w / 2, h / 2);
      mon.tex.needsUpdate = true;
      return;
    }
    g.fillStyle = '#16263a';
    g.fillRect(0, 0, w, 40);
    g.textAlign = 'left';
    g.font = 'bold 24px "Microsoft YaHei", sans-serif';
    g.fillStyle = this.vibeLive ? '#ffd24a' : '#556';
    g.fillText(this.vibeLive ? `振动 ${this.amp === 'high' ? '高' : '低'} ${this.vibeHz.toFixed(0)}Hz` : '振动 关', 10, 29);
    g.textAlign = 'right';
    g.fillStyle = '#cfe0f2';
    g.fillText(`${Math.abs(this.speed * 3.6).toFixed(1)} km/h`, w - 10, 29);
    this.drawCoverage(g, 8, 48, w - 16, h - 56);
    mon.tex.needsUpdate = true;
  }

  /** 压实遍数图:以钢轮为中心 ±10 m,车头朝上;颜色 = 压实度 */
  drawCoverage(g, x0, y0, W, H) {
    const T = this.terrain;
    const span = 12;
    const cells = 48;
    const s = W / cells;
    const rows = Math.floor(H / s);
    const hd = this.heading + this.st.gamma;
    const cx = this.position.x + Math.cos(hd) * ROLLER.lf;
    const cz = this.position.z - Math.sin(hd) * ROLLER.lf;
    const fx = Math.cos(hd);
    const fz = -Math.sin(hd);
    const rx = -fz; // 右
    const rz = fx;
    g.fillStyle = '#121a22';
    g.fillRect(x0, y0, W, H);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cells; c++) {
        const u = ((c + 0.5) / cells - 0.5) * span * 2;
        const v = (0.5 - (r + 0.5) / rows) * span * 2 * (rows / cells);
        const x = cx + fx * v + rx * u;
        const z = cz + fz * v + rz * u;
        const i = Math.round(T.gx(x));
        const j = Math.round(T.gz(z));
        if (i < 0 || j < 0 || i > T.N || j > T.N) continue;
        const k = T.idx(i, j);
        const p = this.comp[k];
        if (p < 0.02) {
          if (T.disturbed[k] > 0.5) {
            g.fillStyle = '#3a2f22';
            g.fillRect(x0 + c * s, y0 + r * s, s + 0.5, s + 0.5);
          }
          continue;
        }
        g.fillStyle = p < 0.45 ? '#c0392b' : p < 0.65 ? '#e67e22' : p < 0.8 ? '#f1c40f' : p < 0.92 ? '#7bd36b' : '#2ecc71';
        g.fillRect(x0 + c * s, y0 + r * s, s + 0.5, s + 0.5);
      }
    }
    // 车的位置(钢轮)
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    const midX = x0 + W / 2;
    const midY = y0 + (rows * s) / 2;
    const dw = (ROLLER.drumW / (span * 2)) * W;
    g.strokeRect(midX - dw / 2, midY - 3, dw, 6);
  }

  dangerRadius() {
    return 6;
  }

  soundParams() {
    return {
      rpm: this.rpm,
      load: this.load,
      hyd: Math.abs(this.lever) * 0.3,
      relief: this.relief,
      travel: clamp(Math.abs(this.speed) / 2, 0, 1) * 0.5,
      clank: false,
      crank: this.engine === 'crank',
      running: this.running,
      horn: this.horn,
      travelAlarm: this.speed < -0.05,
      vibe: this.vibeLive ? this.vibeHz * (this.amp === 'high' ? 1 : 0.6) : 0,
      warn: this.tilt.kind === 'tip',
    };
  }
}

export function createRoller(M, terrain) {
  const model = new RollerModel(M);
  const sim = new RollerSim(model, terrain);
  return { model, sim };
}
