/**
 * 剪叉式高空作业平台仿真。电动的:没有发动机,钥匙打开就是"通电",急停按钮按下全部断电。
 *
 * 平台控制盒和真机一样:一根手柄 + 选择开关(行走 / 举升)—— 手柄前后推是行走还是升降,看开关在哪档。
 *   · 收拢状态下行走 ≤ 4 km/h;平台一离开收拢位置就自动降到 0.8 km/h(高位慢速)
 *   · 倾斜传感器:平台升起后,车身横向 > 1.5°、纵向 > 3° 就报警 —— 只许下降,不许再升、不许行走
 *   · 平台升起时两侧防坑洞保护板自动放下
 *   · 下降到约 2 m 处自动停顿 3 秒并鸣响:防止下面的人被剪叉夹到
 *   · 规矩:护栏门没关就升降、平台撞到上方障碍、下降时平台下有人、在倾斜报警状态下硬操作
 */
import * as THREE from 'three';
import { VehicleSim } from './base.js';
import { LiftModel, LIFT, deckHeight, thetaForDeck } from './lift-model.js';
import { clamp } from '../linkage.js';

const DEG = Math.PI / 180;
const STOW = deckHeight(LIFT.thetaMin);
const MAX = deckHeight(LIFT.thetaMax);
const V_STOWED = 1.1; // m/s
const V_HIGH = 0.22;
const UP = 0.3; // m/s 平台上升
const DOWN = 0.38;
const DELAY_H = STOW + 0.9; // 下降停顿高度

export class LiftSim extends VehicleSim {
  constructor(model, terrain) {
    super(model, terrain, { kind: 'lift', idleRpm: 0, maxRpm: 1, crankTime: 0, hours: 412.3 });
    this.theta = LIFT.thetaMin;
    this.ext = 0;
    this.steer = 0;
    this.mode = 'drive';
    this.estop = true;
    this.gateOpen = false;
    this.gateAnim = 0;
    this.guards = 0;
    this.battery = 0.86;
    this.alarm = null;
    this.delayT = 0;
    this.delayDone = false;
    this.liftVel = 0;
    this.controls = { stick: 0, steer: 0 };
    this.workerRule = 'workerZoneV';
    this.resetMotion();
    this.syncTerrain(true);
  }

  get deck() {
    return deckHeight(this.theta);
  }
  get elevated() {
    return this.deck > STOW + 0.25;
  }
  // 电动车:钥匙 ON 且急停拔出 = "运转"
  get running() {
    return this.key !== 'off' && !this.estop && this.battery > 0.02;
  }
  keyToggle() {
    this.key = this.key === 'off' ? 'on' : 'off';
    this.engine = this.key === 'on' ? 'running' : 'off';
    if (this.key === 'on') this.selfTest = 0.8;
    this.emit('key', this.key);
  }
  keyStart() {}
  startEngineNow() {
    this.key = 'on';
    this.engine = 'running';
    this.selfTest = 0;
  }
  stopEngineNow() {
    this.key = 'off';
    this.engine = 'off';
  }
  toggleEstop() {
    this.estop = !this.estop;
    this.emit('estop', this.estop);
  }
  toggleMode() {
    this.mode = this.mode === 'drive' ? 'lift' : 'drive';
  }
  toggleGate() {
    this.gateOpen = !this.gateOpen;
  }
  resetMotion() {
    this.speed = 0;
  }
  resetForScenario() {
    this.key = 'on';
    this.engine = 'running';
    this.estop = false;
    this.mode = 'drive';
    this.theta = LIFT.thetaMin;
    this.ext = 0;
    this.steer = 0;
    this.gateOpen = false;
    this.battery = 0.86;
    this.delayDone = false;
    this.overturned = false;
  }
  /** 一键收回(仅自由练习):降到底、收延伸平台 */
  stow() {
    this.theta = LIFT.thetaMin;
    this.ext = 0;
    this.syncTerrain(true);
  }

