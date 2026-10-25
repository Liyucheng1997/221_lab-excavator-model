/**
 * 轮式机械共用的零件:工程轮胎(带花纹块)、轮辋 + 轮边减速器、方向盘、三维油缸、站姿操作员、
 * 灯具、扶手、后视镜、警示灯。
 *
 * 轮子约定:轴沿 Z,外侧朝 +Z(左侧的轮子装的时候绕 Y 转 180°),原点在轮心。
 * 同一种轮子的几何只建一次,四个轮子共用,省显存也省 draw call。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { add, bake, box, rbox, cylY, cylZ, latheZ, bolts, tube, rod, shapeFrom } from '../model/geo.js';
import { HydraulicCylinder } from '../model/front.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();
const _e = new THREE.Euler();

/** 几何按位置/欧拉角放好(返回新几何,原几何不动) */
function placed(geo, x, y, z, rx = 0, ry = 0, rz = 0, order = 'XYZ') {
  const g = geo.clone();
  _e.set(rx, ry, rz, order);
  _q.setFromEuler(_e);
  _m.compose(_p.set(x, y, z), _q, _s);
  g.applyMatrix4(_m);
  return g;
}

/** 合并前统一成非索引 + 只留 position/normal/uv */
function norm(g) {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
  if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
  return n;
}
export function mergeAll(list) {
  return mergeGeometries(list.map(norm), false);
}

// ── 工程轮胎 ───────────────────────────────────────────────────────────

/**
 * 轮胎几何(橡胶部分):胎体用旋转体,胎肩倒圆、胎侧鼓出;花纹块一块块贴上去。
 *   R 外径半径(含花纹)  W 断面宽  rimR 胎圈半径
 *   pattern:
 *     'L3'     装载机的人字形深花纹(左右两半错开半个节距)
 *     'R1'     压路机/拖拉机的高花纹人字块(更高、更稀)
 *     'solid'  高空作业平台的实心胎:光面 + 几道浅周向沟
 */
export function tireGeometry({ R, W, rimR, pattern = 'L3', pitch = 22, depth = 0.05, seg = 56 }) {
  const parts = [];
  const r0 = R - (pattern === 'solid' ? 0 : depth); // 胎体外径
  const hw = W / 2;
  const sh = Math.min(0.12, W * 0.22); // 胎肩圆角
  // 胎体轮廓(r, z):内胎圈 → 内胎侧(鼓出)→ 内胎肩 → 胎冠 → 外胎肩 → 外胎侧 → 外胎圈
  const side = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    side.push([rimR + (r0 - sh - rimR) * t, hw * 0.84 + hw * 0.16 * Math.sin((t * Math.PI) / 2) + hw * 0.05 * Math.sin(t * Math.PI)]);
  }
  const shoulder = [];
  for (let i = 1; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    shoulder.push([r0 - sh + sh * Math.sin(a), hw - sh + sh * Math.cos(a)]);
  }
  const prof = [
    ...side.map(([r, z]) => [r, -z]),
    ...shoulder.map(([r, z]) => [r, -z]),
    [r0 + 0.003, -(hw - sh) * 0.4],
    [r0 + 0.004, 0],
    [r0 + 0.003, (hw - sh) * 0.4],
    ...shoulder.slice().reverse(),
    ...side.slice().reverse(),
  ];
  parts.push(latheZ(prof, seg));

  if (pattern === 'solid') {
    // 实心胎:胎面几道周向浅沟(深色细环)+ 胎侧一圈凸点
    for (const z of [-W * 0.22, 0, W * 0.22]) {
      const g = new THREE.TorusGeometry(R + 0.001, 0.005, 4, seg);
      g.translate(0, 0, z);
      parts.push(g);
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      parts.push(placed(new THREE.BoxGeometry(0.02, 0.05, 0.012), Math.cos(a) * (R - 0.04), Math.sin(a) * (R - 0.04), hw * 0.95, 0, 0, a));
    }
    return mergeAll(parts);
  }

  // 花纹块:人字形。每半边一根斜条贴在胎冠上,外端绕过胎肩往下包;左右两半错开半个节距
  const lugW = pattern === 'R1' ? 0.085 : 0.075; // 周向厚度
  const ang = pattern === 'R1' ? 0.6 : 0.42; // 斜条与轴线的夹角
  const reach = hw - sh * 0.35;
  const len = reach / Math.cos(ang);
  const unit = rbox(1, 1, 1, 0.16, 0, 0, 0, 1);
  const sized = (x, y, z) => unit.clone().scale(x, y, z);
  for (let i = 0; i < pitch; i++) {
    for (const sd of [-1, 1]) {
      const th = ((i + (sd > 0 ? 0.5 : 0)) / pitch) * Math.PI * 2;
      // 条块:x 周向厚度、y 径向高度、z 长度;绕径向(Y)偏转 ang 形成人字
      const g = sized(lugW, depth + 0.006, len);
      g.rotateY(sd * ang);
      g.translate(0, r0 + depth / 2 - 0.004, (sd * reach) / 2);
      g.rotateZ(th - Math.PI / 2);
      parts.push(g);
      // 胎肩包角:接在条块外端,沿胎肩往下
      const dx = Math.tan(ang) * (reach / 2); // 外端相对条块中心的周向偏移(两半都偏向 +x,人字尖朝同一个方向)
      const thEnd = th - dx / r0;
      const w = sized(lugW * 1.05, sh * 1.3, depth * 0.9);
      w.translate(0, r0 - sh * 0.45, sd * (hw - depth * 0.25));
      w.rotateZ(thEnd - Math.PI / 2);
      parts.push(w);
    }
  }
  return mergeAll(parts);
}

