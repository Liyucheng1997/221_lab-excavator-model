/**
 * 挖掘机三维模型 + 运动学装配。
 *
 * 层级(和真机的运动链一致):
 *   root ──── 整机在世界里的位置 / 车头朝向 / 随地形的俯仰侧倾
 *    ├─ chassis ──── 履带底盘(不随回转转)
 *    └─ swing ────── 回转平台(绕 Y 轴转)
 *         ├─ 平台 / 配重 / 发动机罩 / 驾驶室
 *         ├─ 动臂油缸 ×2   ← 缸底固定在回转平台上,所以挂在这一层
 *         └─ boomPivot (绕 Z 转 boomAngle)
 *              ├─ 动臂
 *              ├─ 斗杆油缸 ×1  ← 缸底固定在动臂上
 *              └─ armPivot (绕 Z 转 armAngle)
 *                   ├─ 斗杆
 *                   ├─ 铲斗油缸 + 摇臂 + 连杆  ← 都在斗杆局部系里算
 *                   └─ bucketPivot (绕 Z 转 bucketAngle)
 *                        └─ 铲斗 + 斗齿 + 斗内的土
 *
 * 每根油缸都挂在"缸底固定不动"的那一层里,于是两端铰点都能用 linkage.js 的二维数学直接算出来。
 */
import * as THREE from 'three';
import { UNDERCARRIAGE as UC, UPPER, BOOM, ARM, BUCKET } from './config.js';
import {
  fromArray,
  xform,
  dist,
  dir,
  sub,
  cylinderLength,
  solveBucketLinkage,
  clamp,
  lerp,
} from './linkage.js';

// ── 几何小工具 ─────────────────────────────────────────────────────────

/** 单位长度的圆柱:从原点沿 +X 伸出 1。之后用 scale.x 拉伸,不必每帧重建几何。 */
function unitCylX(radius, seg = 16) {
  const g = new THREE.CylinderGeometry(radius, radius, 1, seg);
  g.translate(0, 0.5, 0);
  g.rotateZ(-Math.PI / 2);
  return g;
}

/** 沿 Z 轴的圆柱 —— 用来做销轴 */
function cylZ(radius, length, seg = 14) {
  const g = new THREE.CylinderGeometry(radius, radius, length, seg);
  g.rotateX(Math.PI / 2);
  return g;
}

function shapeFromPoints(pts) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return s;
}

function extrude(shape, depth, bevel = 0.025) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 2,
    curveSegments: 12,
  });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  return g;
}

// ── 液压油缸 ───────────────────────────────────────────────────────────

/**
 * 一根油缸:缸筒长度固定,活塞杆随两端铰点距离伸缩。
 * 整个组件平放在父级的 XY 平面里(z 只用来做成对布置的左右偏移)。
 */
class HydraulicCylinder {
  constructor(mats, { barrelR, rodR }, barrelLen, z = 0) {
    this.z = z;
    this.barrelLen = barrelLen;
    this.group = new THREE.Group();

    const barrel = new THREE.Mesh(unitCylX(barrelR), mats.barrel);
    barrel.scale.x = barrelLen;
    barrel.castShadow = true;
    this.group.add(barrel);

    // 缸头压盖:缸筒末端那一圈略粗的法兰
    const gland = new THREE.Mesh(unitCylX(barrelR * 1.14, 16), mats.steelDark);
    gland.scale.x = 0.09;
    gland.position.x = barrelLen - 0.09;
    this.group.add(gland);

    // 活塞杆:镀铬亮面。画满全长,前半段被缸筒挡住,正好模拟"缩进去"。
    this.rod = new THREE.Mesh(unitCylX(rodR, 12), mats.rod);
    this.rod.castShadow = true;
    this.group.add(this.rod);

    // 两端的耳环 + 销轴
    const eye = (x) => {
      const m = new THREE.Mesh(cylZ(barrelR * 0.95, barrelR * 1.5), mats.steelDark);
      m.position.x = x;
      this.group.add(m);
      return m;
    };
    eye(0);
    this.rodEye = eye(1);
  }

