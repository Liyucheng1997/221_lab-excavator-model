/**
 * 整机仿真。手柄 → 先导 → 主阀 → 泵流量分配 → 油缸速度 → 关节角速度 → 姿态。
 *
 * 教学上真正重要的"真实感"都在这里:
 *   · 钥匙 OFF/ON/START、先导安全锁杆、中位启动保护(锁杆没锁不让打火)
 *   · 油门旋钮 1~10 档、作业模式 P/E/L、自动怠速、龟兔档
 *   · 手柄控制的是流量:dθ/dt = 油缸速度 ÷ |dL/dθ|,同样的手柄行程在不同姿态下转速不同
 *   · 两台主泵的流量是有限的 —— 三个动作一起推到底就分不够,复合动作会变慢
 *   · 回转有惯量,斗里有土、斗杆伸得越远越难停
 *   · 土是有阻力的:斗底压进地里就走不动(憋缸),继续压动臂会把车撑起来
 *   · 重心超出履带支撑范围就会倾翻
 *   · 斗口法线朝不朝上决定土撒不撒
 */
import * as THREE from 'three';
import {
  BOOM,
  ARM,
  BUCKET,
  UPPER,
  UNDERCARRIAGE as UC,
  HYDRAULICS as HY,
  ENGINE,
  MASS,
  bucketLocal,
} from './config.js';
import { fromArray, cylinderLength, solveBucketLinkage, clamp } from './linkage.js';

const JOINTS = {
  boom: {
    min: BOOM.angleMin,
    max: BOOM.angleMax,
    speed: HY.cyl.boom,
    L: (a) => cylinderLength(fromArray(BOOM.cyl.base), fromArray(BOOM.foot), fromArray(BOOM.cyl.rod), a),
  },
  arm: {
    min: ARM.angleMin,
    max: ARM.angleMax,
    speed: HY.cyl.arm,
    L: (a) => cylinderLength(fromArray(ARM.cyl.base), fromArray(BOOM.tip), fromArray(ARM.cyl.rod), a),
  },
  bucket: {
    min: BUCKET.angleMin,
    max: BUCKET.angleMax,
    speed: HY.cyl.bucket,
    L: (() => {
      const cfg = { ...BUCKET, armTip: ARM.tip };
      return (a) => {
        const s = solveBucketLinkage(cfg, a);
        return s ? s.cylLength : NaN;
      };
    })(),
  },
};

const MAX_JOINT_RATE = 1.4; // rad/s 防止贴近死点时角速度发散
const TIP_EDGE_X = UC.tumbler / 2 + 0.08; // 倾翻线:驱动轮/引导轮中心附近
const TIP_EDGE_Z = UC.gauge / 2 + UC.shoeWidth / 2 - 0.05;

// 铲斗外壳采样点(铲斗局部系 2D + z)
const BODY_SAMPLES = [];
{
  const W = BUCKET.width / 2 - 0.04;
  const outer = BUCKET.design.outer;
  for (let i = 1; i < outer.length; i++) {
    const [x, y] = bucketLocal(outer[i]);
    for (const z of [-W, -W / 2, 0, W / 2, W]) BODY_SAMPLES.push([x, y, z]);
  }
}
const TOOTH_SAMPLES = [-0.5, 0, 0.5].map((z) => [BUCKET.tip[0], BUCKET.tip[1], z]);
const BUCKET_COG = bucketLocal([0.28, -0.7]);
// 铲斗侧面外轮廓(铲斗局部系):顶板前缘 → … → 刃口 → 齿尖,再闭合回顶板前缘(≈ 斗口)
const OUTER_LOCAL = [...BUCKET.design.outer.map((p) => bucketLocal(p)), BUCKET.tip];
const HALF_W = BUCKET.width / 2 - 0.03;
const PUSH_LIMIT = 0.06; // 斗背/斗底压着土走,允许把土压下/推开的深度;再深就顶住了
const TOOTH_PEN = 0.3; // 斗齿不挖、只往下扎时能扎进去的深度(把土挤开)
const CUT_RATE = 0.55; // m³/s 切土进斗的极限速率(松土;原状土减半)。一斗土要拖 2~4 秒才装得满,插太深就憋住

// 自身干涉检查用的盒子(回转平台局部系):驾驶室、上车本体
const CAB_BOX = {
  x0: UPPER.cab.x - UPPER.cab.length / 2 - 0.05,
  x1: UPPER.cab.x + UPPER.cab.length / 2 + 0.08,
  y0: UPPER.deckY - 0.1,
  y1: UPPER.deckY + UPPER.cab.height + 0.1,
  z0: UPPER.cab.z - UPPER.cab.width / 2 - 0.05,
  z1: UPPER.cab.z + UPPER.cab.width / 2 + 0.05,
};
const inBox = (b, x, y, z) => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1 && z > b.z0 && z < b.z1;

export class Machine {
  constructor(excavator, terrain) {
    this.ex = excavator;
    this.terrain = terrain;

    // ── 操纵装置状态 ──
    this.key = 'off'; // off | on | start
    this.engine = 'off'; // off | crank | running
    this.locked = true; // 先导安全锁杆:true = 抬起(锁定)
    this.throttle = 3;
    this.mode = 'P';
    this.travelHi = false;
    this.autoIdle = true;
    this.lights = false;
    this.horn = false;

    this.rpm = 0;
    this.coolant = 25; // °C
    this.fuel = 0.72;
    this.hours = 1236.4;
    this.selfTest = 0;
    this.crankT = 0;
    this.crankTotal = 0;
    this.idleT = 0; // 手柄回中多久了
    this.time = 0;
    this.lastHorn = -99;

    // ── 运动状态 ──
    this.pose = { swing: 0, boom: 0.3, arm: -2.0, bucket: -1.1 };
    this.prevPose = { ...this.pose };
    this.swingVel = 0;
    this.swingAcc = 0;
    this.trackVel = [0, 0];
    this.heading = 0;
    this.position = new THREE.Vector3();
    this.pitch = 0;
    this.roll = 0;
    // 撑车 / 倾翻:绕履带某条边抬起
    this.tilt = { angle: 0, vel: 0, kind: null, axis: new THREE.Vector3(0, 0, 1), pivot: new THREE.Vector3() };
    this.overturned = false;

    // ── 挖掘状态 ──
    this.bucketLoad = 0;
    this.load = 0; // 0~1 液压负载率
    this.relief = 0; // 0~1 溢流(憋缸)程度
    this.reliefT = 0;
    this.digging = false;
    this.spilling = false;
    this.penetration = 0;
    this.stability = 1; // 1 = 很稳,0 = 临界,<0 = 在翻
    this.tipSpeed = 0;
    this.moving = false;
    this.travelling = false;
    this.cmds = { boom: 0, arm: 0, bucket: 0, swing: 0, trackL: 0, trackR: 0 };

    this.obstacles = []; // { hit(p: Vector3, kind) → null | 'block' | 'knock' , name }
    this.onSpill = null; // (pos, volume, vel) → 由世界决定落到哪
    this.listeners = {};
    this._cool = {};

    this._rootM = new THREE.Matrix4();
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._F = {};
    this._tipPrev = new THREE.Vector3();
    this._tpA = {};
    this._tpB = {};
    this._hasPrev = false;

    this.resetPose();
    this.syncTerrain(true);
  }