  update(dt, raw) {
    this.time += dt;
    if (this.selfTest > 0) this.selfTest = Math.max(0, this.selfTest - dt);
    const live = this.running && !this.overturned;
    const stick = live ? raw.leftY : 0;
    const steerCmd = live && this.mode === 'drive' ? raw.leftX : 0;
    const extCmd = raw.rightX;
    this.controls = { stick: raw.leftY, steer: raw.leftX };
    this.cmds = { swing: 0 };
    const tilted = this._tiltAlarm();
    this.alarm = this.overturned ? '整机倾翻' : tilted ? '倾斜报警' : this.delayT > 0 ? '下降停顿' : null;
    let moved = 0;

    // ── 升降 ──
    const prevTheta = this.theta;
    this.liftVel = 0;
    if (live && this.mode === 'lift' && Math.abs(stick) > 0.05) {
      if (stick > 0 && tilted) {
        this.hint('tiltUp', '倾斜报警:不能再往上升', '车身倾斜超过允许值,控制系统只允许下降。先降下平台,把车开到平整的地面上再升。');
      } else if (stick > 0) {
        if (this.gateOpen) this.violate('lfGateOpen', 10);
        const v = stick * UP;
        this.theta = Math.min(LIFT.thetaMax, this.theta + v / (LIFT.levels * LIFT.armL * Math.cos(this.theta)) * dt);
        this.liftVel = v;
      } else {
        // 下降停顿:经过 2 m 左右停 3 秒并鸣响
        const before = this.deck;
        if (this.delayT > 0) {
          this.delayT -= dt;
        } else {
          const v = stick * DOWN;
          this.theta = Math.max(LIFT.thetaMin, this.theta + v / (LIFT.levels * LIFT.armL * Math.cos(this.theta)) * dt);
          this.liftVel = v;
          if (!this.delayDone && before > DELAY_H && this.deck <= DELAY_H) {
            this.theta = thetaForDeck(DELAY_H);
            this.delayT = 3;
            this.delayDone = true;
          }
        }
      }
    } else if (this.delayT > 0 && Math.abs(stick) < 0.05) {
      // 松开手柄就不算停顿时间
    }
    if (this.deck > DELAY_H + 0.3) this.delayDone = false;
    if (this.theta !== prevTheta) moved += Math.abs(this.theta - prevTheta) * 20;

    // ── 延伸平台(手推,任何时候都能动)──
    if (Math.abs(extCmd) > 0.05) this.ext = clamp(this.ext + extCmd * 0.3 * dt, 0, LIFT.extMax);

    // ── 行走 ──
    const vmax = this.elevated ? V_HIGH : V_STOWED;
    let want = 0;
    if (live && this.mode === 'drive' && Math.abs(stick) > 0.05) {
      if (tilted) this.hint('tiltDrive', '倾斜报警:不能行走', '平台升起状态下车身倾斜超限,行走被锁止。先把平台降到底。');
      else {
        want = stick * vmax;
        if (this.gateOpen) this.violate('lfGateOpen', 10);
      }
    }
    const acc = Math.abs(want) > Math.abs(this.speed) && Math.sign(want || 1) === Math.sign(this.speed || want) ? 0.8 : 2.2;
    this.speed += clamp(want - this.speed, -acc * dt, acc * dt);
    if (Math.abs(this.speed) < 0.005 && want === 0) this.speed = 0;
    this.steer = clamp(this.steer - steerCmd * 0.7 * dt, -0.55, 0.55);
    const save = { pos: this.position.clone(), heading: this.heading };
    if (this.speed !== 0) {
      const wb = LIFT.wheelbase;
      const dH = (this.speed * Math.tan(this.steer)) / wb;
      const rx = this.position.x - Math.cos(this.heading) * wb / 2;
      const rz = this.position.z + Math.sin(this.heading) * wb / 2;
      const nrx = rx + Math.cos(this.heading) * this.speed * dt;
      const nrz = rz - Math.sin(this.heading) * this.speed * dt;
      this.heading += dH * dt;
      this.position.x = nrx + Math.cos(this.heading) * wb / 2;
      this.position.z = nrz - Math.sin(this.heading) * wb / 2;
      this.model.roll((this.speed * dt) / Math.max(0.6, Math.cos(this.steer)), this.speed * dt);
      moved += Math.abs(this.speed);
    }
    this.yawRate = 0;

    // 门和防坑洞板的动画
    this.gateAnim += ((this.gateOpen ? 1 : 0) - this.gateAnim) * Math.min(1, dt * 6);
    this.guards += ((this.elevated ? 1 : 0) - this.guards) * Math.min(1, dt * 3);
    this.syncTerrain(false, dt);
    this._stability(dt);
    this._collide(prevTheta, save);

    // 电量
    this.battery = Math.max(0, this.battery - dt * (0.00002 + Math.abs(this.speed) * 0.00008 + Math.abs(this.liftVel) * 0.0003));
    const wasTravelling = this.travelling;
    this.travelling = Math.abs(this.speed) > 0.03;
    if (this.travelling && !wasTravelling) {
      if (this.time - this.lastHorn > 8 && this.time - (this.lastTravelStop ?? -99) > 15) this.emit('noHorn');
    }
    if (!this.travelling && wasTravelling) this.lastTravelStop = this.time;
    this.moving = moved > 0.01 || this.travelling;
    this.load = clamp(Math.abs(this.liftVel) * 2 + Math.abs(this.speed) * 0.5, 0, 1);
  }