/**
 * 轮辋 + 辐板 + 轮毂螺母 + 轮边减速器(行星轮毂)。返回 { steel, hub, nut } 三组几何。
 *   rimR 胎圈半径  W 轮辋宽  hubR 轮边减速器外壳半径  hubOut 轮毂外凸多少(装载机的轮边很鼓)
 */
export function rimGeometry({ rimR, W, hubR = rimR * 0.45, hubOut = 0.12, nuts = 16, style = 'loader' }) {
  const steel = [];
  const hub = [];
  const nut = [];
  const hw = W / 2;
  // 轮辋:两侧轮缘 + 筒身(略凹的深槽)
  const rimProf = [
    [rimR - 0.06, -hw - 0.01],
    [rimR + 0.035, -hw - 0.01],
    [rimR + 0.035, -hw + 0.02],
    [rimR, -hw + 0.04],
    [rimR - 0.02, -hw * 0.5],
    [rimR - 0.035, 0],
    [rimR - 0.02, hw * 0.5],
    [rimR, hw - 0.04],
    [rimR + 0.035, hw - 0.02],
    [rimR + 0.035, hw + 0.01],
    [rimR - 0.06, hw + 0.01],
  ];
  steel.push(latheZ(rimProf, 48));
  // 辐板(在偏外侧),带一圈减重孔的暗色凹坑
  const discZ = style === 'lift' ? hw * 0.6 : hw * 0.2;
  steel.push(cylZ(rimR - 0.03, 0.025, 40, 0, 0, discZ));
  if (style !== 'lift') {
    const holes = style === 'roller' ? 8 : 10;
    for (let i = 0; i < holes; i++) {
      const a = (i / holes) * Math.PI * 2 + 0.2;
      const rr = (rimR + hubR) / 2 + 0.02;
      hub.push(cylZ(0.055, 0.03, 14, Math.cos(a) * rr, Math.sin(a) * rr, discZ + 0.003));
    }
  } else {
    // 实心胎轮辋:五个凹窝
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const rr = rimR * 0.58;
      hub.push(cylZ(rimR * 0.18, 0.02, 14, Math.cos(a) * rr, Math.sin(a) * rr, discZ + 0.005));
    }
  }
  // 轮毂螺母
  const nutR = hubR + 0.05;
  const np = [];
  for (let i = 0; i < nuts; i++) {
    const a = (i / nuts) * Math.PI * 2;
    np.push([Math.cos(a) * nutR, Math.sin(a) * nutR, discZ + 0.025]);
  }
  nut.push(bolts(np, style === 'lift' ? 0.012 : 0.022, 0.03, 'z'));
  // 轮边减速器:鼓出来的铸造外壳 + 端盖螺栓 + 放油螺塞
  if (hubOut > 0) {
    const hp = [
      [0.001, discZ + hubOut + 0.03],
      [hubR * 0.55, discZ + hubOut + 0.03],
      [hubR * 0.62, discZ + hubOut + 0.01],
      [hubR * 0.62, discZ + hubOut - 0.02],
      [hubR * 0.9, discZ + hubOut - 0.03],
      [hubR, discZ + hubOut * 0.5],
      [hubR, discZ],
    ];
    hub.push(latheZ(hp.map(([r, z]) => [r, z]), 32));
    const bp = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      bp.push([Math.cos(a) * hubR * 0.76, Math.sin(a) * hubR * 0.76, discZ + hubOut - 0.01]);
    }
    nut.push(bolts(bp, 0.014, 0.025, 'z'));
    nut.push(cylZ(0.03, 0.03, 6, hubR * 0.3, -hubR * 0.15, discZ + hubOut + 0.045));
  } else {
    hub.push(cylZ(hubR * 0.6, 0.06, 24, 0, 0, discZ + 0.03));
  }
  return { steel: mergeAll(steel), hub: mergeAll(hub), nut: mergeAll(nut) };
}