  // ── 事件 ──────────────────────────────────────────────────────────────
  on(evt, fn) {
    (this.listeners[evt] ||= []).push(fn);
  }
  off(evt, fn) {
    const a = this.listeners[evt];
    if (a) this.listeners[evt] = a.filter((f) => f !== fn);
  }
  emit(evt, data, cooldown = 0) {
    if (cooldown > 0) {
      const t = this._cool[evt] || -1e9;
      if (this.time - t < cooldown) return;
      this._cool[evt] = this.time;
    }
    for (const f of this.listeners[evt] || []) f(data);
    for (const f of this.listeners['*'] || []) f(evt, data);
  }

  // ── 驾驶室里的开关 ────────────────────────────────────────────────────

  /** 钥匙:OFF ↔ ON。运转中拧到 OFF 就熄火。 */
  keyToggle() {
    if (this.key === 'off') {
      this.key = 'on';
      this.selfTest = 1.6;
      this.emit('key', 'on');
    } else {
      if (this.engine === 'running' && this.rpm > ENGINE.idleRpm + 250) this.emit('hotShutdown');
      this.key = 'off';
      this.engine = 'off';
      this.emit('key', 'off');
    }
  }

  /** 按住 = 打到 START 档;松开弹回 ON */
  keyStart(held) {
    if (held && this.key === 'on' && this.engine !== 'running') {
      if (!this.locked) {
        // 中位启动保护:先导锁杆没锁,起动机不转
        this.emit('startBlocked', null, 2);
        return;
      }
      this.key = 'start';
      if (this.engine === 'off') {
        this.engine = 'crank';
        this.crankT = 0;
        this.emit('crank');
      }
    } else if (!held && this.key === 'start') {
      this.key = 'on';
      if (this.engine === 'crank') this.engine = 'off';
    }
  }

  setLock(v) {
    if (this.locked === v) return;
    this.locked = v;
    this.emit('lock', v);
  }
  toggleLock() {
    this.setLock(!this.locked);
  }
  setThrottle(n) {
    this.throttle = clamp(Math.round(n), 1, ENGINE.throttleSteps);
  }
  cycleMode() {
    const order = Object.keys(ENGINE.modes);
    this.mode = order[(order.indexOf(this.mode) + 1) % order.length];
    this.emit('mode', this.mode);
  }
  toggleTravelSpeed() {
    this.travelHi = !this.travelHi;
    this.emit('travelSpeed', this.travelHi);
  }
  toggleAutoIdle() {
    this.autoIdle = !this.autoIdle;
  }
  toggleLights() {
    this.lights = !this.lights;
  }
  setHorn(v) {
    if (v && !this.horn) {
      this.lastHorn = this.time;
      this.emit('horn');
    }
    this.horn = v && this.key !== 'off';
  }

  get running() {
    return this.engine === 'running';
  }
  get power() {
    return this.key !== 'off';
  }
  get hydraulicsLive() {
    return this.running && !this.locked && !this.overturned;
  }

  /** 收拢的行进姿态 —— 真机转场时就是这么摆的 */
  resetPose() {
    this.pose.boom = 0.12;
    this.pose.arm = -2.3;
    this.pose.bucket = -2.25;
    this.swingVel = 0;
  }

  /** 铲斗落地的停机姿态 */
  parkPose() {
    this.pose.boom = 0.28;
    this.pose.arm = -1.7;
    this.pose.bucket = -1.1;
  }

  placeAt(x, z, heading = 0, swing = 0) {
    this.position.set(x, 0, z);
    this.heading = heading;
    this.pose.swing = swing;
    this.swingVel = 0;
    this.trackVel = [0, 0];
    this.tilt.angle = 0;
    this.tilt.vel = 0;
    this.tilt.kind = null;
    this.overturned = false;
    this._hasPrev = false;
    this.syncTerrain(true);
  }

  /** 直接进入运转状态(跳过启动流程的关卡用) */
  startEngineNow() {
    this.key = 'on';
    this.engine = 'running';
    this.rpm = ENGINE.idleRpm;
    this.coolant = Math.max(this.coolant, 70);
    this.selfTest = 0;
  }

  stopEngineNow() {
    this.key = 'off';
    this.engine = 'off';
    this.rpm = 0;
  }

  dialRpm() {
    return ENGINE.idleRpm + ((ENGINE.maxRpm - ENGINE.idleRpm) * (this.throttle - 1)) / (ENGINE.throttleSteps - 1);
  }

  // ── 运动学 ────────────────────────────────────────────────────────────

  _dLdTheta(joint, a) {
    const h = 1e-4;
    const j = JOINTS[joint];
    const l1 = j.L(a - h);
    const l2 = j.L(a + h);
    if (!Number.isFinite(l1) || !Number.isFinite(l2)) return null;
    return (l2 - l1) / (2 * h);
  }

  /** 铲斗铰点在回转平面里的位置与铲斗总转角 */
  _frame(pose, F = this._F) {
    const b = pose.boom;
    const cb = Math.cos(b);
    const sb = Math.sin(b);
    F.ax = BOOM.foot[0] + BOOM.tip[0] * cb - BOOM.tip[1] * sb;
    F.ay = BOOM.foot[1] + BOOM.tip[0] * sb + BOOM.tip[1] * cb;
    F.am = b + pose.arm;
    const ca = Math.cos(F.am);
    const sa = Math.sin(F.am);
    F.ox = F.ax + ARM.tip[0] * ca - ARM.tip[1] * sa;
    F.oy = F.ay + ARM.tip[0] * sa + ARM.tip[1] * ca;
    F.a = F.am + pose.bucket;
    F.c = Math.cos(F.a);
    F.s = Math.sin(F.a);
    return F;
  }