  /** 倾斜报警只在平台升起后才起作用(收拢状态可以在坡上走) */
  _tiltAlarm() {
    if (!this.elevated) return false;
    const r = Math.abs(this.roll);
    const p = Math.abs(this.pitch);
    const on = r > 1.5 * DEG || p > 3 * DEG;
    if (on && !this._tiltWas) this.violate('lfTilt', 15);
    this._tiltWas = on;
    return on;
  }

  _stability(dt) {
    // 重心高度随平台升高;横向翻倒边 = 轮距一半(防坑洞板放下时多 6 cm)
    const hCog = 0.55 + (this.deck - STOW) * 0.45 + 0.4;
    const edge = LIFT.track / 2 + 0.05 + this.guards * 0.06;
    const lat = Math.abs(Math.tan(this.roll)) * hCog + (this.ext / LIFT.extMax) * 0.02;
    const lon = Math.abs(Math.tan(this.pitch)) * hCog;
    const m = Math.min(edge - lat, LIFT.wheelbase / 2 + 0.2 - lon - (this.ext * 0.4) / 2);
    this.stability = clamp(m / 0.5, -1, 1);
    const T = this.tilt;
    if (m < 0 && !this.overturned) {
      T.kind = 'tip';
      T.side = this.roll > 0 ? -1 : 1;
      T.angle = Math.min(1.4, T.angle + dt * (0.3 + T.angle * 2));
      if (T.angle > 0.25) {
        this.overturned = true;
        this.violate('lfOverturn', 0);
      }
    } else if (this.overturned) T.angle = Math.min(1.45, T.angle + dt * 0.9);
  }

  _collide(prevTheta, save) {
    if (!this.obstacles.length) return;
    const P = this.model.plat;
    const H = LIFT.railH;
    const hx = LIFT.platL / 2;
    const hw = LIFT.platW / 2;
    const e = this.ext;
    // 护栏顶四角、上横杆中点、延伸平台前端、操作员头顶
    const local = [
      [-hx, H, -hw],
      [-hx, H, hw],
      [hx + e, H, -hw],
      [hx + e, H, hw],
      [0, H, -hw],
      [0, H, hw],
      [hx + e, H, 0],
      [hx + e, 0.1, 0],
      [-0.22, 1.95, -0.3],
      [0.5, 1.2, 0],
    ];
    const pts = local.map(([x, y, z]) => new THREE.Vector3(x, y, z).applyMatrix4(P.matrixWorld));
    // 底盘四角(行走时)
    if (this.travelling) {
      const r = this.model.root.matrixWorld;
      for (const [x, z] of [
        [1.25, 0.55],
        [1.25, -0.55],
        [-1.25, 0.55],
        [-1.25, -0.55],
      ])
        pts.push(new THREE.Vector3(x, 0.3, z).applyMatrix4(r));
    }
    const hit = this.hitTest(pts, 'platform');
    if (hit && hit.kind === 'block') {
      const up = this.theta > prevTheta;
      this.theta = prevTheta;
      if (this.travelling) {
        this.position.copy(save.pos);
        this.heading = save.heading;
      }
      this.speed = 0;
      this.syncTerrain(true);
      if (up || hit.obstacle.kind === 'beam') this.violate('lfCrush', 4);
      this.emit('hit', { obstacle: hit.obstacle, impact: 0.6 }, 1.2);
    } else if (hit && hit.kind === 'knock') this.emit('knock', { obstacle: hit.obstacle });
  }

