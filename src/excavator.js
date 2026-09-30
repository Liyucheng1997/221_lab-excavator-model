/**
 * 挖掘机三维模型 + 运动学装配。
 *
 * 层级(和真机的运动链一致):
 *   root ──── 整机在世界里的位置 / 车头朝向 / 随地形的俯仰侧倾
 *    ├─ chassis ──── 行走装置(不随回转转)
 *    └─ swing ────── 回转平台(绕 Y 轴转)
 *         ├─ 平台 / 配重 / 发动机舱 / 驾驶室(含内饰)
 *         ├─ 动臂油缸 ×2 + 软管  ← 缸底固定在回转平台上
 *         └─ boomPivot (绕 Z 转 boomAngle)
 *              ├─ 动臂 + 钢管、斗杆油缸 + 软管、跨臂头的铲斗软管
 *              └─ armPivot (绕 Z 转 armAngle)
 *                   ├─ 斗杆、铲斗油缸、摇臂、H 连杆
 *                   └─ bucketPivot (绕 Z 转 bucketAngle)
 *                        └─ 铲斗 + 斗齿 + 斗内的土
 */
import * as THREE from 'three';
import { UPPER, BOOM, ARM, BUCKET, bucketLocal } from './config.js';
import { fromArray, xform, dir, sub, solveBucketLinkage, clamp } from './linkage.js';
import { Undercarriage } from './model/undercarriage.js';
import { buildUpper } from './model/upper.js';
import { buildCab, drawMonitor } from './model/cab.js';
import { buildFront } from './model/front.js';

const _v = new THREE.Vector3();
const _d0 = new THREE.Vector3();
const _d1 = new THREE.Vector3();
const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();

export class Excavator {
  constructor(M) {
    this.M = M;
    this.root = new THREE.Group();
    this.under = new Undercarriage(M);
    this.chassis = this.under.group;
    this.swing = new THREE.Group();
    this.root.add(this.chassis, this.swing);

    this.upper = buildUpper(M, this.swing);
    this.cabParts = buildCab(M, this.swing);
    this.cab = this.cabParts.group;
    this.front = buildFront(M, this.swing);
    Object.assign(this, {
      boomPivot: this.front.boomPivot,
      armPivot: this.front.armPivot,
      bucketPivot: this.front.bucketPivot,
    });

    this._bucketCfg = { ...BUCKET, armTip: ARM.tip };
    this.pose = { swing: 0, boom: 0, arm: -1.6, bucket: -0.6 };
    this.bucketLoad = 0;

    // 铲斗碰撞采样点(铲斗局部系):外轮廓 × 左中右三列 + 齿尖
    this.bucketSamples = [];
    const W = BUCKET.width / 2 - 0.05;
    for (const p of BUCKET.design.outer) {
      const [x, y] = bucketLocal(p);
      for (const z of [-W, 0, W]) this.bucketSamples.push(new THREE.Vector3(x, y, z));
    }
    this.toothSamples = [];
    for (const z of [-W, 0, W]) this.toothSamples.push(new THREE.Vector3(BUCKET.tip[0], BUCKET.tip[1], z));

    // 工作灯(晚上才开)
    this.lights = [];
    this._beaconT = 0;
    this._monT = 0;
  }

