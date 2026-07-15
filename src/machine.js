/**
 * 整机仿真状态。手柄 → 流量 → 油缸速度 → 关节角速度 → 姿态。
 *
 * 三个"教学上真正重要"的真实感来源都在这里:
 *   1. 手柄控制的是**流量**,不是角度。同样的手柄行程,在不同姿态下关节转速不一样
 *      —— 因为 dθ/dt = 油缸速度 ÷ |dL/dθ|,而 |dL/dθ| 随姿态变化。新手常觉得
 *      "怎么快到头就变慢了",原因就在这。
 *   2. 上车十几吨重,回转有明显的起停惯量,松手还会滑一段。这是装车对不准的头号原因。
 *   3. 斗里的土会不会撒,取决于**斗口法线还朝不朝上**,不是某个魔法角度。
 */
import * as THREE from 'three';
import { BOOM, ARM, BUCKET, HYDRAULICS as HY, ENGINE, UNDERCARRIAGE as UC } from './config.js';
import { fromArray, cylinderLength, solveBucketLinkage, clamp } from './linkage.js';

const JOINTS = {
  boom: {
    min: BOOM.angleMin,
    max: BOOM.angleMax,
    speed: HY.boomCylSpeed,
    // 动臂油缸:缸底在回转台,杆端在动臂
    L: (a) => cylinderLength(fromArray(BOOM.cyl.base), fromArray(BOOM.foot), fromArray(BOOM.cyl.rod), a),
  },
  arm: {
    min: ARM.angleMin,
    max: ARM.angleMax,
    speed: HY.armCylSpeed,
    // 斗杆油缸:缸底在动臂,杆端在斗杆后凸耳
    L: (a) => cylinderLength(fromArray(ARM.cyl.base), fromArray(BOOM.tip), fromArray(ARM.cyl.rod), a),
  },
  bucket: {
    min: BUCKET.angleMin,
    max: BUCKET.angleMax,
    speed: HY.bucketCylSpeed,
    // 铲斗油缸:经四连杆驱动,长度要解机构才知道
    L: (() => {
      const cfg = { ...BUCKET, armTip: ARM.tip };
      return (a) => {
        const s = solveBucketLinkage(cfg, a);
        return s ? s.cylLength : NaN;
      };
    })(),
  },
};

const MAX_JOINT_RATE = 1.3; // rad/s —— 防止贴近机构死点时算出无穷大角速度

export class Machine {
  constructor(excavator, terrain) {
    this.ex = excavator;
    this.terrain = terrain;

    this.pose = { swing: 0, boom: 0.35, arm: -1.85, bucket: -1.1 };
    this.swingVel = 0;
    this.trackVel = [0, 0]; // 左, 右

    this.heading = 0;
    this.position = new THREE.Vector3(0, 0, 0);
    this.pitch = 0;
    this.roll = 0;

    this.rpm = ENGINE.idleRpm;
    this.load = 0; // 0~1 液压负载率,用来做发动机掉速和音效
    this.bucketLoad = 0; // m³

    this.tipPrev = new THREE.Vector3();
    this.tipSpeed = 0;
    this.digging = false;
    this.spilling = false;

    // 卸料回调:世界坐标 + 体积。world.js 用它来判断是撒在地上还是装进车斗。
    this.onSpill = null;

    this._tmpA = new THREE.Vector3();
    this._tmpB = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._qy = new THREE.Quaternion();
    this._qz = new THREE.Quaternion();
    this._qx = new THREE.Quaternion();

    this.resetPose();
    this.syncTerrain(true);
  }

  resetPose() {
    // 收拢的行进姿态 —— 真机转场时就是这么摆的
    this.pose.boom = 0.28;
    this.pose.arm = -2.0;
    this.pose.bucket = -1.15;
    this.swingVel = 0;
  }