  /** 回转平台局部点 → 世界 */
  _swingToWorld(px, py, pz, swing, out) {
    const cs = Math.cos(swing);
    const ss = Math.sin(swing);
    out.set(px * cs + pz * ss, py, -px * ss + pz * cs);
    return out.applyMatrix4(this._rootM);
  }

  /** 铲斗局部点 → 回转平台局部(2D + z) */
  _bucketToSwing(F, x, y) {
    return [F.ox + x * F.c - y * F.s, F.oy + x * F.s + y * F.c];
  }

  _jointStep(name, cmd, dt, flow) {
    const j = JOINTS[name];
    if (Math.abs(cmd) < 1e-4) return 0;
    const cur = this.pose[name];
    // 已经到油缸行程端点还在推 → 溢流
    if ((cmd > 0 && cur >= j.max - 1e-4) || (cmd < 0 && cur <= j.min + 1e-4)) {
      this._reliefNow = Math.max(this._reliefNow, Math.abs(cmd));
      return 0;
    }
    const d = this._dLdTheta(name, cur);
    if (d === null || Math.abs(d) < 1e-5) return 0;
    const vmax = cmd > 0 ? j.speed.up : j.speed.down;
    const cylVel = Math.abs(cmd) * vmax * flow;
    let omega = Math.min(cylVel / Math.abs(d), MAX_JOINT_RATE) * Math.sign(cmd);
    return clamp(cur + omega * dt, j.min, j.max) - cur;
  }

  // ── 主更新 ────────────────────────────────────────────────────────────