  /**
   * pose: { swing, boom, arm, bucket } 弧度
   * 所有油缸、连杆、软管的位置都由这四个角推出来。
   */
  setPose(pose) {
    this.pose = pose;
    const F = this.front;
    this.swing.rotation.y = pose.swing;
    F.boomPivot.rotation.z = pose.boom;
    F.armPivot.rotation.z = pose.arm;
    F.bucketPivot.rotation.z = pose.bucket;

    // 动臂油缸:缸底在回转台,杆端在动臂上
    const boomBase = fromArray(BOOM.cyl.base);
    const boomRod = xform(fromArray(BOOM.foot), pose.boom, fromArray(BOOM.cyl.rod));
    for (const c of F.boomCyls) c.update(boomBase, boomRod);

    // 斗杆油缸:缸底在动臂,杆端在斗杆后凸耳
    const armRod = xform(fromArray(BOOM.tip), pose.arm, fromArray(ARM.cyl.rod));
    F.armCyl.update(fromArray(ARM.cyl.base), armRod);

    // 铲斗四连杆:全在斗杆局部系里解
    const bk = solveBucketLinkage(this._bucketCfg, pose.bucket);
    if (bk) {
      F.bucketCyl.update(bk.cylBase, bk.H);
      const pa = dir(sub(bk.H, bk.Ph));
      for (const m of F.powerLinks) {
        m.position.x = bk.Ph.x;
        m.position.y = bk.Ph.y;
        m.rotation.z = pa;
      }
      F.idlerLink.position.set(bk.H.x, bk.H.y, 0);
      F.idlerLink.rotation.z = dir(sub(bk.Pb, bk.H));
      F.hPin.position.set(bk.H.x, bk.H.y, 0);
    }

    this._updateHoses();
    F.soil.set(clamp(this.bucketLoad / BUCKET.capacity, 0, 1.25));
  }

  _updateHoses() {
    const F = this.front;
    // 油缸"上方"方向 = 缸体局部 +Y 在父系里的方向
    const cylUp = (c, out) => out.set(-Math.sin(c.group.rotation.z), Math.cos(c.group.rotation.z), 0);

    // 动臂缸:平台上的硬管口
    for (const h of F.boomHoses) {
      const c = h.cyl;
      const z = c.z + (c.z < 0 ? -0.06 : 0.06);
      if (h.which === 'base') {
        _p0.set(BOOM.cyl.base[0] - 0.35, UPPER.deckY + 0.05, z);
        _d0.set(0.6, 0.8, 0).normalize();
      } else {
        _p0.set(BOOM.cyl.base[0] - 0.5, UPPER.deckY + 0.12, z);
        _d0.set(0.3, 1, 0).normalize();
      }
      c.portInParent(h.which, _p1);
      _p1.z = z;
      cylUp(c, _d1);
      h.hose.update(_p0, _d0, _p1, _d1);
    }
    // 斗杆缸:动臂钢管 → 缸口
    for (const h of F.armHoses) {
      _p0.set(...h.from);
      _d0.set(0.8, 0.6, 0).normalize();
      F.armCyl.portInParent(h.which, _p1);
      _p1.z = h.from[2] * 0.6;
      cylUp(F.armCyl, _d1);
      h.hose.update(_p0, _d0, _p1, _d1);
    }
    // 铲斗缸主管:跨过臂头,从动臂末端钢管到斗杆上的钢管
    const a = this.pose.arm;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (const h of F.bucketHoses) {
      _p0.set(...h.from);
      _d0.set(1, -0.25, 0).normalize();
      const [x, y, z] = h.to;
      _p1.set(BOOM.tip[0] + x * ca - y * sa, BOOM.tip[1] + x * sa + y * ca, z);
      _d1.set(-ca, -sa, 0);
      h.hose.update(_p0, _d0, _p1, _d1);
    }
    for (const h of F.bucketCylHoses) {
      _p0.set(...h.from);
      _d0.set(1, 0.1, 0).normalize();
      F.bucketCyl.portInParent(h.which, _p1);
      _p1.z = h.from[2];
      cylUp(F.bucketCyl, _d1);
      h.hose.update(_p0, _d0, _p1, _d1);
    }
  }

