/**
 * 轮式机械仿真的公共部分:钥匙/发动机/喇叭/灯/驻车制动、事件、贴地、碰撞,以及铰接转向运动学。
 *
 * 和挖掘机的 Machine 对外长得一样(game / camera / hud 都靠这些字段):
 *   position heading pitch roll pose.swing(恒为 0)  running power rpm load engine key horn
 *   travelling moving relief obstacles  on() emit() status() placeAt() startEngineNow() …
 * 每种车再各自实现 update(dt, raw) 和 syncTerrain()。
 */
import * as THREE from 'three';
import { clamp } from '../linkage.js';

export class VehicleSim {
  constructor(model, terrain, cfg) {
    this.model = model;
    this.ex = model; // 和挖掘机 Machine 同名,方便共用代码
    this.terrain = terrain;
    this.cfg = cfg;
    this.kind = cfg.kind;

    this.key = 'off';
    this.engine = 'off';
    this.rpm = 0;
    this.coolant = 25;
    this.fuel = 0.7;
    this.hours = cfg.hours ?? 842.6;
    this.selfTest = 0;
    this.crankT = 0;
    this.horn = false;
    this.lights = false;
    this.parkBrake = true;
    this.lastHorn = -99;
    this.time = 0;

    this.position = new THREE.Vector3();
    this.heading = 0;
    this.pitch = 0;
    this.roll = 0;
    this.speed = 0; // m/s,前进为正
    this.pose = { swing: 0 };
    this.swingVel = 0;
    this.trackVel = [0, 0];
    this.load = 0;
    this.relief = 0;
    this.moving = false;
    this.travelling = false;
    this.stability = 1;
    this.tilt = { kind: null, angle: 0 };
    this.overturned = false;
    this.bucketLoad = 0;
    this.cmds = {};

    this.obstacles = [];
    this.listeners = {};
    this._cool = {};
    this._q = new THREE.Quaternion();
    this._tmp = new THREE.Vector3();
  }

  // ── 事件 ──────────────────────────────────────────────────────────────
  on(evt, fn) {
    (this.listeners[evt] ||= []).push(fn);
  }
  emit(evt, data, cooldown = 0) {
    if (cooldown > 0) {
      const t = this._cool[evt] ?? -1e9;
      if (this.time - t < cooldown) return;
      this._cool[evt] = this.time;
    }
    for (const f of this.listeners[evt] || []) f(data);
    for (const f of this.listeners['*'] || []) f(evt, data);
  }
  /** 违规扣分(由 game 按规则表处理) */
  violate(code, cooldown = 6) {
    const k = 'v:' + code;
    const t = this._cool[k] ?? -1e9;
    if (this.time - t < cooldown) return;
    this._cool[k] = this.time;
    this.emit('penalty', { code, cooldown: 0 });
  }
  /** 给新手的提示(不扣分) */
  hint(id, text, why, cooldown = 8) {
    const k = 'h:' + id;
    const t = this._cool[k] ?? -1e9;
    if (this.time - t < cooldown) return;
    this._cool[k] = this.time;
    this.emit('info', { text, why });
  }