/**
 * 一只完整的轮子(会转的 Group)。geo 由 wheelSet 共享。
 * side = +1 外侧朝 +Z(右侧轮),-1 朝 -Z(左侧轮)
 */
export function wheelSet(M, opts) {
  const tire = tireGeometry(opts);
  const rim = rimGeometry({ rimR: opts.rimR, W: opts.W * 0.86, hubR: opts.hubR, hubOut: opts.hubOut ?? 0.12, nuts: opts.nuts, style: opts.style });
  const tireMat = opts.tireMat || M.tire;
  const rimMat = opts.rimMat || M.body;
  const hubMat = opts.hubMat || M.steelDark;
  return (side = 1) => {
    const spin = new THREE.Group(); // 绕 Z 转 = 滚动
    const holder = new THREE.Group();
    holder.rotation.y = side > 0 ? 0 : Math.PI;
    spin.add(holder);
    for (const [g, m] of [
      [tire, tireMat],
      [rim.steel, rimMat],
      [rim.hub, hubMat],
      [rim.nut, M.pin],
    ]) {
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      holder.add(mesh);
    }
    return spin;
  };
}

/** 轮胎胎面贴图(给实心胎):浅灰橡胶 */
export function lightRubber() {
  return new THREE.MeshStandardMaterial({ color: 0x5f6266, roughness: 0.85, metalness: 0 });
}

// ── 三维油缸 ───────────────────────────────────────────────────────────

/**
 * 任意方向的油缸(转向缸、剪叉举升缸)。内部还是 HydraulicCylinder,外面包一层朝向。
 * update(p0, p1):两端铰点(父系里的三维点)。
 */
export class Cylinder3D {
  constructor(M, dims, barrelLen, roll = 0) {
    this.holder = new THREE.Group();
    this.cyl = new HydraulicCylinder(M, dims, barrelLen, 0, 1);
    this.cyl.group.rotation.x = roll;
    this.holder.add(this.cyl.group);
    this._d = new THREE.Vector3();
    this._x = new THREE.Vector3(1, 0, 0);
    this._up = new THREE.Vector3();
    this._b = { x: 0, y: 0 };
    this._r = { x: 0, y: 0 };
  }
  update(p0, p1, up = null) {
    this.holder.position.copy(p0);
    this._d.subVectors(p1, p0);
    const L = this._d.length();
    this._d.divideScalar(L || 1);
    if (up) {
      // 指定"上"方向,免得缸体绕自身轴乱转(油口朝向固定)
      const m = new THREE.Matrix4();
      const zAxis = new THREE.Vector3().crossVectors(this._d, up).normalize();
      const yAxis = new THREE.Vector3().crossVectors(zAxis, this._d).normalize();
      m.makeBasis(this._d, yAxis, zAxis);
      this.holder.quaternion.setFromRotationMatrix(m);
    } else this.holder.quaternion.setFromUnitVectors(this._x, this._d);
    this._r.x = L;
    this.cyl.update(this._b, this._r);
    this.cyl.group.position.z = 0;
    return L;
  }
}