  update(dt, rawCmds) {
    this.time += dt;
    this._reliefNow = 0;
    this._updateEngine(dt, rawCmds);

    const live = this.hydraulicsLive;
    const c = live ? rawCmds : { boom: 0, arm: 0, bucket: 0, swing: 0, trackL: 0, trackR: 0 };
    this.cmds = c;
    if (!live && this.running && this.locked) {
      const pushed = Math.abs(rawCmds.boom) + Math.abs(rawCmds.arm) + Math.abs(rawCmds.bucket) + Math.abs(rawCmds.swing) + Math.abs(rawCmds.trackL) + Math.abs(rawCmds.trackR);
      if (pushed > 0.5) this.emit('lockedInput', null, 4);
    }

    // ── 泵流量:转速 × 作业模式;需求超出就按比例分 ──
    const pumpFactor = this.running ? clamp(this.rpm / ENGINE.maxRpm, 0, 1) * ENGINE.modes[this.mode].flow : 0;
    const demand =
      Math.abs(c.boom) + Math.abs(c.arm) + Math.abs(c.bucket) + Math.abs(c.swing) * 0.6 + (Math.abs(c.trackL) + Math.abs(c.trackR)) * 0.9;
    const share = demand > HY.pumpCapacity ? HY.pumpCapacity / demand : 1;
    const flow = pumpFactor * share;
    this.flowShare = share;

    Object.assign(this.prevPose, this.pose);
    let activity = 0;

    // ── 三个工作关节:铲斗扫过的土,斗口迎着走就进斗(但切土有速率上限),否则被推开/顶住 ──
    const full = this.bucketLoad >= BUCKET.capacity * 1.12;
    let blocked = false;
    for (const name of ['boom', 'arm', 'bucket']) {
      const d = this._jointStep(name, c[name], dt, flow);
      if (!d) continue;
      const before = this.pose[name];
      const base = this._contact(this.pose);
      const from = this._tipPlane(this.pose, this._tpA);
      this.pose[name] = before + d;
      const r = this._contact(this.pose);
      let f = 1;
      if (r.vol > base.vol + 1e-6) {
        // 动臂下压是"压",不是"铲":斗齿能扎进去一截,再往下就把车撑起来,但土不会因此进斗
        const into = !full && this._cuts(from, this._tipPlane(this.pose, this._tpB)) && !(name === 'boom' && d < 0);
        // 斗口迎着走:从斗口进来的土限速(切土阻力);斗壳压到的土只能压下去一点点;
        // 不是在铲(比如竖着往下扎),斗齿只能挤进去一截
        if (into) {
          const vmax = CUT_RATE * (0.5 + 0.5 * r.loose) * dt;
          const add = r.mouthVol - base.mouthVol;
          // 斗口里已经堵着没切完的土,再往里怼就很吃力
          if (base.mouthVol > 0.04) f = Math.min(f, clamp(0.04 / base.mouthVol, 0.15, 1));
          if (add > vmax) {
            f = Math.min(f, Math.max(0.03, vmax / add));
            // 动臂往下硬压着斗口进土:压不动,车就被撑起来
            if (name === 'boom' && d < 0) {
              const drop = Math.max(0, from.y - this._tpB.y) * (1 - f);
              if (drop > 1e-4 && this._tryJack(drop)) f = Math.max(f, 0.5);
            }
          }
        }
        const limit = (cur, prev, lim) => {
          if (cur <= lim || cur <= prev + 1e-5) return 1;
          const k = cur - Math.max(0, prev);
          return k > 1e-6 ? clamp((lim - Math.max(0, prev)) / k, 0, 1) : 0;
        };
        let g = limit(r.bodyMaxD, base.bodyMaxD, PUSH_LIMIT);
        if (!into) g = Math.min(g, limit(r.toothMaxD, base.toothMaxD, TOOTH_PEN));
        if (g < 1) {
          // 压不下去:动臂往下压 → 把车撑起来
          const over = Math.max(r.bodyMaxD - PUSH_LIMIT, into ? 0 : r.toothMaxD - TOOTH_PEN);
          if (name === 'boom' && d < 0 && this._tryJack(over)) g = 1;
        }
        f = Math.min(f, g);
        if (f < 1) this.pose[name] = before + d * f;
      }
      if (f < 0.6) {
        blocked = true;
        this._reliefNow = Math.max(this._reliefNow, Math.abs(c[name]) * (1 - f));
      }
      activity += (Math.abs(this.pose[name] - before) / Math.max(dt, 1e-5)) * 0.5;
    }
    // 撑起来之后抬动臂:车先落回地面,斗子才离地
    if (this.tilt.kind === 'jack' && this.tilt.angle > 0) this._settleJack(dt);

    // ── 回转:有惯量,斗里有土、伸得越远越难启停 ──
    const reach = Math.hypot(this._frame(this.pose).ox, 0);
    const inertia = 1 + this.bucketLoad * 0.35 + clamp((reach - 4) / 6, 0, 1) * 0.4;
    // 回转角按 Three.js 绕 +Y 逆时针为正(= 向左);手柄 swing > 0 是向右,所以取反
    const swingTarget = -c.swing * HY.swingSpeed * clamp(flow * 1.15, 0, 1);
    const accel = (Math.abs(c.swing) > 0.02 ? HY.swingAccel : HY.swingBrake) / inertia;
    const dv = swingTarget - this.swingVel;
    const prevVel = this.swingVel;
    this.swingVel += clamp(dv, -accel * dt, accel * dt);
    if (Math.abs(c.swing) < 0.02 && Math.abs(this.swingVel) < 0.008) this.swingVel = 0;
    this.swingAcc = (this.swingVel - prevVel) / Math.max(dt, 1e-5);
    this.pose.swing += this.swingVel * dt;
    // 回转时斗子贴着地/插在土里 → 被土挡住(侧向阻力很大)
    if (this.swingVel !== 0) {
      const r = this._contact(this.pose);
      if (r.maxD > 0.25) {
        this.pose.swing = this.prevPose.swing;
        this.swingVel = 0;
        this._reliefNow = Math.max(this._reliefNow, Math.abs(c.swing));
        this.emit('swingBlocked', null, 3);
      }
    }
    activity += Math.abs(this.swingVel) * 0.5;

    // ── 行走:左右履带各自加减速,差速转向 ──
    const vmax = (this.travelHi ? HY.trackSpeedHi : HY.trackSpeedLo) * clamp(flow * 1.1, 0, 1);
    const travelled = [0, 0];
    for (let i = 0; i < 2; i++) {
      const t = (i === 0 ? c.trackL : c.trackR) * vmax;
      this.trackVel[i] += clamp(t - this.trackVel[i], -HY.trackAccel * dt, HY.trackAccel * dt);
      if (Math.abs(t) < 0.02 && Math.abs(this.trackVel[i]) < 0.02) this.trackVel[i] = 0;
      travelled[i] = this.trackVel[i] * dt;
    }
    const [vL, vR] = this.trackVel;
    const wasTravelling = this.travelling;
    this.travelling = Math.abs(vL) > 0.02 || Math.abs(vR) > 0.02;
    if (this.travelling && !wasTravelling) {
      // 起步鸣笛:停了一阵子再起步,8 秒内得按过喇叭(边走边停的短暂调整不算)
      if (this.time - this.lastHorn > 8 && this.time - (this.lastTravelStop ?? -99) > 15) this.emit('noHorn');
      this.emit('travelStart');
    }
    if (!this.travelling && wasTravelling) this.lastTravelStop = this.time;
    const oldPos = this.position.clone();
    const oldHeading = this.heading;
    if (this.travelling && this.tilt.angle < 0.02) {
      const forward = (vL + vR) / 2;
      // 右履带比左履带快 → 向左转 → heading 增大
      const omega = (vR - vL) / UC.gauge;
      this.heading += omega * dt;
      // 坡太陡爬不上去(履带打滑)
      const slopeF = clamp(1 - Math.max(0, Math.sign(forward) * this.pitch - 0.45) * 4, 0.1, 1);
      this.position.x += Math.cos(this.heading) * forward * dt * slopeF;
      this.position.z += -Math.sin(this.heading) * forward * dt * slopeF;
      activity += Math.abs(forward) * 0.4 + Math.abs(omega) * 0.6;
    }
    this.ex.driveTracks(travelled[0], travelled[1]);

    const travelPen = this.travelling ? this._contact(this.pose).maxD : 0;
    this.syncTerrain(false, dt);
    // 行走时铲斗顶到地面/坡面:走不动(真机是履带打滑,或者把土推着走一小段)
    if (this.travelling) {
      const pen = this._contact(this.pose).maxD;
      if (pen > 0.25 && pen > travelPen + 1e-3) {
        this.position.copy(oldPos);
        this.heading = oldHeading;
        this.trackVel = [0, 0];
        this.syncTerrain(true);
        this._reliefNow = Math.max(this._reliefNow, 0.8);
        this.emit('travelBlocked', null, 4);
      }
    }
    this._stability(dt);

    // ── 碰撞:铲斗 / 配重 / 底盘 vs 障碍物和自身 ──
    this.ex.bucketLoad = this.bucketLoad;
    this.ex.setPose(this.pose);
    this.ex.root.updateMatrixWorld(true);
    if (this._collide(oldPos, oldHeading)) {
      this.ex.setPose(this.pose);
      this.syncTerrain(true);
      this.ex.root.updateMatrixWorld(true);
    }

    this._digAndSpill(dt);

    // ── 负载、溢流 ──
    this.relief += ((this._reliefNow > 0.3 ? 1 : 0) - this.relief) * Math.min(1, dt * 8);
    if (this.relief > 0.6) {
      this.reliefT += dt;
      if (this.reliefT > 2.5) this.emit('reliefHold', null, 6);
    } else this.reliefT = 0;
    this.load = clamp(activity * 0.45 + (this.digging ? 0.45 : 0) + this.relief * 0.5 + (blocked ? 0.2 : 0), 0, 1);
    this.moving = activity > 0.05;
  }