  /** base / rodPt 都是父级 XY 平面里的二维点 */
  update(base, rodPt) {
    const L = dist(base, rodPt);
    this.group.position.set(base.x, base.y, this.z);
    this.group.rotation.z = dir(sub(rodPt, base));
    this.rod.scale.x = L;
    this.rodEye.position.x = L;
  }
}

// ── 各部件几何 ─────────────────────────────────────────────────────────

/** 动臂:一根弯折的箱型梁。脊线用二次贝塞尔过 knee,再上下各让开半高。 */
function makeBoomGeometry() {
  const [kx, ky] = BOOM.knee;
  const [tx, ty] = BOOM.tip;
  // 控制点取 2×knee,保证 t=0.5 时脊线正好过 knee
  const cx = 2 * kx - 0.5 * tx;
  const cy = 2 * ky - 0.5 * ty;
  const spine = (t) => {
    const u = 1 - t;
    return [u * u * 0 + 2 * u * t * cx + t * t * tx, u * u * 0 + 2 * u * t * cy + t * t * ty];
  };
  const halfH = (t) =>
    t < 0.5
      ? lerp(BOOM.halfHeightRoot, BOOM.halfHeightKnee, t / 0.5)
      : lerp(BOOM.halfHeightKnee, BOOM.halfHeightTip, (t - 0.5) / 0.5);

  const N = 22;
  const upper = [];
  const lower = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const [x, y] = spine(t);
    const h = halfH(t);
    upper.push([x, y + h]);
    lower.push([x, y - h]);
  }
  return extrude(shapeFromPoints([...upper, ...lower.reverse()]), BOOM.width, 0.03);
}

/** 斗杆:锥形箱梁 + 后上方那个挂斗杆油缸的凸耳 */
function makeArmGeometry() {
  const pts = [
    [-0.72, 0.6], // 凸耳顶(斗杆油缸杆端铰点就在这附近)
    [-0.2, 0.72],
    [0.6, 0.42],
    [1.6, 0.28],
    [ARM.tip[0], ARM.halfHeightTip],
    [ARM.tip[0], -ARM.halfHeightTip],
    [1.6, -0.24],
    [0.6, -0.3],
    [0.0, -0.3],
    [-0.3, -0.1],
    [-0.72, 0.42],
  ];
  return extrude(shapeFromPoints(pts), ARM.width, 0.028);
}

/**
 * 铲斗:在"设计系"里画侧面轮廓(斗口朝上、斗底朝前),再整体转 bodyRot 装到局部系。
 * 返回 { shell, plates, teeth } 三组几何,都已经转到铲斗局部系。
 */
function makeBucketParts(mats) {
  const D = BUCKET.design;
  const rot = BUCKET.bodyRot;
  const g = new THREE.Group();

  // 斗体钢板:外轮廓 + 内轮廓回程 = 一个 C 形壳,挤出后天然是空心的
  const shellShape = shapeFromPoints([...D.outer, ...D.inner]);
  const shell = new THREE.Mesh(extrude(shellShape, BUCKET.width - 0.06, 0.012), mats.bucketIn);
  shell.castShadow = true;
  g.add(shell);

  // 两侧的侧板(真机上带侧齿,这里做成实心板):外轮廓 + 斗口直线闭合
  const sideShape = shapeFromPoints([...D.outer, D.inner[0], D.inner[D.inner.length - 1]]);
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(extrude(sideShape, 0.035, 0.008), mats.steel);
    p.position.z = s * (BUCKET.width / 2 - 0.017);
    p.castShadow = true;
    g.add(p);
  }

  // 斗齿:沿斗底在齿尖处的切线方向长出去
  const a = D.outer[D.outer.length - 2];
  const b = D.outer[D.outer.length - 1];
  const td = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const toothGeo = new THREE.CylinderGeometry(0.028, 0.075, 0.24, 4);
  toothGeo.translate(0, 0.12, 0);
  toothGeo.rotateZ(-Math.PI / 2); // 指向 +X
  for (let i = 0; i < BUCKET.teeth; i++) {
    const t = new THREE.Mesh(toothGeo, mats.tooth);
    t.position.set(b[0], b[1], 0);
    t.position.z = lerp(-BUCKET.width / 2 + 0.16, BUCKET.width / 2 - 0.16, i / (BUCKET.teeth - 1));
    t.rotation.z = td;
    t.castShadow = true;
    g.add(t);
  }

  // 背板上那对连杆耳板
  const lug = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.34, 0.1),
    mats.steel
  );
  const lx = D.lugR * Math.cos(D.lugDir);
  const ly = D.lugR * Math.sin(D.lugDir);
  for (const s of [-1, 1]) {
    const l = lug.clone();
    l.position.set(lx * 0.55, ly * 0.55, s * 0.14);
    l.rotation.z = D.lugDir - Math.PI / 2;
    g.add(l);
  }
  // 铰点销轴
  const pin = new THREE.Mesh(cylZ(0.05, 0.4), mats.pin);
  pin.position.set(lx, ly, 0);
  g.add(pin);

  g.rotation.z = rot; // 设计系 → 铲斗局部系
  return g;
}