// ── 驾驶室里的件 ───────────────────────────────────────────────────────

/** 方向盘(带调节转向柱)。返回 { group, wheel } —— wheel 绕自身轴转 */
export function steeringWheel(M, r = 0.19) {
  const group = new THREE.Group();
  const wheel = new THREE.Group();
  const rimG = new THREE.TorusGeometry(r, 0.017, 10, 40);
  wheel.add(new THREE.Mesh(rimG, M.plastic));
  // 三根辐条 + 中心盖
  for (const a of [Math.PI / 2, Math.PI / 2 + (2 * Math.PI) / 3, Math.PI / 2 - (2 * Math.PI) / 3]) {
    const s = new THREE.Mesh(rbox(r * 0.95, 0.03, 0.018, 0.008), M.plastic);
    s.position.set((Math.cos(a) * r) / 2, (Math.sin(a) * r) / 2, -0.01);
    s.rotation.z = a;
    wheel.add(s);
  }
  const hubM = new THREE.Mesh(cylZ(0.05, 0.05, 20), M.plasticLight);
  hubM.position.z = -0.02;
  wheel.add(hubM);
  // 助力球(装载机方向盘上常见的快转球)
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8), M.blackGloss);
  knob.position.set(r * 0.72, -r * 0.72, 0.03);
  wheel.add(knob);
  wheel.userData.knob = knob;
  group.add(wheel);
  // 转向柱:从仪表台斜着伸出来
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.45, 12), M.plastic);
  col.rotation.x = Math.PI / 2;
  col.position.z = -0.25;
  group.add(col);
  return { group, wheel };
}

/** 站在平台上的操作员(手扶控制盒),戴安全帽、穿反光背心、系安全带 */
export function buildStandingOperator(M) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xc89878, roughness: 0.8 });
  const vest = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.7 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0x2c3a52, roughness: 0.9 });
  const helmet = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 });
  const strap = new THREE.MeshStandardMaterial({ color: 0x1f1f1f, roughness: 0.8 });
  const part = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => add(g, geo, mat, x, y, z, rx, ry, rz);
  for (const s of [-1, 1]) {
    part(new THREE.CapsuleGeometry(0.075, 0.4, 4, 8), cloth, 0, 0.72, s * 0.11);
    part(new THREE.CapsuleGeometry(0.065, 0.36, 4, 8), cloth, 0, 0.3, s * 0.11);
    part(rbox(0.26, 0.09, 0.11, 0.03), M.black, 0.05, 0.045, s * 0.11);
  }
  part(rbox(0.26, 0.18, 0.36, 0.06), cloth, 0, 1.0, 0); // 胯
  part(new THREE.CapsuleGeometry(0.17, 0.36, 4, 12), vest, 0, 1.32, 0);
  // 安全带:肩带 + 腰带 + 背后挂点
  for (const s of [-1, 1]) part(rbox(0.36, 0.03, 0.05, 0.01), strap, 0, 1.35, s * 0.1, s * 0.25, 0, Math.PI / 2 - 0.15);
  part(new THREE.TorusGeometry(0.19, 0.018, 6, 20), strap, 0, 1.08, 0, Math.PI / 2, 0, 0);
  part(new THREE.TorusGeometry(0.03, 0.008, 6, 12), M.chrome, -0.19, 1.45, 0, 0, Math.PI / 2, 0);
  // 手臂:上臂往前下垂到肘,小臂水平往前,双手扶在控制盒上
  for (const s of [-1, 1]) {
    part(new THREE.CapsuleGeometry(0.052, 0.24, 4, 8), cloth, 0.07, 1.36, s * 0.23, -s * 0.12, 0, 0.46);
    part(new THREE.CapsuleGeometry(0.046, 0.22, 4, 8), cloth, 0.27, 1.21, s * 0.18, 0, s * 0.25, Math.PI / 2 + 0.08);
    part(new THREE.SphereGeometry(0.046, 10, 8), skin, 0.42, 1.2, s * 0.13);
  }
  part(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 10), skin, 0, 1.6, 0);
  part(new THREE.SphereGeometry(0.105, 16, 12), skin, 0.01, 1.73, 0);
  part(new THREE.SphereGeometry(0.122, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), helmet, 0.0, 1.77, 0);
  part(new THREE.CylinderGeometry(0.135, 0.135, 0.012, 18), helmet, 0.02, 1.77, 0);
  const baked = bake(g);
  baked.traverse((o) => (o.castShadow = true));
  return baked;
}