  _updateEngine(dt, raw) {
    if (this.selfTest > 0) this.selfTest = Math.max(0, this.selfTest - dt);
    const anyInput =
      Math.abs(raw.boom) + Math.abs(raw.arm) + Math.abs(raw.bucket) + Math.abs(raw.swing) + Math.abs(raw.trackL) + Math.abs(raw.trackR) >
      0.05;
    this.idleT = anyInput && !this.locked ? 0 : this.idleT + dt;

    if (this.engine === 'crank') {
      this.crankT += dt;
      this.crankTotal += dt;
      this.rpm += (240 - this.rpm) * Math.min(1, dt * 8);
      if (this.crankT > 8) this.emit('crankTooLong', null, 5);
      if (this.crankT >= ENGINE.crankTime) {
        this.engine = 'running';
        this.emit('started', { cold: this.coolant < 40 });
      }
    } else if (this.engine === 'running') {
      let target = this.dialRpm();
      this.autoDecelActive = this.autoIdle && this.idleT > ENGINE.autoDecelDelay && target > ENGINE.autoDecelRpm;
      if (this.autoDecelActive) target = ENGINE.autoDecelRpm;
      // 液压负载会把转速拉下去一点(P 模式掉得少)
      target -= this.load * (this.mode === 'P' ? 110 : 170) + this.relief * 120;
      this.rpm += (target - this.rpm) * Math.min(1, dt * (target > this.rpm ? 2.2 : 3));
      this.coolant += ((88 + this.load * 6 - this.coolant) * 0.018 + this.load * 0.02) * dt * 3;
      this.fuel = Math.max(0, this.fuel - dt * (this.rpm / ENGINE.maxRpm) * (0.2 + this.load) * 2e-5);
      this.hours += dt / 3600;
      if (this.coolant < 40 && this.load > 0.6) this.emit('coldHeavy', null, 20);
    } else {
      this.rpm += (0 - this.rpm) * Math.min(1, dt * 2.5);
      if (this.rpm < 5) this.rpm = 0;
      this.coolant += (25 - this.coolant) * 0.002 * dt;
    }
  }

  // ── 撑车:动臂往下压而斗子压不进土 → 绕远端履带边把车抬起来 ──
  _bucketDirChassis() {
    // 回转平台 +X 在底盘系里的水平方向
    return [Math.cos(this.pose.swing), -Math.sin(this.pose.swing)];
  }

  _setTiltAxis(kind) {
    const [dx, dz] = this._bucketDirChassis();
    const T = this.tilt;
    T.kind = kind;
    // jack:绕背离铲斗那一侧的边转,铲斗那一侧抬起;tip:绕铲斗那一侧的边转,背面抬起
    const away = kind === 'jack' ? -1 : 1;
    if (Math.abs(dx) >= Math.abs(dz)) {
      const sx = Math.sign(dx) * away;
      T.pivot.set(sx * TIP_EDGE_X, 0, 0);
      // 抬起 +X 端 = 绕 -Z... 统一成"抬起铲斗一侧"为正角
      T.axis.set(0, 0, kind === 'jack' ? Math.sign(dx) : -Math.sign(dx));
    } else {
      const sz = Math.sign(dz) * away;
      T.pivot.set(0, 0, sz * TIP_EDGE_Z);
      T.axis.set(kind === 'jack' ? -Math.sign(dz) : Math.sign(dz), 0, 0);
    }
  }

  _tryJack(excess) {
    const T = this.tilt;
    if (T.kind === 'tip' && T.angle > 0) return false;
    if (T.kind !== 'jack' || T.angle <= 0) this._setTiltAxis('jack');
    const F = this._frame(this.pose);
    // 力臂:铲斗到支点的水平距离
    const lever = Math.abs(F.ox) + (Math.abs(T.pivot.x) + Math.abs(T.pivot.z));
    if (lever < 3) return false;
    const next = T.angle + excess / lever;
    if (next > 0.26) return false;
    T.angle = next;
    this.syncTerrain(true);
    if (T.angle > 0.03) this.emit('jack', null, 5);
    return true;
  }

  _settleJack(dt) {
    const T = this.tilt;
    const rc = this._contact(this.pose);
    const pen = Math.max(rc.bodyMaxD, rc.toothMaxD - TOOTH_PEN + PUSH_LIMIT);
    const F = this._frame(this.pose);
    const lever = Math.abs(F.ox) + (Math.abs(T.pivot.x) + Math.abs(T.pivot.z));
    if (pen < PUSH_LIMIT - 0.01) {
      // 斗子没顶住地 → 车往下落,直到斗子重新顶住或者履带着地
      const drop = Math.min(T.angle, Math.max((PUSH_LIMIT - Math.max(pen, 0)) / lever, dt * 0.05));
      T.angle -= drop;
      if (T.angle <= 1e-4) {
        T.angle = 0;
        T.kind = null;
        this.emit('landed', null, 1);
      }
      this.syncTerrain(true);
    }
  }

  // ── 稳定性:重心投影 vs 履带支撑范围 ──
  _stability(dt) {
    const s = this.pose.swing;
    const cs = Math.cos(s);
    const ss = Math.sin(s);
    const F = this._frame(this.pose);
    let m = 0;
    let mx = 0;
    let my = 0;
    let mz = 0;
    const addSwing = (mass, x, y) => {
      m += mass;
      mx += mass * x * cs;
      mz += mass * -x * ss;
      my += mass * y;
    };
    m += MASS.lower.m;
    my += MASS.lower.m * MASS.lower.y;
    addSwing(MASS.upper.m, MASS.upper.x, MASS.upper.y);
    addSwing(MASS.counterweight.m, MASS.counterweight.x, MASS.counterweight.y);
    const cb = Math.cos(this.pose.boom);
    const sb = Math.sin(this.pose.boom);
    addSwing(MASS.boom.m, BOOM.foot[0] + 2.85 * cb - 0.5 * sb, BOOM.foot[1] + 2.85 * sb + 0.5 * cb);
    addSwing(MASS.arm.m, (F.ax + F.ox) / 2, (F.ay + F.oy) / 2);
    const [bx, by] = this._bucketToSwing(F, BUCKET_COG[0], BUCKET_COG[1]);
    const mb = MASS.bucket.m + this.bucketLoad * MASS.soilDensity + (this.hookLoad || 0);
    addSwing(mb, bx, by);
    const cx = mx / m;
    const cy = my / m;
    const cz = mz / m;
    // 重力方向在底盘系里(随地形俯仰侧倾)
    const g = this._tmp2.set(0, -1, 0).applyQuaternion(this._baseQuat.clone().invert());
    const t = cy / Math.max(0.2, -g.y);
    const px = cx + g.x * t;
    const pz = cz + g.z * t;
    const marginX = TIP_EDGE_X - Math.abs(px);
    const marginZ = TIP_EDGE_Z - Math.abs(pz);
    const margin = Math.min(marginX, marginZ);
    this.stability = clamp(margin / 1.2, -1, 1);
    this.cog = { x: px, z: pz };

    const T = this.tilt;
    if (T.kind === 'jack') return;
    if (margin < 0) {
      if (T.kind !== 'tip') {
        this._setTiltAxis('tip');
        this.emit('tipping');
      }
      // 倾覆力矩越大翻得越快;一旦翻起来力臂还会变大
      T.vel += (-margin * 2.2 + T.angle * 1.5) * dt;
    } else if (T.kind === 'tip') {
      T.vel += (-margin * 3 - 0.6) * dt;
    }
    if (T.kind === 'tip') {
      T.angle += T.vel * dt;
      if (T.angle <= 0) {
        if (T.vel < -0.15) this.emit('slam', -T.vel);
        T.angle = 0;
        T.vel = 0;
        T.kind = null;
      } else if (T.angle > 0.45 && !this.overturned) {
        this.overturned = true;
        this.emit('overturn');
      }
      if (this.overturned) T.angle = Math.min(T.angle + dt * 0.8, 1.35);
      this.syncTerrain(true);
    }
  }