  /** 关节角对应的油缸长度变化率,用中心差分数值求 */
  _dLdTheta(joint, a) {
    const h = 1e-4;
    const j = JOINTS[joint];
    const l1 = j.L(a - h);
    const l2 = j.L(a + h);
    if (!Number.isFinite(l1) || !Number.isFinite(l2)) return null;
    return (l2 - l1) / (2 * h);
  }

  _updateJoint(name, cmd, dt, power) {
    const j = JOINTS[name];
    if (Math.abs(cmd) < 1e-4) return 0;
    const d = this._dLdTheta(name, this.pose[name]);
    if (d === null || Math.abs(d) < 1e-5) return 0;

    // 手柄行程 → 油缸速度(m/s),再按几何换算成角速度
    const cylVel = Math.abs(cmd) * j.speed * power;
    let omega = cylVel / Math.abs(d);
    omega = Math.min(omega, MAX_JOINT_RATE) * Math.sign(cmd);

    const before = this.pose[name];
    this.pose[name] = clamp(before + omega * dt, j.min, j.max);
    return Math.abs(this.pose[name] - before) / Math.max(dt, 1e-5);
  }

  update(dt, cmds, throttle) {
    // ── 发动机:油门定转速,液压负载会把转速拉下去一点 ──
    const target = ENGINE.idleRpm + (ENGINE.maxRpm - ENGINE.idleRpm) * (throttle / ENGINE.throttleSteps);
    const droop = this.load * 180;
    this.rpm += (target - droop - this.rpm) * Math.min(1, dt * 3);
    // 泵的排量跟着转速走,所以低油门时所有动作都慢
    const power = clamp((this.rpm - 500) / (ENGINE.maxRpm - 500), 0.15, 1);

    // ── 工作装置三个关节 ──
    let activity = 0;
    activity += this._updateJoint('boom', cmds.boom, dt, power);
    activity += this._updateJoint('arm', cmds.arm, dt, power);
    activity += this._updateJoint('bucket', cmds.bucket, dt, power);

    // ── 回转:有惯量,不是说停就停 ──
    const swingTarget = cmds.swing * HY.swingSpeed * power;
    const accel = Math.abs(cmds.swing) > 0.02 ? HY.swingAccel : HY.swingBrake;
    const dv = swingTarget - this.swingVel;
    this.swingVel += clamp(dv, -accel * dt, accel * dt);
    if (Math.abs(cmds.swing) < 0.02 && Math.abs(this.swingVel) < 0.01) this.swingVel = 0;
    this.pose.swing += this.swingVel * dt;
    activity += Math.abs(this.swingVel) * 0.6;

    // ── 行走:左右履带各自加减速,差速就能原地转向 ──
    let travelled = [0, 0];
    for (let i = 0; i < 2; i++) {
      const t = (i === 0 ? cmds.trackL : cmds.trackR) * HY.trackSpeed * power;
      this.trackVel[i] += clamp(t - this.trackVel[i], -HY.trackAccel * dt, HY.trackAccel * dt);
      if (Math.abs(t) < 0.02 && Math.abs(this.trackVel[i]) < 0.02) this.trackVel[i] = 0;
      travelled[i] = this.trackVel[i] * dt;
    }
    const [vL, vR] = this.trackVel;
    if (vL || vR) {
      const forward = (vL + vR) / 2;
      // 右履带比左履带快 → 向左转 → heading 增大(整机朝 +X,heading 增大时车头转向 -Z)
      const omega = (vR - vL) / UC.gauge;
      this.heading += omega * dt;
      this.position.x += Math.cos(this.heading) * forward * dt;
      this.position.z += -Math.sin(this.heading) * forward * dt;
      activity += Math.abs(forward) * 0.5;
    }
    // 机器往前走时,着地的履带板相对车身是往后跑的,所以取负
    this.ex.driveTracks(-travelled[0], -travelled[1]);

    this.load = clamp(activity * 0.55 + (this.digging ? 0.5 : 0), 0, 1);

    // ── 把姿态交给模型,再做挖/卸 ──
    this.ex.bucketLoad = this.bucketLoad;
    this.ex.setPose(this.pose);
    this.syncTerrain(false, dt);
    this.ex.root.updateMatrixWorld(true);

    this._digAndSpill(dt);
  }