// ── 外部件 ─────────────────────────────────────────────────────────────

/** 方形工作灯(灯壳 + 灯罩 + 支架)。dir:灯朝向(绕 Y 的角度,0 = +X) */
export function workLight(g, M, x, y, z, ry = 0, s = 1) {
  const h = new THREE.Group();
  h.position.set(x, y, z);
  h.rotation.y = ry;
  add(h, rbox(0.1 * s, 0.13 * s, 0.17 * s, 0.02 * s), M.black, 0, 0, 0);
  add(h, box(0.012, 0.1 * s, 0.14 * s), M.lightLens, 0.052 * s, 0, 0);
  for (let i = 0; i < 3; i++) add(h, box(0.06 * s, 0.006, 0.15 * s), M.black, -0.03 * s, 0.03 * s - i * 0.03 * s, 0);
  add(h, box(0.03, 0.08 * s, 0.03), M.black, -0.02, -0.09 * s, 0);
  g.add(h);
  return h;
}

/** 圆形前大灯 + 转向灯 */
export function headLamp(g, M, x, y, z, ry = 0) {
  const h = new THREE.Group();
  h.position.set(x, y, z);
  h.rotation.y = ry;
  add(h, cylZ(0.085, 0.12, 20), M.black, 0, 0, 0, 0, Math.PI / 2, 0);
  add(h, cylZ(0.07, 0.01, 20), M.lightLens, 0.062, 0, 0, 0, Math.PI / 2, 0);
  add(h, cylZ(0.088, 0.015, 20), M.chrome, 0.058, 0, 0, 0, Math.PI / 2, 0);
  g.add(h);
  return h;
}

export function mirror(g, M, base, at, ry = 0) {
  add(g, rod(base, at, 0.012), M.black);
  const m = add(g, rbox(0.03, 0.24, 0.17, 0.012), M.black, ...at);
  m.rotation.y = ry;
  const gl = add(g, box(0.004, 0.2, 0.14), M.mirror, at[0] + Math.cos(ry) * 0.018, at[1], at[2] - Math.sin(ry) * 0.018);
  gl.rotation.y = ry;
}

/** 黄色扶手:过若干点的圆管,两端带底座 */
export function handrail(g, mat, pts, r = 0.02) {
  add(g, tube(pts, r, Math.max(20, pts.length * 10), 8, false, 0.0), mat);
  for (const p of [pts[0], pts[pts.length - 1]]) add(g, cylY(r * 1.8, 0.02, 10, p[0], p[1] - 0.01, p[2]), mat);
}

/** 旋转警示灯(返回需要动画的部分) */
export function beacon(parent, M, x, y, z) {
  const b = new THREE.Group();
  b.position.set(x, y, z);
  b.add(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.04, 16), M.black));
  const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.14, 16), M.beacon);
  dome.position.y = 0.09;
  b.add(dome);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.beacon);
  cap.position.y = 0.16;
  b.add(cap);
  const refl = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.09, 0.08), M.chrome);
  refl.position.y = 0.09;
  b.add(refl);
  parent.add(b);
  return { group: b, refl };
}

/** 防滑踏步(梯子的一级) */
export function step(g, M, x, y, z, w = 0.34, d = 0.2) {
  add(g, box(w, 0.02, d), M.tread, x, y, z);
  add(g, box(w, 0.05, 0.015), M.black, x, y - 0.02, z + d / 2);
}

/** 销轴 + 两端挡圈(沿 Z) */
export function pinZ(g, M, x, y, z, r, len) {
  add(g, cylZ(r, len, 16, x, y, z), M.pin);
  for (const s of [-1, 1]) add(g, cylZ(r * 1.3, 0.015, 16, x, y, z + (s * len) / 2), M.steelDark);
}