  // ── 碰撞 ──
  _collide(oldPos, oldHeading) {
    const pts = this.ex.bucketWorldPoints(this._bucketPts || (this._bucketPts = []));
    const F = this._frame(this.pose);
    let hitSelf = null;
    // 自身干涉:铲斗撞驾驶室 / 撞履带
    const cs = Math.cos(this.pose.swing);
    const ss = Math.sin(this.pose.swing);
    for (const [x, y, z] of BODY_SAMPLES.concat(TOOTH_SAMPLES)) {
      const [px, py] = this._bucketToSwing(F, x, y);
      if (inBox(CAB_BOX, px, py, z)) {
        hitSelf = 'cab';
        break;
      }
      // 回转平台 → 底盘系
      const cx = px * cs + z * ss;
      const cz = -px * ss + z * cs;
      if (Math.abs(cx) < UC.trackOverallLength / 2 && py < 1.05 && Math.abs(cz) > UC.gauge / 2 - UC.shoeWidth / 2 - 0.05 && Math.abs(cz) < UC.gauge / 2 + UC.shoeWidth / 2 + 0.05) {
        hitSelf = 'track';
        break;
      }
    }
    let hit = null;
    let hitKind = null;
    if (!hitSelf && this.obstacles.length) {
      const test = (p, part) => {
        for (const o of this.obstacles) {
          const r = o.hit(p, part, this);
          if (r) return [o, r];
        }
        return null;
      };
      for (const p of pts) {
        const r = test(p, 'bucket');
        if (r) {
          [hit, hitKind] = r;
          if (hitKind === 'block') break;
        }
      }
      // 斗杆头
      if (!hit) {
        const p = this._swingToWorld(F.ax, F.ay, 0, this.pose.swing, this._tmp.clone());
        const r = test(p, 'arm');
        if (r) [hit, hitKind] = r;
      }
      // 配重尾部(回转时最容易扫到人和车)
      if (!hit) {
        for (let i = -2; i <= 2; i++) {
          const a = Math.PI + i * 0.3;
          const p = this._swingToWorld(Math.cos(a) * UPPER.tailRadius, 1.6, Math.sin(a) * UPPER.tailRadius, this.pose.swing, this._tmp.clone());
          const r = test(p, 'tail');
          if (r) {
            [hit, hitKind] = r;
            break;
          }
        }
      }
      // 底盘四角 + 前后中点(行走撞东西)
      if (!hit && this.travelling) {
        for (const [lx, lz] of [
          [2.25, -1.4],
          [2.25, 1.4],
          [-2.25, -1.4],
          [-2.25, 1.4],
          [2.25, 0],
          [-2.25, 0],
          [0, 1.4],
          [0, -1.4],
        ]) {
          const p = this._tmp.set(lx, 0.5, lz).applyMatrix4(this._rootM).clone();
          const r = test(p, 'chassis');
          if (r) {
            [hit, hitKind] = r;
            break;
          }
        }
      }
    }
    if (hitSelf) {
      Object.assign(this.pose, this.prevPose);
      this.swingVel = 0;
      this.emit('selfHit', hitSelf, 2);
      return true;
    }
    if (hit && hitKind === 'block') {
      Object.assign(this.pose, this.prevPose);
      const impact = Math.abs(this.swingVel) * 5 + Math.hypot(this.trackVel[0], this.trackVel[1]) + this.tipSpeed;
      this.swingVel = 0;
      if (this.travelling) {
        this.position.copy(oldPos);
        this.heading = oldHeading;
        this.trackVel = [0, 0];
      }
      this.emit('hit', { obstacle: hit, impact }, 1.2);
      return true;
    }
    if (hit && hitKind === 'knock') {
      this.emit('knock', { obstacle: hit }, 0);
    }
    return false;
  }