// ── 履带 ───────────────────────────────────────────────────────────────

/**
 * 履带板绕着一条"跑道形"闭合路径排布,每帧按行走速度整体推进 —— 所以你能真的看见板在动。
 * 路径:底面直线段 → 前引导轮半圆 → 顶面直线段 → 后驱动轮半圆。
 */
class TrackBelt {
  constructor(mats, z) {
    this.R = UC.idlerRadius;
    this.flat = UC.trackLength - 2 * this.R;
    this.xf = this.flat / 2;
    this.xr = -this.flat / 2;
    this.perimeter = 2 * this.flat + 2 * Math.PI * this.R;
    this.count = Math.round(this.perimeter / 0.21); // 节距 ≈ 0.21m,和真机接近
    this.pitch = this.perimeter / this.count;
    this.s = 0;

    // 一块履带板 = 底板 + 履刺
    const shoe = new THREE.Shape();
    const t = 0.045;
    const p = this.pitch * 0.94;
    shoe.moveTo(-p / 2, 0);
    shoe.lineTo(p / 2, 0);
    shoe.lineTo(p / 2, -t);
    shoe.lineTo(0.06, -t);
    shoe.lineTo(0.03, -t - 0.055); // 履刺
    shoe.lineTo(-0.03, -t - 0.055);
    shoe.lineTo(-0.06, -t);
    shoe.lineTo(-p / 2, -t);
    shoe.closePath();
    const geo = extrude(shoe, UC.trackWidth, 0);

    this.mesh = new THREE.InstancedMesh(geo, mats.shoe, this.count);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.position.z = z;
    this.dummy = new THREE.Object3D();
    this.update(0);
  }

  /** 路径参数 s → 位置和切线方向 */
  pointAt(s) {
    const { R, xf, xr, flat } = this;
    s = ((s % this.perimeter) + this.perimeter) % this.perimeter;
    const arc = Math.PI * R;
    if (s < flat) return { x: xr + s, y: 0, a: 0 }; // 底面:向前
    s -= flat;
    if (s < arc) {
      const phi = -Math.PI / 2 + s / R; // 前轮:自下绕到上
      return { x: xf + R * Math.cos(phi), y: R + R * Math.sin(phi), a: phi + Math.PI / 2 };
    }
    s -= arc;
    if (s < flat) return { x: xf - s, y: 2 * R, a: Math.PI }; // 顶面:向后
    s -= flat;
    const phi = Math.PI / 2 + s / R; // 后轮
    return { x: xr + R * Math.cos(phi), y: R + R * Math.sin(phi), a: phi + Math.PI / 2 };
  }