  /**
   * 驾驶室里各操纵件的摆动(纯视觉)。
   * c: { left:{x,y}, right:{x,y}, trackL, trackR, locked, throttle(1..10), key('off'|'on'|'start') }
   */
  setControls(c) {
    const P = this.cabParts;
    const stick = (pivot, v) => {
      // 前推(y>0)= 手柄顶端往前(+X)倒 = 绕 Z 负转;右推(x>0)= 往 +Z 倒 = 绕 X 正转
      pivot.rotation.z = -v.y * 0.35;
      pivot.rotation.x = v.x * 0.35;
    };
    stick(P.sticks[0], c.left);
    stick(P.sticks[1], c.right);
    P.travelLevers[0].rotation.z = -c.trackL * 0.3;
    P.travelLevers[1].rotation.z = -c.trackR * 0.3;
    // 锁杆:抬起 = 锁定
    const tgt = c.locked ? 1.05 : 0;
    P.lockLever.rotation.z += (tgt - P.lockLever.rotation.z) * 0.25;
    P.throttleKnob.rotation.y = -((c.throttle - 1) / 9) * Math.PI * 1.4 + 0.7;
    P.key.rotation.y = c.key === 'off' ? 0 : c.key === 'on' ? -0.8 : -1.3;
  }

  /** 每帧的附属效果:警示灯、工作灯、仪表屏 */
  updateFx(dt, s) {
    // 警示灯:发动机运转时旋转闪烁
    const B = this.upper.beacon;
    if (s.running) {
      this._beaconT += dt;
      B.refl.rotation.y = this._beaconT * 7;
      const k = 0.5 + 0.5 * Math.sin(this._beaconT * 14);
      this.M.beacon.emissive.setRGB(1.0 * k, 0.45 * k, 0.0);
    } else {
      this.M.beacon.emissive.setRGB(0, 0, 0);
    }
    this.M.lightLens.emissive.setRGB(s.lights ? 1 : 0, s.lights ? 0.95 : 0, s.lights ? 0.8 : 0);
    this.M.tailLight.emissive.setRGB(s.power ? 0.5 : 0.1, 0, 0);

    this._monT -= dt;
    if (this._monT <= 0) {
      this._monT = 0.2;
      drawMonitor(this.cabParts.monitor, s);
    }
  }

  /** 履带推进(米)。左右分开,所以能原地转向。 */
  driveTracks(leftDist, rightDist) {
    this.under.drive(leftDist, rightDist);
  }

  /** 斗齿尖中点(世界坐标) */
  getTipWorld(target = new THREE.Vector3()) {
    target.set(BUCKET.tip[0], BUCKET.tip[1], 0);
    return this.bucketPivot.localToWorld(target);
  }

  /** 斗齿刃口的两个端点(世界坐标)—— 挖掘时按这条线取土 */
  getCuttingEdge(a = new THREE.Vector3(), b = new THREE.Vector3()) {
    a.set(BUCKET.tip[0], BUCKET.tip[1], -BUCKET.width / 2 + 0.08);
    b.set(BUCKET.tip[0], BUCKET.tip[1], BUCKET.width / 2 - 0.08);
    this.bucketPivot.localToWorld(a);
    this.bucketPivot.localToWorld(b);
    return [a, b];
  }

  /** 铲斗外壳采样点的世界坐标(复用数组) */
  bucketWorldPoints(out = []) {
    const pts = this.bucketSamples;
    for (let i = 0; i < pts.length; i++) {
      out[i] = (out[i] || new THREE.Vector3()).copy(pts[i]);
      this.bucketPivot.localToWorld(out[i]);
    }
    out.length = pts.length;
    return out;
  }

  /** 操作员视点(世界坐标与朝向) */
  getEye(pos, quat) {
    this.cabParts.eye.getWorldPosition(pos);
    this.cab.getWorldQuaternion(quat);
    return pos;
  }

  /** 第一人称时把操作员藏起来,免得看到自己的脑袋 */
  setOperatorVisible(v) {
    this.cabParts.operator.visible = v;
  }

  exhaustWorld(out = new THREE.Vector3()) {
    out.copy(this.upper.exhaustTip);
    return this.swing.localToWorld(out);
  }
}