  /** 整机贴合地形:四个角采高度,定出高度 + 俯仰 + 侧倾;再叠加撑车/倾翻 */
  syncTerrain(snap, dt = 0.016) {
    const half = UC.tumbler / 2;
    const g = UC.gauge / 2;
    const ch = Math.cos(this.heading);
    const sh = Math.sin(this.heading);
    const sample = (lx, lz) => {
      const wx = this.position.x + lx * ch + lz * sh;
      const wz = this.position.z + -lx * sh + lz * ch;
      return this.terrain.heightAt(wx, wz);
    };
    // 每条履带取前中后三点里最高的两点 —— 履带是刚性的,跨在坑上不会掉下去
    const side = (lz) => {
      const f = sample(half, lz);
      const m = sample(0, lz);
      const r = sample(-half, lz);
      return [Math.max(f, (f + m) / 2), Math.max(r, (r + m) / 2)];
    };
    const [fl, rl] = side(-g);
    const [fr, rr] = side(g);
    const y = (fl + fr + rl + rr) / 4;
    const pitch = Math.atan2((fl + fr) / 2 - (rl + rr) / 2, UC.tumbler);
    const roll = Math.atan2((fl + rl) / 2 - (fr + rr) / 2, UC.gauge);
    const k = snap ? 1 : Math.min(1, dt * 6);
    this.position.y += (y - this.position.y) * k;
    this.pitch += (pitch - this.pitch) * k;
    this.roll += (roll - this.roll) * k;

    const q = (this._baseQuat ||= new THREE.Quaternion());
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.heading)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.pitch))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.roll));
    const M = this._rootM.compose(this.position, q, new THREE.Vector3(1, 1, 1));
    const T = this.tilt;
    if (T.angle > 0) {
      const P = T.pivot;
      const tilt = new THREE.Matrix4()
        .makeTranslation(P.x, P.y, P.z)
        .multiply(new THREE.Matrix4().makeRotationAxis(T.axis, T.angle))
        .multiply(new THREE.Matrix4().makeTranslation(-P.x, -P.y, -P.z));
      M.multiply(tilt);
    }
    (this._invRootM ||= new THREE.Matrix4()).copy(M).invert();
    M.decompose(this.ex.root.position, this.ex.root.quaternion, this.ex.root.scale);
    this.ex.root.updateMatrixWorld(true);
  }

  /** 斗口法线的竖直分量。1 = 斗口朝正上,土最稳;掉到 0 以下土肯定全撒了。 */
  mouthUp() {
    // 斗体在回转平面里的总转角,再算上整机俯仰(侧倾对斗口影响小,忽略)
    const total = this.pose.boom + this.pose.arm + this.pose.bucket + BUCKET.mouthNormal;
    const pitchInPlane = this.pitch * Math.cos(this.pose.swing) - this.roll * Math.sin(this.pose.swing);
    return Math.sin(total + pitchInPlane);
  }

  /** 铲斗外轮廓扫到的土:返回压进/切进的体积、最大深度、松土比例。cells 给了就收集 [格子号, 深度] */
  _contact(pose, cells = null) {
    const F = this._frame(pose);
    const poly = this._poly || (this._poly = OUTER_LOCAL.map(() => [0, 0]));
    let minX = 1e9;
    let maxX = -1e9;
    let minZ = 1e9;
    let maxZ = -1e9;
    const w = this._tmp;
    for (let i = 0; i < OUTER_LOCAL.length; i++) {
      const [x, y] = OUTER_LOCAL[i];
      const px = F.ox + x * F.c - y * F.s;
      const py = F.oy + x * F.s + y * F.c;
      poly[i][0] = px;
      poly[i][1] = py;
      for (const z of [-HALF_W, HALF_W]) {
        this._swingToWorld(px, py, z, pose.swing, w);
        if (w.x < minX) minX = w.x;
        if (w.x > maxX) maxX = w.x;
        if (w.z < minZ) minZ = w.z;
        if (w.z > maxZ) maxZ = w.z;
      }
    }
    const T = this.terrain;
    const i0 = clamp(Math.ceil(T.gx(minX)), 0, T.N);
    const i1 = clamp(Math.floor(T.gx(maxX)), 0, T.N);
    const j0 = clamp(Math.ceil(T.gz(minZ)), 0, T.N);
    const j1 = clamp(Math.floor(T.gz(maxZ)), 0, T.N);
    this._bbox = { i0, j0, i1, j1 };
    const e = this._invRootM.elements;
    const cs = Math.cos(pose.swing);
    const ss = Math.sin(pose.swing);
    const H = T.heights;
    const cellA = T.cell * T.cell;
    let vol = 0;
    let maxD = -1;
    let mouthVol = 0;
    let bodyMaxD = -1;
    let toothMaxD = -1;
    let loose = 0;
    let n = 0;
    const np = poly.length;
    // 最后两条边是 刃口→齿尖、齿尖→顶板前缘(≈ 斗口):底在这两条边上的那一列,土是从斗口进去的
    const mouthEdge = np - 2;
    for (let j = j0; j <= j1; j++) {
      const wz = T.wz(j);
      for (let i = i0; i <= i1; i++) {
        const k = T.idx(i, j);
        const wx = T.wx(i);
        const wy = H[k];
        // 世界 → 底盘局部 → 回转平面
        const sx = e[0] * wx + e[4] * wy + e[8] * wz + e[12];
        const sy = e[1] * wx + e[5] * wy + e[9] * wz + e[13];
        const sz = e[2] * wx + e[6] * wy + e[10] * wz + e[14];
        const px = sx * cs - sz * ss;
        const pw = sx * ss + sz * cs;
        if (pw < -HALF_W || pw > HALF_W) continue;
        // 竖线 x = px 和轮廓的交点里最低的那个 = 斗子在这一列的底
        let yLow = 1e9;
        let edge = -1;
        for (let a = 0; a < np; a++) {
          const p0 = poly[a];
          const p1 = poly[(a + 1) % np];
          if ((p0[0] - px) * (p1[0] - px) > 0 || p0[0] === p1[0]) continue;
          const t = (px - p0[0]) / (p1[0] - p0[0]);
          const y = p0[1] + (p1[1] - p0[1]) * t;
          if (y < yLow) {
            yLow = y;
            edge = a;
          }
        }
        if (yLow > 1e8) continue;
        const d = sy - yLow;
        if (d <= 0) continue;
        // 0 = 斗壳,1 = 斗齿(刃口→齿尖),2 = 斗口线
        const kind = edge < mouthEdge ? 0 : edge === mouthEdge ? 1 : 2;
        vol += d * cellA;
        if (d > maxD) maxD = d;
        if (kind) mouthVol += d * cellA;
        if (kind === 0 && d > bodyMaxD) bodyMaxD = d;
        if (kind > 0 && d > toothMaxD) toothMaxD = d;
        loose += T.disturbed[k];
        n++;
        if (cells) cells.push(k, d, kind);
      }
    }
    return { vol, maxD, mouthVol, bodyMaxD, toothMaxD, loose: n ? loose / n : 0 };
  }

  /** 齿尖在回转平面里的位置、齿尖朝向、斗口法线 */
  _tipPlane(pose, out = {}) {
    const F = this._frame(pose);
    const [tx, ty] = this._bucketToSwing(F, BUCKET.tip[0], BUCKET.tip[1]);
    const [ex, ey] = this._bucketToSwing(F, BUCKET.edge[0], BUCKET.edge[1]);
    const tl = Math.hypot(tx - ex, ty - ey) || 1;
    const mn = F.a + BUCKET.mouthNormal;
    out.x = tx;
    out.y = ty;
    out.tx = (tx - ex) / tl;
    out.ty = (ty - ey) / tl;
    out.mx = Math.cos(mn);
    out.my = Math.sin(mn);
    return out;
  }

  /** 从 a 走到 b,斗子是不是在"迎着斗口/顺着斗齿"走 —— 是的话扫到的土就进斗 */
  _cuts(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L = Math.hypot(dx, dy);
    if (L < 1e-6) return false;
    const tooth = (dx * b.tx + dy * b.ty) / L;
    const mouth = (dx * b.mx + dy * b.my) / L;
    // 土是从斗口进去的:斗子得朝着斗口张开的方向走(顺着斗齿走、同时斗口也大致迎着才算)
    return mouth > 0.3 || (tooth > 0.5 && mouth > 0);
  }

  _digAndSpill(dt) {
    const [a, b] = this.ex.getCuttingEdge(this._ea || (this._ea = new THREE.Vector3()), this._eb || (this._eb = new THREE.Vector3()));
    const tip = this._tip || (this._tip = new THREE.Vector3());
    tip.copy(a).lerp(b, 0.5);
    const vel = this._tipVel || (this._tipVel = new THREE.Vector3());
    if (this._hasPrev) vel.copy(tip).sub(this._tipPrev).divideScalar(Math.max(dt, 1e-5));
    else vel.set(0, 0, 0);
    this.tipSpeed = vel.length();
    this._tipPrev.copy(tip);

    this.digging = false;
    this.spilling = false;
    const ground = this.terrain.heightAt(tip.x, tip.z);
    this.tipDepth = ground - tip.y;
    const remaining = BUCKET.capacity * 1.15 - this.bucketLoad;

    // ── 铲斗扫过的土:斗口迎着运动方向 → 进斗;否则被斗背/斗底推开 ──
    const cells = this._cells || (this._cells = []);
    cells.length = 0;
    const r = this._contact(this.pose, cells);
    if (r.vol > 1e-6) {
      const T = this.terrain;
      // 判"铲没铲":只看斗杆和铲斗带出来的运动(动臂下压不算铲),动臂抬起的分量照算
      const probe = this._probe || (this._probe = {});
      Object.assign(probe, this.pose);
      if (this.pose.boom < this.prevPose.boom) probe.boom = this.prevPose.boom;
      const into = this._cuts(this._tipPlane(this.prevPose, this._tpA), this._tipPlane(probe, this._tpB)) && remaining > 1e-4 && this.bucketLoad < BUCKET.capacity * 1.12;
      // 进斗的量同样受切土速率限制 —— 斗子整个埋在土里时也不会一下子灌满
      const vcap = CUT_RATE * (0.5 + 0.5 * r.loose) * dt;
      const scale = into ? Math.min(1, Math.min(remaining, vcap) / Math.max(r.mouthVol, 1e-6)) : 1;
      const cellA = T.cell * T.cell;
      let got = 0;
      let removed = 0;
      for (let i = 0; i < cells.length; i += 3) {
        const k = cells[i];
        const kind = cells[i + 2];
        const inMouth = into && kind > 0;
        // 不铲的时候,斗齿和斗口线扎进去的那部分土只是被挤着,不动它
        if (!inMouth && kind > 0) continue;
        const d = cells[i + 1] * (inMouth ? scale : 1);
        T.heights[k] -= d;
        T.disturbed[k] = Math.max(T.disturbed[k], 0.6);
        if (inMouth) got += d * cellA;
        else removed += d * cellA;
      }
      const B = this._bbox;
      T._mark(B.i0, B.j0, B.i1, B.j1);
      if (got > 0) {
        this.bucketLoad += got;
        this.digging = got > 1e-4;
      }
      if (removed > 0) {
        // 推土:推到斗子前进方向的前面去
        const h = Math.hypot(vel.x, vel.z) || 1;
        const cp = this._center || (this._center = new THREE.Vector3());
        const [cx, cy] = bucketLocal([0.3, -0.7]);
        cp.set(cx, cy, 0);
        this.ex.bucketPivot.localToWorld(cp);
        T.deposit(cp.x + (vel.x / h) * 0.9, cp.z + (vel.z / h) * 0.9, removed, 0.6, false);
      }
      T._relax(B.i0 - 3, B.j0 - 3, B.i1 + 3, B.j1 + 3, 3);
    }
    this._hasPrev = true;

    // ── 撒:斗口翻过头,土就往外掉;回转起停太猛,冒尖的那部分也会甩出去 ──
    const lipW = this._lipW || (this._lipW = new THREE.Vector3());
    lipW.set(BUCKET.edge[0], BUCKET.edge[1], 0);
    this.ex.bucketPivot.localToWorld(lipW);
    const buried = this.terrain.heightAt(lipW.x, lipW.z) > lipW.y + 0.05;
    if (this.bucketLoad > 1e-4 && !buried) {
      const up = this.mouthUp();
      let out = 0;
      if (up < BUCKET.spillCos) {
        const rate = clamp((BUCKET.spillCos - up) * 2.4, 0, 1.8);
        out = Math.min(this.bucketLoad, rate * dt);
      }
      const heaped = this.bucketLoad - BUCKET.capacity * 0.85;
      if (heaped > 0 && Math.abs(this.swingAcc) > 0.75 && this.tipDepth < -0.3) {
        out += Math.min(heaped, heaped * 1.5 * dt);
        this.emit('jerkySpill', null, 6);
      }
      if (out > 0) {
        this.bucketLoad -= out;
        this.spilling = true;
        const lip = this._lip || (this._lip = new THREE.Vector3());
        lip.set(BUCKET.edge[0], BUCKET.edge[1], 0);
        this.ex.bucketPivot.localToWorld(lip);
        if (this.onSpill) this.onSpill(lip, out, vel);
        else this.terrain.deposit(lip.x, lip.z, out);
      }
    }
    this.terrain.flush();
  }

  /** 给界面用的一组状态 */
  status() {
    return {
      power: this.power,
      running: this.running,
      selfTest: this.selfTest > 0,
      rpm: this.rpm,
      throttle: this.throttle,
      mode: this.mode,
      travelHi: this.travelHi,
      autoIdle: this.autoIdle,
      autoDecel: !!this.autoDecelActive,
      locked: this.locked,
      lights: this.lights,
      hours: this.hours,
      fuel: this.fuel,
      coolant: clamp((this.coolant - 30) / 80, 0, 1),
      coolantC: this.coolant,
      warn: this._warn(),
    };
  }

  _warn() {
    if (this.overturned) return '整机倾翻';
    if (this.tilt.kind === 'tip') return '倾翻危险!';
    if (this.key === 'on' && this.engine === 'off' && !this.locked && this.time - (this._cool.startBlocked || -99) < 3) return '请先锁定先导杆';
    if (this.running && this.coolant < 40) return '低温 请预热';
    return null;
  }
}