/** 贴花平面(在 parent 上放一块透明贴图) */
export function decal(g, mat, w, h, x, y, z, ry = 0, rx = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, 0, 'YXZ');
  g.add(m);
  return m;
}


/**
 * 轮式机械的 ROPS 驾驶室外壳:立柱、玻璃、顶棚 + 空调、门(左侧)、雨刮、顶灯、后视镜。
 * C = { x0, x1, hw, y0, y1 } 父系里的尺寸;返回 { cab, shell, glass, seatX, dashX } ——
 * 内饰往 shell 里加,最后由调用方 bake。
 */
export function cabShell(M, C, opts = {}) {
  const cab = new THREE.Group();
  const shell = new THREE.Group();
  const glass = new THREE.Group();
  const L = C.x1 - C.x0;
  const H = C.y1 - C.y0;
  const hw = C.hw;
  const y0 = C.y0;
  // 侧视轮廓:前窗下沿略往前凸,前窗微微后仰;后窗竖直
  const FB = [C.x1, y0 + 0.05];
  const FM = [C.x1 + 0.06, y0 + 0.75];
  const FT = [C.x1 - 0.08, C.y1 - 0.12];
  const RT = [C.x0 + 0.03, C.y1 - 0.08];
  const RB = [C.x0, y0 + 0.05];
  const beam = (a, b, z, w = 0.07) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const m = add(shell, rbox(len + w * 0.5, w, w, 0.015), M.black, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z);
    m.rotation.z = Math.atan2(b[1] - a[1], b[0] - a[0]);
  };
  for (const z of [-hw + 0.03, hw - 0.03]) {
    beam(FB, FM, z);
    beam(FM, FT, z);
    beam(FT, RT, z, 0.08);
    beam(RT, RB, z, 0.09);
    beam(RB, FB, z, 0.08);
    beam([(C.x0 + C.x1) / 2 - 0.1, y0 + 0.05], [(C.x0 + C.x1) / 2 - 0.12, C.y1 - 0.1], z, 0.06); // B 柱
  }
  for (const [x, y] of [FM, FT, RT, [C.x0 + 0.02, y0 + 0.95], [C.x1 + 0.02, y0 + 0.05]]) add(shell, rbox(0.07, 0.07, hw * 2 - 0.04, 0.015), M.black, x, y, 0);
  // 顶棚:黄色顶盖 + 前后檐 + 空调外机
  add(shell, rbox(L + 0.28, 0.12, hw * 2 + 0.16, 0.05), M.body, (C.x0 + C.x1) / 2 + 0.02, C.y1 + 0.02, 0);
  add(shell, rbox(L - 0.1, 0.06, hw * 2 - 0.1, 0.03), M.bodyDark, (C.x0 + C.x1) / 2, C.y1 + 0.1, 0);
  add(shell, rbox(0.55, 0.16, 0.7, 0.04), M.plasticLight, C.x0 + 0.42, C.y1 + 0.2, 0);
  add(shell, box(0.45, 0.01, 0.55, C.x0 + 0.42, C.y1 + 0.285, 0), opts.grille);
  // 下半截钢板(门下、右侧、后面)
  add(shell, box(L - 0.1, 0.42, 0.025, (C.x0 + C.x1) / 2, y0 + 0.24, hw - 0.01), M.body);
  add(shell, box(0.025, 0.85, hw * 2 - 0.06, C.x0 + 0.012, y0 + 0.47, 0), M.body);
  add(shell, box(0.5, 0.36, 0.025, C.x0 + 0.33, y0 + 0.22, -hw + 0.01), M.body);
  // 门(左侧):门框 + 门把手 + 铰链
  const dx0 = C.x0 + 0.62;
  const dx1 = C.x1 - 0.05;
  beam([dx0, y0 + 0.08], [dx0 - 0.02, C.y1 - 0.12], -hw - 0.005, 0.05);
  beam([dx0, y0 + 0.92], [dx1, y0 + 0.92], -hw - 0.005, 0.045);
  add(shell, box(dx1 - dx0, 0.38, 0.03, (dx0 + dx1) / 2, y0 + 0.24, -hw - 0.005), M.body);
  add(shell, rbox(0.12, 0.03, 0.04, 0.01), M.chrome, dx0 + 0.12, y0 + 0.9, -hw - 0.035);
  for (const y of [y0 + 0.35, y0 + 1.35]) add(shell, cylY(0.018, 0.1, 8, dx1 + 0.02, y, -hw - 0.03), M.steelDark);
  // 雨刮(前、后)
  add(shell, rod([FB[0] + 0.04, y0 + 0.78, 0.2], [FT[0] + 0.02, C.y1 - 0.4, 0.05], 0.008), M.black);
  add(shell, cylZ(0.02, 0.04, 10, FB[0] + 0.05, y0 + 0.78, 0.2), M.black);
  add(shell, rod([C.x0 - 0.02, y0 + 1.0, 0.0], [C.x0 - 0.02, C.y1 - 0.25, 0.3], 0.008), M.black);
  // 顶灯:前 2、后 2 + 警示灯
  for (const z of [-0.5, 0.5]) {
    workLight(shell, M, C.x1 + 0.08, C.y1 + 0.02, z, 0);
    workLight(shell, M, C.x0 - 0.08, C.y1 + 0.02, z, Math.PI);
  }
  // 后视镜(两侧)
  mirror(shell, M, [C.x1 + 0.05, C.y1 - 0.1, -hw], [C.x1 + 0.25, C.y1 - 0.25, -hw - 0.35], 0.4);
  mirror(shell, M, [C.x1 + 0.05, C.y1 - 0.1, hw], [C.x1 + 0.25, C.y1 - 0.25, hw + 0.35], -0.4);

  // 玻璃
  const pane = (a, b, z0, z1) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, z1 - z0), M.glass);
    m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (z0 + z1) / 2);
    m.rotation.order = 'ZXY';
    m.rotation.set(Math.PI / 2, 0, Math.atan2(b[1] - a[1], b[0] - a[0]));
    glass.add(m);
  };
  pane([FB[0] + 0.01, y0 + 0.12], [FM[0] - 0.01, FM[1] - 0.02], -hw + 0.06, hw - 0.06);
  pane([FM[0] - 0.01, FM[1] + 0.02], [FT[0] - 0.01, FT[1] - 0.02], -hw + 0.06, hw - 0.06);
  const sideGlass = (pts, z) => {
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shapeFrom(pts)), M.glass);
    m.position.z = z;
    glass.add(m);
  };
  const sideFull = [
    [C.x0 + 0.05, y0 + 0.5],
    [FB[0] - 0.02, y0 + 0.5],
    [FM[0] - 0.03, FM[1]],
    [FT[0] - 0.04, FT[1] - 0.03],
    [RT[0] + 0.03, RT[1] - 0.03],
    [C.x0 + 0.05, RT[1] - 0.03],
  ];
  sideGlass(sideFull, hw - 0.02);
  sideGlass(
    [
      [dx0 + 0.04, y0 + 0.45],
      [dx1 - 0.02, y0 + 0.45],
      [FM[0] - 0.08, FM[1]],
      [FT[0] - 0.08, FT[1] - 0.04],
      [dx0 + 0.02, FT[1] - 0.04],
    ],
    -hw + 0.02
  );
  sideGlass(
    [
      [C.x0 + 0.05, y0 + 0.42],
      [dx0 - 0.04, y0 + 0.42],
      [dx0 - 0.05, RT[1] - 0.04],
      [C.x0 + 0.05, RT[1] - 0.04],
    ],
    -hw + 0.02
  );
  const rg = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2 - 0.12, H - 1.05), M.glass);
  rg.position.set(C.x0 + 0.01, y0 + 0.95 + (H - 1.05) / 2, 0);
  rg.rotation.y = Math.PI / 2;
  glass.add(rg);

  const seatX = C.x0 + 0.62;
  const dashX = C.x1 - 0.22;
  return { cab, shell, glass, seatX, dashX, L, H, hw, y0 };
}

export { placed };