  /** 下降时平台正下方 / 底盘旁边有人 */
  checkWorkers(workers) {
    if (this.liftVel >= 0) return;
    const ch = Math.cos(this.heading);
    const sh = Math.sin(this.heading);
    for (const w of workers) {
      if (!w.active) continue;
      const dx = w.position.x - this.position.x;
      const dz = w.position.z - this.position.z;
      const lx = dx * ch - dz * sh;
      const lz = dx * sh + dz * ch;
      if (Math.abs(lx) < LIFT.platL / 2 + 0.6 + this.ext && Math.abs(lz) < LIFT.platW / 2 + 0.6) this.violate('lfLowerOnPerson', 8);
    }
  }
  dangerRadius() {
    return 2.6;
  }
  get workerAlert() {
    return '⚠ 有人靠近升降平台 —— 停止升降和行走,鸣笛示意!';
  }

  // ── 贴地:四个轮子 ────────────────────────────────────────────────────
  syncTerrain(snap, dt = 0.016) {
    const T = this.terrain;
    const ch = Math.cos(this.heading);
    const sh = Math.sin(this.heading);
    const ht = (lx, lz) => T.heightAt(this.position.x + lx * ch + lz * sh, this.position.z - lx * sh + lz * ch);
    const hb = LIFT.wheelbase / 2;
    const tw = LIFT.track / 2;
    const fl = ht(hb, -tw);
    const fr = ht(hb, tw);
    const rl = ht(-hb, -tw);
    const rr = ht(-hb, tw);
    const pitch = Math.atan2((fl + fr) / 2 - (rl + rr) / 2, LIFT.wheelbase);
    const roll = Math.atan2((fl + rl) / 2 - (fr + rr) / 2, LIFT.track);
    const y = (fl + fr + rl + rr) / 4;
    const k = snap ? 1 : Math.min(1, dt * 8);
    this.position.y += (y - this.position.y) * k;
    this.pitch += (pitch - this.pitch) * k;
    this.roll += (roll - this.roll) * k;
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
    this.model.setPose({ theta: this.theta, ext: this.ext, steer: this.steer, gate: this.gateAnim, guards: this.guards });
    this.model.root.updateMatrixWorld(true);
  }

  // ── 给界面 ────────────────────────────────────────────────────────────
  status() {
    return {
      power: this.key !== 'off',
      running: this.running,
      estop: this.estop,
      moving: this.moving,
      alarm: !!this.alarm,
      lights: this.lights,
    };
  }
  /** 平台底板离地(世界,算上地形) */
  deckWorldY() {
    const p = new THREE.Vector3(0, 0, 0).applyMatrix4(this.model.plat.matrixWorld);
    return p.y;
  }
  soundParams() {
    return {
      rpm: 0,
      load: 0,
      hyd: Math.abs(this.liftVel) > 0 ? 0.6 : 0,
      relief: 0,
      travel: clamp(Math.abs(this.speed) / 1.1, 0, 1) * 0.15,
      clank: false,
      crank: false,
      running: false,
      horn: this.horn,
      motor: this.running ? clamp(Math.abs(this.speed) / 1.1 + Math.abs(this.liftVel) * 2.5, 0, 1) : 0,
      // 行走/升降报警:动就"嘀嘀";倾斜报警或下降停顿时连续急促
      travelAlarm: this.moving && this.running,
      warn: !!this.alarm && this.running,
    };
  }
}

export function createLift(M, terrain) {
  const model = new LiftModel(M);
  const sim = new LiftSim(model, terrain);
  return { model, sim };
}

export { STOW as LIFT_STOW, MAX as LIFT_MAX };