  /** 整机贴合地形:四个角采高度,定出高度 + 俯仰 + 侧倾 */
  syncTerrain(snap, dt = 0.016) {
    const half = UC.trackLength / 2;
    const g = UC.gauge / 2;
    const ch = Math.cos(this.heading);
    const sh = Math.sin(this.heading);
    // 局部 (x, z) → 世界
    const sample = (lx, lz) => {
      const wx = this.position.x + lx * ch + lz * sh;
      const wz = this.position.z + -lx * sh + lz * ch;
      return this.terrain.heightAt(wx, wz);
    };
    const fl = sample(half, -g);
    const fr = sample(half, g);
    const rl = sample(-half, -g);
    const rr = sample(-half, g);

    const y = (fl + fr + rl + rr) / 4;
    // 车头高 → 抬头 → 绕 +Z 正转
    const pitch = Math.atan2((fl + fr) / 2 - (rl + rr) / 2, UC.trackLength);
    // 左边高 → 向右倒 → 绕 +X 正转
    const roll = Math.atan2((fl + rl) / 2 - (fr + rr) / 2, UC.gauge);

    const k = snap ? 1 : Math.min(1, dt * 6);
    this.position.y += (y - this.position.y) * k;
    this.pitch += (pitch - this.pitch) * k;
    this.roll += (roll - this.roll) * k;

    this.ex.root.position.copy(this.position);
    this._qy.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.heading);
    this._qz.setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.pitch);
    this._qx.setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.roll);
    this.ex.root.quaternion.copy(this._qy).multiply(this._qz).multiply(this._qx);
  }

  /** 斗口法线的竖直分量。1 = 斗口朝正上,土最稳;掉到 0 以下土肯定全撒了。 */
  mouthUp() {
    // 斗体在世界里的总转角 = 各关节角之和(回转是绕 Y 的,不影响这个平面内的姿态)
    const total = this.pose.boom + this.pose.arm + this.pose.bucket + BUCKET.mouthNormal;
    return Math.sin(total);
  }

  _digAndSpill(dt) {
    const [a, b] = this.ex.getCuttingEdge(this._tmpA, this._tmpB);
    const tip = this._tmpA.clone().lerp(this._tmpB, 0.5);
    this.tipSpeed = this.tipPrev.lengthSq() ? tip.distanceTo(this.tipPrev) / Math.max(dt, 1e-5) : 0;
    this.tipPrev.copy(tip);

    this.digging = false;
    this.spilling = false;

    const ground = this.terrain.heightAt(tip.x, tip.z);
    const remaining = BUCKET.capacity - this.bucketLoad;

    // ── 挖:齿尖扎进土里、而且斗子在动,才切得动 ──
    if (tip.y < ground && remaining > 1e-4 && this.tipSpeed > 0.06) {
      // 切削量正比于齿尖走过的路程 —— 光把斗子按在土里不动是装不满的
      const eff = Math.min(1, this.tipSpeed / 0.5);
      const got = this.terrain.dig(a, b, tip.y, remaining, dt * eff);
      if (got > 0) {
        this.bucketLoad += got;
        this.digging = true;
      }
    }

    // ── 撒:斗口翻过头,土就往外掉 ──
    if (this.bucketLoad > 1e-4) {
      const up = this.mouthUp();
      if (up < BUCKET.spillCos) {
        // 翻得越过分,撒得越快
        const rate = clamp((BUCKET.spillCos - up) * 2.2, 0, 1.6);
        const out = Math.min(this.bucketLoad, rate * dt);
        this.bucketLoad -= out;
        this.spilling = true;
        if (this.onSpill) this.onSpill(tip, out);
        else this.terrain.deposit(tip.x, tip.z, out);
      }
    }
    this.terrain.flush();
  }
}