  // ── 开关 ──────────────────────────────────────────────────────────────
  get running() {
    return this.engine === 'running';
  }
  get power() {
    return this.key !== 'off';
  }
  /** 起动条件(子类覆盖):返回 null = 可以起动,否则返回原因 */
  startBlockReason() {
    return null;
  }
  keyToggle() {
    if (this.key === 'off') {
      this.key = 'on';
      this.selfTest = 1.4;
      this.emit('key', 'on');
    } else {
      if (this.engine === 'running' && this.rpm > this.cfg.idleRpm + 300) this.emit('hotShutdown');
      this.key = 'off';
      this.engine = 'off';
      this.emit('key', 'off');
    }
  }
  keyStart(held) {
    if (held && this.key === 'on' && this.engine !== 'running') {
      const why = this.startBlockReason();
      if (why) {
        this.emit('info', { text: why.text, why: why.why });
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
  startEngineNow() {
    this.key = 'on';
    this.engine = 'running';
    this.rpm = this.cfg.idleRpm;
    this.coolant = Math.max(this.coolant, 70);
    this.selfTest = 0;
  }
  stopEngineNow() {
    this.key = 'off';
    this.engine = 'off';
    this.rpm = 0;
  }
  setHorn(v) {
    if (v && !this.horn && this.key !== 'off') {
      this.lastHorn = this.time;
      this.emit('horn');
    }
    this.horn = v && this.key !== 'off';
  }
  toggleLights() {
    this.lights = !this.lights;
  }
  toggleParkBrake() {
    this.parkBrake = !this.parkBrake;
    this.emit('parkBrake', this.parkBrake);
  }

  /** 发动机:起动机带转 → 着车 → 转速追目标 */
  _updateEngine(dt, target, load = 0) {
    if (this.selfTest > 0) this.selfTest = Math.max(0, this.selfTest - dt);
    if (this.engine === 'crank') {
      this.crankT += dt;
      this.rpm += (220 - this.rpm) * Math.min(1, dt * 8);
      if (this.crankT > 8) this.emit('crankTooLong', null, 5);
      if (this.crankT >= (this.cfg.crankTime ?? 1.0)) {
        this.engine = 'running';
        this.emit('started', { cold: this.coolant < 40 });
      }
    } else if (this.engine === 'running') {
      target -= load * 120;
      this.rpm += (target - this.rpm) * Math.min(1, dt * (target > this.rpm ? 2.4 : 3));
      this.coolant += ((86 + load * 6 - this.coolant) * 0.018 + load * 0.02) * dt * 3;
      this.fuel = Math.max(0, this.fuel - dt * (this.rpm / this.cfg.maxRpm) * (0.2 + load) * 2e-5);
      this.hours += dt / 3600;
    } else {
      this.rpm += (0 - this.rpm) * Math.min(1, dt * 2.5);
      if (this.rpm < 5) this.rpm = 0;
    }
  }

  // ── 位置 ──────────────────────────────────────────────────────────────
  placeAt(x, z, heading = 0) {
    this.position.set(x, 0, z);
    this.heading = heading;
    this.speed = 0;
    this.tilt.kind = null;
    this.tilt.angle = 0;
    this.overturned = false;
    this.resetMotion?.();
    this.syncTerrain(true);
  }

  /** 世界点逐个去碰障碍物,返回第一个 { obstacle, kind, point } */
  hitTest(points, part) {
    for (const p of points) {
      for (const o of this.obstacles) {
        const r = o.hit(p, part, this);
        if (r) return { obstacle: o, kind: r, point: p };
      }
    }
    return null;
  }

  /** 把根节点摆到 position / heading / pitch / roll(加上倾翻) */
  _applyRoot(extra = null) {
    const r = this.model.root;
    const q = this._q.setFromAxisAngle(_Y, this.heading);
    q.multiply(_qa.setFromAxisAngle(_Z, this.pitch)).multiply(_qa.setFromAxisAngle(_X, this.roll));
    r.position.copy(this.position);
    r.quaternion.copy(q);
    if (extra) extra(r);
    r.updateMatrixWorld(true);
  }

  /** 给仪表 / HUD 的通用状态 */
  baseStatus() {
    return {
      power: this.power,
      running: this.running,
      selfTest: this.selfTest > 0,
      rpm: this.rpm,
      fuel: this.fuel,
      hours: this.hours,
      coolant: clamp((this.coolant - 30) / 80, 0, 1),
      coolantC: this.coolant,
      lights: this.lights,
      parkBrake: this.parkBrake,
      speed: this.speed,
    };
  }
}

const _Y = new THREE.Vector3(0, 1, 0);
const _Z = new THREE.Vector3(0, 0, 1);
const _X = new THREE.Vector3(1, 0, 0);
const _qa = new THREE.Quaternion();

/**
 * 铰接车(装载机、压路机)的平面运动学。
 *   s: { x, z, heading(后车架), gamma(铰接角,左转为正) }
 *   v:后桥中心沿后车架方向的速度;dGamma:铰接角速度;lf/lr:前/后桥到铰点的距离
 * 无侧滑条件下:θr' = (v·sinγ + lf·γ') / (lr·cosγ + lf)
 * 所以原地打方向时前后两半都会摆 —— 真车就是这样,方向盘一打车头车尾一起"扭"。
 * 返回前桥中心走过的路程(带符号),给前轮/钢轮转动用。
 */
export function articulatedStep(s, v, dGamma, lf, lr, dt) {
  const g = s.gamma;
  const dTh = (v * Math.sin(g) + lf * dGamma) / (lr * Math.cos(g) + lf);
  // 后桥中心 → 铰点 → 前桥中心
  const rx = s.x - Math.cos(s.heading) * lr;
  const rz = s.z + Math.sin(s.heading) * lr;
  const fx0 = s.x + Math.cos(s.heading + g) * lf;
  const fz0 = s.z - Math.sin(s.heading + g) * lf;
  const nrx = rx + Math.cos(s.heading) * v * dt;
  const nrz = rz - Math.sin(s.heading) * v * dt;
  s.heading += dTh * dt;
  s.gamma = g + dGamma * dt;
  s.x = nrx + Math.cos(s.heading) * lr;
  s.z = nrz - Math.sin(s.heading) * lr;
  const fx1 = s.x + Math.cos(s.heading + s.gamma) * lf;
  const fz1 = s.z - Math.sin(s.heading + s.gamma) * lf;
  const df = Math.hypot(fx1 - fx0, fz1 - fz0);
  // 前桥沿前车架方向走的分量定符号
  const dirF = (fx1 - fx0) * Math.cos(s.heading + s.gamma) - (fz1 - fz0) * Math.sin(s.heading + s.gamma);
  return { front: Math.sign(dirF) * df, rear: v * dt, dHeading: dTh };
}

/** 局部点(相对铰点,后车架系)→ 世界水平坐标 */
export function localToWorldXZ(x0, z0, heading, lx, lz) {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  return [x0 + lx * c + lz * s, z0 - lx * s + lz * c];
}