  /** distance = 本帧履带前进的线量(米) */
  update(distance) {
    this.s = (this.s + distance) % this.perimeter;
    for (let i = 0; i < this.count; i++) {
      const p = this.pointAt(this.s + i * this.pitch);
      this.dummy.position.set(p.x, p.y, -UC.trackWidth / 2);
      this.dummy.rotation.set(0, 0, p.a);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ── 整机 ───────────────────────────────────────────────────────────────

export class Excavator {
  constructor(mats) {
    this.mats = mats;
    this.root = new THREE.Group();
    this.chassis = new THREE.Group();
    this.swing = new THREE.Group();
    this.root.add(this.chassis, this.swing);

    this._buildUndercarriage();
    this._buildUpper();
    this._buildFront();

    this.pose = { swing: 0, boom: 0, arm: -1.6, bucket: -0.6 };
    this.bucketLoad = 0;
  }

  // ---- 底盘 ----
  _buildUndercarriage() {
    const M = this.mats;
    const g = this.chassis;

    // X 形车架
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(3.1, 0.5, UC.frameWidth),
      M.steel
    );
    frame.position.y = 0.5;
    frame.castShadow = true;
    g.add(frame);
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.34, UC.gauge - 0.2), M.steel);
      leg.position.set(s * 0.75, 0.5, 0);
      g.add(leg);
    }
    // 回转支承
    const bearing = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 0.26, 28), M.steelDark);
    bearing.position.y = UC.swingBearingY - 0.1;
    g.add(bearing);

    this.tracks = [];
    for (const s of [-1, 1]) {
      const side = new THREE.Group();
      side.position.z = s * UC.gauge * 0.5;
      g.add(side);

      // 履带架
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(UC.trackLength - 0.5, 0.42, UC.trackWidth * 0.62),
        M.steelDark
      );
      beam.position.y = UC.idlerRadius;
      beam.castShadow = true;
      side.add(beam);

      // 驱动轮 / 引导轮
      for (const x of [-(UC.trackLength / 2 - UC.idlerRadius), UC.trackLength / 2 - UC.idlerRadius]) {
        const w = new THREE.Mesh(cylZ(UC.idlerRadius * 0.82, UC.trackWidth * 0.72, 18), M.steelDark);
        w.position.set(x, UC.idlerRadius, 0);
        side.add(w);
      }
      // 支重轮
      for (let i = 0; i < 4; i++) {
        const x = lerp(-1.35, 1.35, i / 3);
        const r = new THREE.Mesh(cylZ(0.17, UC.trackWidth * 0.6, 12), M.steel);
        r.position.set(x, 0.17, 0);
        side.add(r);
      }

      const belt = new TrackBelt(M, 0);
      side.add(belt.mesh);
      this.tracks.push(belt);
    }
  }

  // ---- 上部回转体 ----
  _buildUpper() {
    const M = this.mats;
    const g = this.swing;

    // 回转平台:后半是跟着尾部回转半径的圆弧
    const deck = [];
    deck.push([1.75, UPPER.deckWidth / 2]);
    for (let z = UPPER.deckWidth / 2; z >= -UPPER.deckWidth / 2; z -= 0.25) {
      const x = -Math.sqrt(Math.max(0.01, UPPER.tailRadius ** 2 - z * z));
      deck.push([x, z]);
    }
    deck.push([1.75, -UPPER.deckWidth / 2]);
    const deckGeo = extrude(shapeFromPoints(deck), 0.16, 0.02);
    deckGeo.rotateX(-Math.PI / 2);
    const deckMesh = new THREE.Mesh(deckGeo, M.steelDark);
    deckMesh.position.y = UPPER.deckY;
    deckMesh.receiveShadow = true;
    deckMesh.castShadow = true;
    g.add(deckMesh);

    // 配重:尾部那块大铁,外缘同样贴着回转半径
    const cw = [];
    cw.push([-1.35, 1.3]);
    for (let z = 1.3; z >= -1.3; z -= 0.2) {
      cw.push([-Math.sqrt(UPPER.tailRadius ** 2 - z * z), z]);
    }
    cw.push([-1.35, -1.3]);
    const cwGeo = extrude(shapeFromPoints(cw), 1.25, 0.04);
    cwGeo.rotateX(-Math.PI / 2);
    const cwMesh = new THREE.Mesh(cwGeo, M.bodyDark);
    cwMesh.position.y = UPPER.deckY + 1.25;
    cwMesh.castShadow = true;
    g.add(cwMesh);

    // 发动机罩(在驾驶室右后方)
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.82, 2.5), M.body);
    hood.position.set(-0.85, UPPER.deckY + 0.49, -0.1);
    hood.castShadow = true;
    g.add(hood);
    const hoodTop = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.12, 2.3), M.bodyDark);
    hoodTop.position.set(-0.85, UPPER.deckY + 0.94, -0.1);
    g.add(hoodTop);

    // 排气管
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.55, 12), M.steelDark);
    stack.position.set(-0.2, UPPER.deckY + 1.2, -0.95);
    g.add(stack);

    // 动臂根部的两片立板
    for (const s of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 0.14), M.bodyDark);
      plate.position.set(BOOM.foot[0] - 0.25, BOOM.foot[1] - 0.25, s * 0.42);
      plate.castShadow = true;
      g.add(plate);
    }
    const footPin = new THREE.Mesh(cylZ(0.13, 1.1), M.pin);
    footPin.position.set(BOOM.foot[0], BOOM.foot[1], 0);
    g.add(footPin);

    this._buildCab();
  }

  _buildCab() {
    const M = this.mats;
    const cab = new THREE.Group();
    cab.position.set(UPPER.cabX, UPPER.deckY + 0.08, UPPER.cabZ);
    this.swing.add(cab);
    this.cab = cab;

    const { cabLength: L, cabWidth: W, cabHeight: H } = UPPER;

    // 下半截是钣金,上半截是玻璃
    const base = new THREE.Mesh(new THREE.BoxGeometry(L, 0.62, W), M.body);
    base.position.y = 0.31;
    base.castShadow = true;
    cab.add(base);

    const glass = new THREE.Mesh(new THREE.BoxGeometry(L * 0.99, H - 0.72, W * 0.99), M.glass);
    glass.position.y = 0.62 + (H - 0.72) / 2;
    cab.add(glass);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(L + 0.05, 0.1, W + 0.05), M.body);
    roof.position.y = H - 0.05;
    roof.castShadow = true;
    cab.add(roof);

    // 立柱
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.09, H - 0.7, 0.09), M.bodyDark);
        p.position.set(sx * (L / 2 - 0.045), 0.62 + (H - 0.72) / 2, sz * (W / 2 - 0.045));
        cab.add(p);
      }
    }

    // 座椅
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.12, 0.5), M.seat);
    seat.position.set(-0.15, 0.78, 0);
    cab.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.62, 0.5), M.seat);
    back.position.set(-0.36, 1.1, 0);
    cab.add(back);

    // 两个操纵手柄 —— 会跟着你的输入摆动,驾驶室视角里能直接看到自己在推哪个方向
    this.sticks = [];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0.08, 0.86, s * 0.42);
      cab.add(pivot);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.3, 8), M.steelDark);
      shaft.position.y = 0.15;
      pivot.add(shaft);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), M.rubber);
      knob.position.y = 0.32;
      pivot.add(knob);
      this.sticks.push(pivot);
    }

    // 行走操纵杆(脚下那两根)
    for (const s of [-1, 1]) {
      const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.42, 8), M.steelDark);
      lever.position.set(0.62, 0.42, s * 0.14);
      lever.rotation.z = 0.22;
      cab.add(lever);
    }
  }

  // ---- 工作装置 ----
  _buildFront() {
    const M = this.mats;

    // 动臂
    this.boomPivot = new THREE.Group();
    this.boomPivot.position.set(BOOM.foot[0], BOOM.foot[1], 0);
    this.swing.add(this.boomPivot);
    const boom = new THREE.Mesh(makeBoomGeometry(), M.boom);
    boom.castShadow = true;
    this.boomPivot.add(boom);
    const boomTipPin = new THREE.Mesh(cylZ(0.11, BOOM.width + 0.16), M.pin);
    boomTipPin.position.set(BOOM.tip[0], BOOM.tip[1], 0);
    this.boomPivot.add(boomTipPin);

    // 斗杆
    this.armPivot = new THREE.Group();
    this.armPivot.position.set(BOOM.tip[0], BOOM.tip[1], 0);
    this.boomPivot.add(this.armPivot);
    const arm = new THREE.Mesh(makeArmGeometry(), M.boom);
    arm.castShadow = true;
    this.armPivot.add(arm);
    const armTipPin = new THREE.Mesh(cylZ(0.095, ARM.width + 0.14), M.pin);
    armTipPin.position.set(ARM.tip[0], ARM.tip[1], 0);
    this.armPivot.add(armTipPin);

    // 摇臂在斗杆上的铰点耳板
    const Ph = BUCKET.linkage.Ph;
    for (const s of [-1, 1]) {
      const lug = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.08), M.steel);
      lug.position.set(Ph[0] - 0.05, Ph[1] - 0.08, s * 0.16);
      this.armPivot.add(lug);
    }

    // 铲斗
    this.bucketPivot = new THREE.Group();
    this.bucketPivot.position.set(ARM.tip[0], ARM.tip[1], 0);
    this.armPivot.add(this.bucketPivot);
    this.bucketPivot.add(makeBucketParts(M));

    // 斗里的土(装载量为 0 时隐藏)
    this.soil = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), M.soil);
    this.soil.scale.set(1, 0.55, 1);
    const soilHolder = new THREE.Group();
    soilHolder.rotation.z = BUCKET.bodyRot;
    soilHolder.add(this.soil);
    this.soil.position.set(0.5, -0.2, 0); // 落在斗腔里
    this.bucketPivot.add(soilHolder);

    // ---- 三组油缸 ----
    // 缸筒长度取"最短行程再减一点",保证任何姿态下都还露着一截活塞杆
    const boomLmin = Math.min(
      cylinderLength(fromArray(BOOM.cyl.base), fromArray(BOOM.foot), fromArray(BOOM.cyl.rod), BOOM.angleMin),
      cylinderLength(fromArray(BOOM.cyl.base), fromArray(BOOM.foot), fromArray(BOOM.cyl.rod), BOOM.angleMax)
    );
    this.boomCyls = [];
    for (const s of [-1, 1]) {
      const c = new HydraulicCylinder(M, BOOM.cyl, boomLmin - 0.16, s * BOOM.cyl.pairZ);
      this.swing.add(c.group);
      this.boomCyls.push(c);
    }

    const armLmin = Math.min(
      cylinderLength(fromArray(ARM.cyl.base), fromArray(BOOM.tip), fromArray(ARM.cyl.rod), ARM.angleMin),
      cylinderLength(fromArray(ARM.cyl.base), fromArray(BOOM.tip), fromArray(ARM.cyl.rod), ARM.angleMax)
    );
    this.armCyl = new HydraulicCylinder(M, ARM.cyl, armLmin - 0.18, 0);
    this.boomPivot.add(this.armCyl.group);

    this._bucketCfg = { ...BUCKET, armTip: ARM.tip };
    const bkA = solveBucketLinkage(this._bucketCfg, BUCKET.angleMin);
    const bkB = solveBucketLinkage(this._bucketCfg, BUCKET.angleMax);
    const bkLmin = Math.min(bkA.cylLength, bkB.cylLength);
    this.bucketCyl = new HydraulicCylinder(M, BUCKET.linkage, bkLmin - 0.16, 0);
    this.armPivot.add(this.bucketCyl.group);

    // 摇臂(两片)和连杆(两片)—— 长度固定,每帧只更新位置和朝向
    this.powerLinks = [];
    this.idlerLinks = [];
    const linkMesh = (len, w, z) => {
      const m = new THREE.Mesh(unitCylX(w, 8), M.steel);
      m.scale.x = len;
      m.position.z = z;
      m.castShadow = true;
      this.armPivot.add(m);
      return m;
    };
    for (const s of [-1, 1]) {
      this.powerLinks.push(linkMesh(BUCKET.linkage.L1, 0.05, s * 0.13));
      this.idlerLinks.push(linkMesh(BUCKET.linkage.L2, 0.045, s * 0.2));
    }
  }

  // ---- 每帧装配 ----

  /**
   * pose: { swing, boom, arm, bucket } 弧度
   * 所有油缸和连杆的位置都由这四个角推出来 —— 没有任何一处是"摆着好看"的独立动画。
   */
  setPose(pose) {
    this.pose = pose;
    this.swing.rotation.y = pose.swing;
    this.boomPivot.rotation.z = pose.boom;
    this.armPivot.rotation.z = pose.arm;
    this.bucketPivot.rotation.z = pose.bucket;

    // 动臂油缸:缸底在回转台,杆端在动臂上
    const boomBase = fromArray(BOOM.cyl.base);
    const boomRod = xform(fromArray(BOOM.foot), pose.boom, fromArray(BOOM.cyl.rod));
    for (const c of this.boomCyls) c.update(boomBase, boomRod);

    // 斗杆油缸:缸底在动臂,杆端在斗杆后凸耳
    const armBase = fromArray(ARM.cyl.base);
    const armRod = xform(fromArray(BOOM.tip), pose.arm, fromArray(ARM.cyl.rod));
    this.armCyl.update(armBase, armRod);

    // 铲斗四连杆:全在斗杆局部系里解
    const bk = solveBucketLinkage(this._bucketCfg, pose.bucket);
    if (bk) {
      this.bucketCyl.update(bk.cylBase, bk.H);
      const pa = dir(sub(bk.H, bk.Ph));
      const ia = dir(sub(bk.Pb, bk.H));
      for (const m of this.powerLinks) {
        m.position.x = bk.Ph.x;
        m.position.y = bk.Ph.y;
        m.rotation.z = pa;
      }
      for (const m of this.idlerLinks) {
        m.position.x = bk.H.x;
        m.position.y = bk.H.y;
        m.rotation.z = ia;
      }
    }

    // 斗里的土:按装载率缩放
    const f = clamp(this.bucketLoad / BUCKET.capacity, 0, 1);
    this.soil.visible = f > 0.02;
    this.soil.scale.set(0.62 * (0.5 + 0.5 * f), 0.42 * f, BUCKET.width * 0.62);
  }

  /** 手柄输入 → 驾驶室里两根手柄的摆动(纯视觉) */
  setStickVisual(left, right) {
    const apply = (pivot, v) => {
      pivot.rotation.z = -v.y * 0.32;
      pivot.rotation.x = v.x * 0.32;
    };
    apply(this.sticks[0], left);
    apply(this.sticks[1], right);
  }

  /** 履带推进(米)。左右分开,所以能原地转向。 */
  driveTracks(leftDist, rightDist) {
    this.tracks[0].update(leftDist);
    this.tracks[1].update(rightDist);
  }

  /** 斗齿尖在世界坐标里的位置 */
  getTipWorld(target = new THREE.Vector3()) {
    target.set(BUCKET.tip[0], BUCKET.tip[1], 0);
    return this.bucketPivot.localToWorld(target);
  }

  /** 斗齿刃口的两个端点(世界坐标)—— 挖掘时按这条线取土 */
  getCuttingEdge(a = new THREE.Vector3(), b = new THREE.Vector3()) {
    a.set(BUCKET.tip[0], BUCKET.tip[1], -BUCKET.width / 2 + 0.1);
    b.set(BUCKET.tip[0], BUCKET.tip[1], BUCKET.width / 2 - 0.1);
    this.bucketPivot.localToWorld(a);
    this.bucketPivot.localToWorld(b);
    return [a, b];
  }
}
