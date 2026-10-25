/**
 * 轮式装载机三维模型(5 吨级,ZL50 / 柳工 856 / 徐工 LW500 量级)。品牌"锐工 RG856"是虚构的。
 *
 * 层级(和真车的运动链一致):
 *   root ── 铰接中心正下方的地面,朝向 = 后车架朝向
 *    ├─ 后车架:驾驶室(含内饰)、发动机罩、配重、散热器、油箱、挡泥板、梯子、变速箱、传动轴
 *    │    └─ rearAxle(摆动后桥,绕纵轴摆 ±12°)── 后轮 ×2
 *    ├─ 转向油缸 ×2(两端分别在前后车架上,每帧按铰接角更新)
 *    └─ front(绕铰接销转 γ)
 *         ├─ 前车架塔架、前桥、前挡泥板、大灯
 *         ├─ 前轮 ×2
 *         ├─ arm(动臂,绕 A 转 α)── 横梁、摇臂支座
 *         ├─ rocker(摇臂)、link(连杆)、bucket(铲斗,绕 B 转 β)
 *         └─ 举升缸 ×2、转斗缸 ×1(两端铰点每帧由六连杆解出)
 *
 * 局部系:x 朝前、y 朝上、z 朝右;铰接中心在原点。尺寸见 LOADER。
 */
import * as THREE from 'three';
import { LOADER_LINKAGE as LK, solveLoader } from './loader-kin.js';
import { add, bake, box, rbox, cylY, cylZ, extrude, extrudePlan, shapeFrom, linkShape, tube, rod, bolts, pipe } from '../model/geo.js';
import { HydraulicCylinder } from '../model/front.js';
import { buildOperator } from '../model/cab.js';
import { decalTexture } from '../model/materials.js';
import { wheelSet, Cylinder3D, steeringWheel, workLight, headLamp, mirror, handrail, beacon, step, pinZ, decal, cabShell } from './parts.js';

export const LOADER = {
  lf: 1.6, // 前桥到铰接销
  lr: 1.6, // 后桥到铰接销 —— 轴距 3.2 m
  track: 2.2,
  tireR: 0.81, // 23.5-25 工程胎
  tireW: 0.6,
  rimR: 0.33,
  gammaMax: 38 * (Math.PI / 180),
  bucketW: 3.0,
  capacity: 3.0, // m³ 堆装
  cab: { x0: -1.85, x1: -0.33, hw: 0.7, y0: 1.62, y1: 3.32 },
};

// ── 铲斗外形(设计系:铰点为原点,β = 0 时斗底水平) ─────────────────────
// 背板从顶部往下弯到斗底,斗底平,刃口在前;顶板往前伸出挡土檐。斗口 = 挡土檐前缘 → 刃口。
export const BUCKET_PROFILE = {
  outer: [
    [0.5, 0.95], // 挡土檐前缘
    [0.24, 0.98],
    [0.02, 0.9], // 顶板后缘
    [0.04, 0.62],
    [0.07, 0.36],
    [0.12, 0.13],
    [0.2, -0.09],
    [0.32, -0.27],
    [0.5, -0.41],
    [0.72, -0.49],
    [1.1, -0.51],
    [1.6, -0.51], // 刃口
  ],
  edge: [1.6, -0.51],
  tip: [1.79, -0.5], // 斗齿尖
  lip: [0.5, 0.95],
  floorY: -0.51,
};
const BP = BUCKET_PROFILE;

/** 斗腔多边形(内轮廓,往里缩一个板厚) */
export function bucketCavity(inset = 0.03) {
  const o = BP.outer;
  // 粗略地往"斗腔中心"缩一点就够了
  const cx = 0.7;
  const cy = 0.2;
  return o.map(([x, y]) => {
    const dx = cx - x;
    const dy = cy - y;
    const d = Math.hypot(dx, dy) || 1;
    return [x + (dx / d) * inset, y + (dy / d) * inset];
  });
}

/** 多边形被直线切:保留 (p - a)·n <= c 的那一侧(Sutherland–Hodgman) */
function clipPoly(poly, a, n, c) {
  const out = [];
  const f = (p) => (p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1] - c;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const fp = f(p);
    const fq = f(q);
    if (fp <= 0) out.push(p);
    if (fp * fq < 0) {
      const t = fp / (fp - fq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

/** 斗口法线(设计系,朝外) */
export const MOUTH = (() => {
  const [lx, ly] = BP.lip;
  const [ex, ey] = BP.edge;
  const dx = ex - lx;
  const dy = ey - ly;
  const L = Math.hypot(dx, dy);
  // 斗腔在斗口线的"背板"一侧;法线取另一侧
  return { a: BP.lip, n: [-dy / L, dx / L].map((v) => -v), len: L };
})();
// 检查:背板上的点应在法线负侧
{
  const p = [0.1, 0.2];
  const s = (p[0] - MOUTH.a[0]) * MOUTH.n[0] + (p[1] - MOUTH.a[1]) * MOUTH.n[1];
  if (s > 0) MOUTH.n = MOUTH.n.map((v) => -v);
}

function loaderMaterials(M) {
  const decalMat = (tex) => new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  return {
    model: decalMat(decalTexture('RG856', { color: '#151515' })),
    brand: decalMat(decalTexture([{ text: '锐工重工', font: 'bold 76px "Microsoft YaHei", sans-serif' }], { color: '#151515' })),
    stripe: decalMat(decalTexture([{ text: 'RUIGONG', font: 'bold 92px "Arial Black", sans-serif' }], { color: '#161616' })),
    warn: M.decalWarn,
    hazard: M.decalHazard,
    rated: decalMat(decalTexture(['额定载重 5000 kg', '斗容 3.0 m³'], { color: '#151515', w: 512, h: 160, font: 'bold 52px "Microsoft YaHei", sans-serif', bg: '#f2f2ea' })),
    grille: new THREE.MeshStandardMaterial({ map: M.louver.map, color: 0x9a9a9a, roughness: 0.6, metalness: 0.3 }),
  };
}

// ════════════════════════════════════════════════════════════════════════
export class LoaderModel {
  constructor(M) {
    this.M = M;
    this.D = loaderMaterials(M);
    this.root = new THREE.Group();
    this.rear = new THREE.Group();
    this.front = new THREE.Group();
    this.root.add(this.rear, this.front);

    this._buildRear();
    this._buildFront();
    this._buildLinkage();
    this._buildBucket();
    this._buildSteering();
    this._buildCab();

    this.pose = { alpha: LK.alphaMin, beta: 0, gamma: 0 };
    this.lin = null;
    this._beaconT = 0;
    this._monT = 0;
  }

  // ── 后车架 ────────────────────────────────────────────────────────────
  _buildRear() {
    const M = this.M;
    const D = this.D;
    const g = new THREE.Group();
    const C = LOADER.cab;

    // 大梁:两片侧板 + 上下翼缘 + 横梁
    const rail = shapeFrom([
      [-0.22, 0.58],
      [-0.22, 1.4],
      [-0.6, 1.46],
      [-2.9, 1.46],
      [-3.08, 1.3],
      [-3.08, 0.62],
      [-2.4, 0.55],
      [-0.9, 0.55],
    ]);
    for (const s of [-1, 1]) {
      add(g, extrude(rail, 0.05, 0.01), M.black, 0, 0, s * 0.45);
      add(g, box(2.8, 0.03, 0.16, -1.65, 1.47, s * 0.45), M.black);
    }
    for (const x of [-0.5, -1.1, -2.2, -2.95]) add(g, box(0.12, 0.5, 0.86, x, 1.05, 0), M.black);
    // 铰接耳板(上下各两片,夹住前车架的单耳)
    for (const y of [1.36, 1.14, 0.76, 0.54]) {
      const ear = linkShape([-0.4, 0], [0, 0], 0.2, 0.17);
      const m = add(g, extrude(ear, 0.05, 0.008), M.black, 0, y, 0);
      m.rotation.x = Math.PI / 2;
    }
    add(g, cylY(0.06, 1.0, 16, 0, 0.45, 0), M.pin); // 铰接销(上下贯通)
    for (const y of [1.42, 0.48]) add(g, cylY(0.09, 0.025, 16, 0, y, 0), M.steelDark);

    // 变速箱 + 传动轴(驾驶室下方)
    add(g, rbox(0.8, 0.55, 0.6, 0.06), M.steelDark, -0.95, 0.9, 0);
    add(g, rbox(0.35, 0.4, 0.5, 0.05), M.cast, -0.48, 0.92, 0.0);
    add(g, bolts([[-0.95, 1.17, -0.25], [-0.75, 1.17, -0.25], [-1.15, 1.17, -0.25], [-0.95, 1.17, 0.25], [-0.75, 1.17, 0.25], [-1.15, 1.17, 0.25]], 0.015, 0.02, 'y'), M.pin);
    add(g, rod([-0.3, 0.72, 0], [0.0, 0.76, 0], 0.045), M.steel); // 到铰接处的前传动轴
    add(g, rod([-1.35, 0.72, 0], [-1.45, 0.78, 0], 0.045), M.steel); // 到后桥
    for (const x of [-0.3, -1.38]) add(g, cylZ(0.07, 0.1, 12, x, 0.73, 0), M.steelDark);

    // 驾驶室平台(防滑板)+ 平台下的工具箱
    add(g, box(1.75, 0.06, 1.7, -1.08, 1.56, 0), M.black);
    add(g, box(1.6, 0.012, 0.25, -1.08, 1.6, -0.75), M.tread);
    add(g, rbox(0.55, 0.32, 0.3, 0.03), M.body, -1.45, 1.33, -0.62);

    // 左侧梯子(前后轮之间)+ 扶手
    for (let i = 0; i < 4; i++) step(g, M, -0.48, 0.48 + i * 0.28, -0.98, 0.36, 0.2);
    for (const x of [-0.29, -0.67]) add(g, box(0.03, 1.12, 0.06, x, 1.0, -0.98), M.black);
    handrail(g, M.body, [[-0.27, 1.62, -0.92], [-0.24, 2.1, -0.92], [-0.24, 2.7, -0.82]], 0.018);

    // 后挡泥板(带走台):顶面平、前后两端顺着轮胎弯下去
    for (const s of [-1, 1]) {
      const z = s * 1.12;
      const fen = new THREE.Group();
      const R0 = LOADER.tireR + 0.1;
      const pts = [];
      for (let i = 0; i <= 14; i++) {
        const a = Math.PI * 0.08 + (Math.PI * 0.84 * i) / 14;
        pts.push([-LOADER.lr + Math.cos(a) * R0, LOADER.tireR + Math.sin(a) * R0]);
      }
      // 挡泥板截面:沿圆弧的一条带 → 用一串扁盒拼
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[i + 1];
        const L = Math.hypot(x1 - x0, y1 - y0);
        const m = add(fen, box(L + 0.01, 0.035, 0.74), M.body, (x0 + x1) / 2, (y0 + y1) / 2, z);
        m.rotation.z = Math.atan2(y1 - y0, x1 - x0);
      }
      // 外侧翻边
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[i + 1];
        const L = Math.hypot(x1 - x0, y1 - y0);
        const m = add(fen, box(L + 0.01, 0.1, 0.03), M.bodyDark, (x0 + x1) / 2 + 0, (y0 + y1) / 2 - 0.03, z + s * 0.37);
        m.rotation.z = Math.atan2(y1 - y0, x1 - x0);
      }
      // 走台(挡泥板顶上的防滑板)
      add(fen, box(1.0, 0.02, 0.6, -LOADER.lr, LOADER.tireR + R0 + 0.03, z), M.tread);
      // 挡泥板支架
      add(fen, box(0.1, 0.5, 0.3, -LOADER.lr - 0.5, 1.45, s * 0.66), M.black);
      add(fen, box(0.1, 0.5, 0.3, -LOADER.lr + 0.5, 1.45, s * 0.66), M.black);
      g.add(fen);
      // 侧面警示贴
      decal(g, D.hazard, 0.5, 0.08, -LOADER.lr - 0.62, 1.55, z + s * 0.395, s > 0 ? 0 : Math.PI);
    }

    // 驾驶室后:液压油箱(右)、燃油箱(左)
    add(g, rbox(0.5, 0.82, 0.36, 0.04), M.body, -2.15, 1.88, 0.55);
    add(g, box(0.03, 0.3, 0.06, -1.89, 1.9, 0.6), M.black);
    add(g, box(0.01, 0.24, 0.04, -1.875, 1.9, 0.6), M.glassDark); // 液位观察窗
    add(g, cylY(0.05, 0.12, 12, -2.15, 2.29, 0.55), M.black); // 呼吸器
    add(g, rbox(0.5, 0.82, 0.36, 0.04), M.body, -2.15, 1.88, -0.55);
    add(g, cylY(0.07, 0.06, 14, -2.05, 2.29, -0.55), M.black); // 加油口
    // 燃油表
    add(g, cylZ(0.04, 0.02, 14, -2.0, 1.95, -0.74), M.chrome);
    add(g, cylZ(0.033, 0.005, 14, -2.0, 1.95, -0.752), M.glassDark);

    // ── 发动机罩:前高后低、两侧百叶、顶上检修门 ──
    const hood = shapeFrom([
      [-1.95, 1.46],
      [-1.95, 2.42],
      [-2.05, 2.5],
      [-2.92, 2.4],
      [-3.12, 2.22],
      [-3.12, 1.46],
    ]);
    add(g, extrude(hood, 1.3, 0.06), M.body, 0, 0, 0);
    for (const s of [-1, 1]) {
      const pl = add(g, new THREE.PlaneGeometry(0.8, 0.45), D.grille, -2.5, 1.9, s * 0.651);
      pl.rotation.y = s > 0 ? 0 : Math.PI;
      add(g, box(0.82, 0.02, 0.01, -2.5, 2.135, s * 0.655), M.bodyDark);
      add(g, box(0.82, 0.02, 0.01, -2.5, 1.665, s * 0.655), M.bodyDark);
      // 检修门缝 + 门锁
      add(g, box(0.012, 0.85, 0.008, -2.02, 1.92, s * 0.655), M.black);
      add(g, box(0.012, 0.75, 0.008, -2.98, 1.88, s * 0.655), M.black);
      add(g, rbox(0.06, 0.05, 0.02, 0.008), M.black, -2.1, 2.1, s * 0.66);
      // 品牌、型号
      decal(g, D.model, 0.55, 0.14, -2.52, 2.28, s * 0.656, s > 0 ? 0 : Math.PI);
    }
    // 顶部检修门 + 铰链
    add(g, rbox(0.7, 0.04, 1.1, 0.02), M.bodyDark, -2.45, 2.47, 0);
    add(g, box(0.62, 0.012, 0.9, -2.45, 2.495, 0), D.grille);
    // 排气管(带防雨帽)、空滤预滤器
    add(g, cylY(0.07, 0.62, 16, -2.25, 2.44, 0.35), M.pipe);
    add(g, cylY(0.09, 0.12, 16, -2.25, 2.42, 0.35), M.black);
    const cap = add(g, cylZ(0.08, 0.015, 16), M.steelDark, -2.21, 3.08, 0.35);
    cap.rotation.set(Math.PI / 2, 0, 0.4);
    this.exhaustTip = new THREE.Vector3(-2.25, 3.08, 0.35);
    add(g, cylY(0.06, 0.4, 14, -2.2, 2.45, -0.32), M.black);
    add(g, cylY(0.13, 0.22, 18, -2.2, 2.82, -0.32, 0.1), M.plastic);
    add(g, cylY(0.14, 0.02, 18, -2.2, 3.04, -0.32), M.black);
    // 吊装耳
    for (const s of [-1, 1]) add(g, extrude(linkShape([-2.8, 2.38], [-2.8, 2.48], 0.06, 0.05, 0.025), 0.03, 0.005), M.black, 0, 0, s * 0.45);

    // 散热器罩(车尾,大面积百叶):挤出的倒角会把机罩撑出 6 cm,格栅贴在倒角外面
    const rg = add(g, new THREE.PlaneGeometry(1.0, 0.62), D.grille, -3.183, 1.9, 0);
    rg.rotation.y = -Math.PI / 2;
    for (const y of [1.57, 2.23]) add(g, box(0.03, 0.04, 1.08, -3.18, y, 0), M.bodyDark);
    for (const z of [-0.52, 0.52]) add(g, box(0.03, 0.7, 0.04, -3.18, 1.9, z), M.bodyDark);
    add(g, box(0.02, 0.02, 0.96, -3.19, 1.9, 0), M.black);
    // ── 配重:铸造件,俯视是圆角的"U",后面鼓、两角收圆;顶面一圈倒角 ──
    const cwPlan = [];
    const cr = 0.3;
    const cx0 = -2.86;
    const cx1 = -3.42;
    const cz = 1.05;
    cwPlan.push([cx0, -cz]);
    for (let i = 0; i <= 8; i++) {
      const a2 = -Math.PI / 2 - (i / 8) * (Math.PI / 2);
      cwPlan.push([cx1 + cr + Math.cos(a2) * cr, -cz + cr + Math.sin(a2) * cr]);
    }
    for (let i = 0; i <= 8; i++) {
      const a2 = Math.PI - (i / 8) * (Math.PI / 2);
      cwPlan.push([cx1 + cr + Math.cos(a2) * cr, cz - cr + Math.sin(a2) * cr]);
    }
    cwPlan.push([cx0, cz]);
    add(g, extrudePlan(cwPlan, 0.5, 0.9, 0.07), M.body);
    // 顶面的台阶护边 + 底部护板
    add(g, extrudePlan(cwPlan.map(([x, z]) => [x + 0.04, z * 0.97]), 1.38, 0.06, 0.02), M.bodyDark);
    add(g, box(0.5, 0.06, 1.9, -3.12, 0.48, 0), M.black);
    // 灯组:嵌在配重后面的凹槽里(尾灯/刹车灯、转向灯、倒车灯)+ 反光片
    for (const s2 of [-1, 1]) {
      add(g, rbox(0.06, 0.2, 0.42, 0.03), M.black, cx1 - 0.045, 1.2, s2 * 0.72);
      add(g, box(0.02, 0.13, 0.13), M.tailLight, cx1 - 0.08, 1.2, s2 * 0.84);
      add(g, box(0.02, 0.13, 0.1), M.reflector, cx1 - 0.08, 1.2, s2 * 0.71);
      add(g, box(0.02, 0.13, 0.1), M.lightLens, cx1 - 0.08, 1.2, s2 * 0.6);
      add(g, box(0.02, 0.05, 0.22), M.reflector, cx1 - 0.075, 0.72, s2 * 0.75);
    }
    add(g, box(0.28, 0.22, 0.4, cx1 - 0.08, 0.72, 0), M.steelDark); // 牵引座
    add(g, cylY(0.045, 0.34, 12, cx1 - 0.16, 0.56, 0), M.pin);
    add(g, cylY(0.07, 0.02, 12, cx1 - 0.16, 0.9, 0), M.pin);
    decal(g, D.stripe, 0.9, 0.18, cx1 - 0.075, 1.0, 0, -Math.PI / 2);
    // 发动机罩后两角的示廓灯
    for (const s2 of [-1, 1]) add(g, rbox(0.05, 0.08, 0.08, 0.02), M.reflector, -3.18, 2.32, s2 * 0.55);

    // 后桥中心的摆动座
    add(g, rbox(0.5, 0.3, 0.55, 0.04), M.black, -LOADER.lr, 1.18, 0);

    this.rear.add(bake(g));

    // ── 摆动后桥 + 后轮 ──
    const axle = new THREE.Group();
    axle.position.set(-LOADER.lr, LOADER.tireR, 0);
    const ag = new THREE.Group();
    this._axle(ag, M);
    axle.add(bake(ag));
    this.rear.add(axle);
    this.rearAxle = axle;
    const mk = wheelSet(M, { R: LOADER.tireR, W: LOADER.tireW, rimR: LOADER.rimR, pattern: 'L3', depth: 0.055, pitch: 21, hubR: 0.2, hubOut: 0.16, nuts: 18, style: 'loader' });
    this.wheels = [];
    for (const s of [-1, 1]) {
      const w = mk(s);
      w.position.set(0, 0, s * LOADER.track / 2);
      axle.add(w);
      this.wheels.push({ g: w, front: false });
    }
    this._mkWheel = mk;
  }

  /** 驱动桥:桥壳 + 主减速器鼓包 + 制动钳 */
  _axle(g, M) {
    add(g, cylZ(0.13, 1.95, 20, 0, 0, 0), M.steelDark);
    const diff = new THREE.SphereGeometry(0.3, 24, 16);
    diff.scale(1, 1, 0.75);
    add(g, diff, M.cast, 0.02, 0, 0);
    add(g, cylZ(0.2, 0.05, 24, 0.02, 0, 0.23), M.cast);
    add(g, bolts(Array.from({ length: 10 }, (_, i) => [0.02 + Math.cos((i / 10) * 6.28) * 0.17, Math.sin((i / 10) * 6.28) * 0.17, 0.26]), 0.012, 0.02, 'z'), M.pin);
    for (const s of [-1, 1]) {
      add(g, cylZ(0.17, 0.1, 20, 0, 0, s * 0.75), M.cast); // 桥壳法兰
      add(g, rbox(0.14, 0.22, 0.1, 0.02), M.plasticRed, 0.0, 0.2, s * 0.86); // 制动钳(红)
      add(g, cylZ(0.27, 0.025, 28, 0, 0, s * 0.82), M.steel); // 制动盘
    }
    add(g, cylY(0.025, 0.06, 8, 0.1, 0.27, 0.1), M.black); // 通气塞
  }

  // ── 前车架 ────────────────────────────────────────────────────────────
  _buildFront() {
    const M = this.M;
    const g = new THREE.Group();
    const plate = shapeFrom([
      [0.18, 0.55],
      [0.18, 1.42],
      [0.55, 1.58],
      [0.66, 2.2],
      [0.88, 2.38],
      [1.18, 2.36],
      [1.48, 2.05],
      [1.8, 1.82],
      [2.08, 1.4],
      [2.3, 1.12],
      [2.32, 0.98],
      [2.0, 0.98],
      [1.86, 1.02],
      [1.34, 1.02],
      [1.2, 0.98],
      [0.7, 0.62],
    ]);
    for (const s of [-1, 1]) {
      add(g, extrude(plate, 0.05, 0.01), M.body, 0, 0, s * 0.42);
      // 动臂根铰凸台 + 轴套
      add(g, cylZ(0.21, 0.12, 28, LK.A[0], LK.A[1], s * 0.46), M.body);
      add(g, cylZ(0.11, 0.14, 20, LK.A[0], LK.A[1], s * 0.47), M.steelDark);
      // 举升缸缸底耳座(车架外侧)
      for (const d of [-0.07, 0.07]) {
        const ear = linkShape([LK.D[0] - 0.25, LK.D[1] + 0.35], [LK.D[0], LK.D[1]], 0.13, 0.12);
        add(g, extrude(ear, 0.035, 0.006), M.body, 0, 0, s * 0.66 + d);
      }
      pinZ(g, M, LK.D[0], LK.D[1], s * 0.66, 0.05, 0.22);
      add(g, box(0.4, 0.5, 0.26, LK.D[0] - 0.24, LK.D[1] + 0.32, s * 0.55), M.body);
    }
    // 上下翼缘、横梁
    add(g, box(1.6, 0.04, 0.89, 1.32, 0.99, 0), M.body);
    add(g, box(0.5, 0.35, 0.8, 0.45, 1.25, 0), M.body);
    // 转斗缸缸底支座(两片耳板夹在中间)
    for (const d of [-0.08, 0.08]) {
      const ear = linkShape([LK.C[0] - 0.3, LK.C[1] - 0.25], [LK.C[0], LK.C[1]], 0.15, 0.13);
      add(g, extrude(ear, 0.04, 0.006), M.body, 0, 0, d);
    }
    pinZ(g, M, LK.C[0], LK.C[1], 0, 0.055, 0.24);
    add(g, box(0.5, 0.06, 0.84, LK.C[0] - 0.25, LK.C[1] - 0.32, 0), M.body);
    // 铰接单耳(上下)
    for (const y of [1.25, 0.65]) {
      const ear = linkShape([0.0, 0], [0.4, 0], 0.17, 0.2);
      const m = add(g, extrude(ear, 0.12, 0.01), M.body, 0, y, 0);
      m.rotation.x = Math.PI / 2;
    }
    // 前传动轴(铰接处有万向节)
    add(g, rod([0.02, 0.76, 0], [LOADER.lf - 0.3, 0.8, 0], 0.045), M.steel);
    add(g, cylZ(0.07, 0.1, 12, 0.05, 0.76, 0), M.steelDark);
    // 前桥
    const ag = new THREE.Group();
    this._axle(ag, M);
    ag.position.set(LOADER.lf, LOADER.tireR, 0);
    ag.rotation.y = Math.PI;
    g.add(ag);
    // 前桥安装座
    for (const s of [-1, 1]) add(g, box(0.5, 0.06, 0.24, LOADER.lf, 0.96, s * 0.4), M.black);

    // 前挡泥板 + 大灯 + 转向灯
    for (const s of [-1, 1]) {
      const z = s * 1.1;
      const R0 = LOADER.tireR + 0.09;
      const pts = [];
      for (let i = 0; i <= 10; i++) {
        const a = Math.PI * 0.12 + (Math.PI * 0.6 * i) / 10;
        pts.push([LOADER.lf + Math.cos(a) * R0, LOADER.tireR + Math.sin(a) * R0]);
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[i + 1];
        const L = Math.hypot(x1 - x0, y1 - y0);
        const m = add(g, box(L + 0.01, 0.03, 0.72), M.body, (x0 + x1) / 2, (y0 + y1) / 2, z);
        m.rotation.z = Math.atan2(y1 - y0, x1 - x0);
        const f = add(g, box(L + 0.01, 0.08, 0.025), M.bodyDark, (x0 + x1) / 2, (y0 + y1) / 2 - 0.025, z + s * 0.36);
        f.rotation.z = m.rotation.z;
      }
      // 挡泥板支架(从车架伸出)
      add(g, rod([1.3, 1.25, s * 0.45], [1.25, 1.62, s * 0.85], 0.03), M.black);
      add(g, rod([1.95, 1.2, s * 0.45], [2.0, 1.6, s * 0.85], 0.03), M.black);
      headLamp(g, M, 2.12, 1.72, s * 1.06, 0);
      add(g, rbox(0.05, 0.07, 0.12, 0.015), M.reflector, 2.13, 1.55, s * 1.06);
    }
    this.front.add(bake(g));

    this.frontWheels = [];
    for (const s of [-1, 1]) {
      const w = this._mkWheel(s);
      w.position.set(LOADER.lf, LOADER.tireR, s * LOADER.track / 2);
      this.front.add(w);
      this.wheels.push({ g: w, front: true });
    }
  }

  // ── 工作装置:动臂、摇臂、连杆、油缸 ────────────────────────────────
  _buildLinkage() {
    const M = this.M;
    // 动臂:弯板,下缘在举升缸耳处鼓出,两端是轴套凸台
    const arm = new THREE.Group();
    arm.position.set(LK.A[0], LK.A[1], 0);
    const ag = new THREE.Group();
    const La = LK.La;
    const up = [
      [0.0, 0.22],
      [0.45, 0.3],
      [1.0, 0.36],
      [1.6, 0.34],
      [2.2, 0.26],
      [2.7, 0.2],
      [La, 0.17],
    ];
    const lo = [
      [La, -0.17],
      [2.6, -0.2],
      [2.0, -0.2],
      [1.3, -0.2],
      [0.95, -0.27],
      [0.75, -0.32],
      [0.5, -0.27],
      [0.15, -0.2],
      [0.0, -0.21],
    ];
    const armShape = new THREE.Shape();
    armShape.moveTo(...up[0]);
    for (const p of up.slice(1)) armShape.lineTo(...p);
    armShape.absarc(La, 0, 0.17, Math.PI / 2, -Math.PI / 2, true);
    for (const p of lo.slice(1)) armShape.lineTo(...p);
    armShape.absarc(0, 0, 0.215, -Math.PI / 2, Math.PI / 2, true);
    for (const s of [-1, 1]) {
      add(ag, extrude(armShape, 0.1, 0.018, 12), M.boom, 0, 0, s * 0.52);
      // 轴套 + 销轴
      add(ag, cylZ(0.12, 0.14, 20, 0, 0, s * 0.52), M.steelDark);
      add(ag, cylZ(0.1, 0.14, 20, La, 0, s * 0.52), M.steelDark);
      // 举升缸耳
      for (const d of [-0.075, 0.075]) {
        const ear = linkShape([LK.E[0] - 0.15, -0.15], [LK.E[0], LK.E[1] - 0.02], 0.11, 0.1);
        add(ag, extrude(ear, 0.03, 0.005), M.boom, 0, 0, s * 0.66 + d);
      }
      pinZ(ag, M, LK.E[0], LK.E[1], s * 0.66, 0.045, 0.2);
      add(ag, box(0.25, 0.12, 0.16, LK.E[0] - 0.08, -0.15, s * 0.6), M.boom);
      // 黄油嘴
      add(ag, cylY(0.012, 0.03, 6, 0.0, 0.22, s * 0.6), M.chrome);
    }
    // 横梁(箱形)+ 摇臂支座
    add(ag, rbox(0.32, 0.36, 1.0, 0.03), M.boom, LK.R[0] - 0.05, 0.02, 0);
    for (const d of [-0.12, 0.12]) {
      const sup = shapeFrom([
        [LK.R[0] - 0.25, 0.15],
        [LK.R[0] + 0.2, 0.15],
        [LK.R[0] + 0.12, LK.R[1]],
        [LK.R[0] - 0.1, LK.R[1] + 0.08],
      ]);
      add(ag, extrude(sup, 0.04, 0.008), M.boom, 0, 0, d);
      add(ag, cylZ(0.13, 0.05, 20, LK.R[0], LK.R[1], d), M.boom);
    }
    pinZ(ag, M, LK.R[0], LK.R[1], 0, 0.06, 0.32);
    // 沿动臂的转斗管路(钢管)
    for (const s of [-1, 1]) add(ag, pipe([[0.2, 0.36, s * 0.44], [1.2, 0.42, s * 0.44], [2.2, 0.3, s * 0.44]], 0.014), M.pipe);
    arm.add(bake(ag));
    this.front.add(arm);
    this.arm = arm;

    // 摇臂(两片):在摇臂局部系里 Rt 在 +X 方向 r1 处,Rb 在 γ 方向 r2 处
    const rocker = new THREE.Group();
    const rg = new THREE.Group();
    const pT = [LK.r1, 0];
    const pB = [Math.cos(LK.gamma) * LK.r2, Math.sin(LK.gamma) * LK.r2];
    for (const d of [-0.075, 0.075]) {
      add(rg, extrude(linkShape([0, 0], pT, 0.15, 0.12), 0.04, 0.008), M.boom, 0, 0, d);
      add(rg, extrude(linkShape([0, 0], pB, 0.15, 0.12), 0.04, 0.008), M.boom, 0, 0, d);
    }
    add(rg, cylZ(0.1, 0.2, 18, 0, 0, 0), M.steelDark);
    pinZ(rg, M, pT[0], pT[1], 0, 0.05, 0.22);
    pinZ(rg, M, pB[0], pB[1], 0, 0.05, 0.22);
    add(rg, box(0.25, 0.08, 0.15, pT[0] * 0.45, pT[1] * 0.45 + 0.02, 0), M.boom); // 筋板
    rocker.add(bake(rg));
    this.front.add(rocker);
    this.rocker = rocker;

    // 连杆:锻造直杆,两端孔
    const link = new THREE.Group();
    const lg = new THREE.Group();
    add(lg, extrude(linkShape([0, 0], [LK.Ll, 0], 0.1, 0.1, 0.045), 0.1, 0.015), M.boom);
    link.add(bake(lg));
    this.front.add(link);
    this.link = link;

    // 油缸:举升缸 ×2(车架外侧),转斗缸 ×1(中间,大缸径)
    this.liftCyls = [-1, 1].map((s) => {
      const c = new HydraulicCylinder(M, { barrelR: 0.095, rodR: 0.06 }, 1.02, s * 0.66, 1);
      this.front.add(c.group);
      return c;
    });
    this.tiltCyl = new HydraulicCylinder(M, { barrelR: 0.11, rodR: 0.07 }, 0.98, 0, 1);
    this.front.add(this.tiltCyl.group);
  }

  // ── 铲斗 ──────────────────────────────────────────────────────────────
  _buildBucket() {
    const M = this.M;
    const bucket = new THREE.Group();
    const bg = new THREE.Group();
    const W = LOADER.bucketW;
    const o = BP.outer;
    // 斗壳:沿外轮廓的一串钢板条(背板、斗底),外面黄、里面磨亮
    for (let i = 1; i < o.length - 1; i++) {
      const [x0, y0] = o[i];
      const [x1, y1] = o[i + 1];
      const L = Math.hypot(x1 - x0, y1 - y0);
      const a = Math.atan2(y1 - y0, x1 - x0);
      const nx = Math.sin(a) * 0.015;
      const ny = -Math.cos(a) * 0.015;
      const m = add(bg, box(L + 0.02, 0.03, W - 0.06), M.boom, (x0 + x1) / 2 + nx, (y0 + y1) / 2 + ny, 0);
      m.rotation.z = a;
      const inn = add(bg, box(L + 0.02, 0.006, W - 0.1), M.bucketIn, (x0 + x1) / 2 - nx * 2.2, (y0 + y1) / 2 - ny * 2.2, 0);
      inn.rotation.z = a;
    }
    // 顶板 + 挡土檐
    for (let i = 0; i < 2; i++) {
      const [x0, y0] = o[i];
      const [x1, y1] = o[i + 1];
      const L = Math.hypot(x1 - x0, y1 - y0);
      const m = add(bg, box(L + 0.04, 0.04, W), M.boom, (x0 + x1) / 2, (y0 + y1) / 2, 0);
      m.rotation.z = Math.atan2(y1 - y0, x1 - x0);
    }
    add(bg, box(0.08, 0.1, W + 0.02, BP.lip[0], BP.lip[1] - 0.02, 0), M.boom);
    // 侧板(带侧刃):轮廓 = 外轮廓 + 斗口线
    const sidePts = [...o, BP.tip.map((v, i) => (i ? v : v - 0.05))];
    const side = shapeFrom(sidePts);
    for (const s of [-1, 1]) {
      add(bg, extrude(side, 0.04, 0.006), M.boom, 0, 0, s * (W / 2 - 0.02));
      // 侧刃(斗口边沿的耐磨板)
      const [lx, ly] = BP.lip;
      const [ex, ey] = BP.edge;
      const L = Math.hypot(ex - lx, ey - ly);
      const m = add(bg, box(L, 0.1, 0.05), M.tooth, (lx + ex) / 2 + 0.03, (ly + ey) / 2 + 0.02, s * (W / 2 - 0.01));
      m.rotation.z = Math.atan2(ey - ly, ex - lx);
      // 侧板加强筋
      add(bg, box(0.6, 0.06, 0.03), M.boom, 0.35, 0.3, s * (W / 2 + 0.02), 0, 0, -0.9);
    }
    // 刃口板(厚、耐磨)+ 斗底耐磨条
    add(bg, box(0.32, 0.05, W - 0.04, BP.edge[0] - 0.12, BP.floorY + 0.02, 0), M.tooth);
    for (const z of [-1.1, -0.4, 0.4, 1.1]) add(bg, box(0.75, 0.035, 0.1, 1.0, BP.floorY - 0.025, z), M.steelDark);
    // 斗齿 ×8:齿座焊在刃口上下,齿尖楔形
    const tooth = shapeFrom([
      [0, 0.035],
      [0.13, 0.03],
      [BP.tip[0] - BP.edge[0] + 0.02, 0.0],
      [0.13, -0.03],
      [0, -0.035],
    ]);
    for (let i = 0; i < 8; i++) {
      const z = -W / 2 + 0.22 + (i * (W - 0.44)) / 7;
      add(bg, extrude(tooth, 0.1, 0.01), M.tooth, BP.edge[0] - 0.02, BP.floorY + 0.01, z);
      add(bg, box(0.22, 0.09, 0.12, BP.edge[0] - 0.05, BP.floorY + 0.01, z), M.steelDark);
      add(bg, cylZ(0.015, 0.14, 8, BP.edge[0] + 0.02, BP.floorY + 0.01, z), M.pin);
    }
    // 背面:铰点耳板 ×2 对、连杆耳板 ×1 对、背板加强筋
    for (const zc of [-0.52, 0.52]) {
      for (const d of [-0.075, 0.075]) {
        const ear = shapeFrom([
          [0.0, -0.17],
          [0.25, -0.2],
          [0.16, 0.25],
          [0.0, 0.16],
          [-0.15, 0.0],
        ]);
        add(bg, extrude(ear, 0.035, 0.006), M.boom, 0, 0, zc + d);
      }
      pinZ(bg, M, 0, 0, zc, 0.06, 0.24);
    }
    for (const d of [-0.07, 0.07]) {
      const ear = shapeFrom([
        [LK.lug[0], LK.lug[1] + 0.12],
        [0.08, LK.lug[1] + 0.2],
        [0.07, LK.lug[1] - 0.25],
        [LK.lug[0] - 0.02, LK.lug[1] - 0.1],
      ]);
      add(bg, extrude(ear, 0.035, 0.006), M.boom, 0, 0, d);
      add(bg, cylZ(0.1, 0.035, 18, LK.lug[0], LK.lug[1], d), M.boom);
    }
    pinZ(bg, M, LK.lug[0], LK.lug[1], 0, 0.05, 0.2);
    // 背板加强筋:贴在背板外面(背板外表面 x ≈ 0.02~0.07)
    for (const z of [-1.2, -0.25, 0.25, 1.2]) add(bg, box(0.05, 0.5, 0.06), M.boom, -0.01, 0.6, z, 0, 0, -0.06);
    // 限位块
    for (const z of [-0.8, 0.8]) add(bg, box(0.12, 0.12, 0.12, -0.02, 0.62, z), M.steelDark);
    bucket.add(bake(bg));

    // 斗里的土:按装满程度预先做好几档(斗口平行面切斗腔 + 冒尖)
    this.soil = this._buildSoil(M);
    bucket.add(this.soil.group);

    this.front.add(bucket);
    this.bucket = bucket;
  }

  _buildSoil(M) {
    const group = new THREE.Group();
    const cav = bucketCavity(0.035);
    const n = MOUTH.n;
    const a = MOUTH.a;
    // 最深处到斗口线的距离
    let dmax = 0;
    for (const p of cav) dmax = Math.max(dmax, -((p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1]));
    const levels = [];
    const W = LOADER.bucketW - 0.12;
    const N = 10;
    for (let i = 1; i <= N; i++) {
      const f = i / N;
      // 体积大致按面积随深度变化,用 sqrt 让小装载量时也看得见
      const c = -(1 - Math.pow(f, 0.8)) * dmax;
      const poly = clipPoly(cav, a, n, c);
      if (poly.length < 3) continue;
      const m = new THREE.Mesh(extrude(shapeFrom(poly), W, 0.02, 4), M.soil);
      m.castShadow = true;
      m.visible = false;
      group.add(m);
      levels.push({ f, m });
    }
    // 冒尖:斗口外面的一个圆顶(沿 z 方向两头收)
    const heapShape = new THREE.Shape();
    const [lx, ly] = BP.lip;
    const [ex, ey] = BP.edge;
    const mx = (lx + ex) / 2;
    const my = (ly + ey) / 2;
    const L = MOUTH.len;
    heapShape.moveTo(-L / 2, 0);
    heapShape.quadraticCurveTo(0, 0.55, L / 2, 0);
    heapShape.lineTo(-L / 2, 0);
    const hg = extrude(heapShape, W, 0.06, 8);
    const pos = hg.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i) / (W / 2);
      const k = Math.cos(Math.min(1, Math.abs(z)) * Math.PI * 0.45);
      pos.setY(i, pos.getY(i) * k);
    }
    hg.computeVertexNormals();
    const heap = new THREE.Mesh(hg, M.soil);
    heap.castShadow = true;
    heap.position.set(mx, my, 0);
    // 圆顶的"上"(+y)要朝斗口法线方向
    heap.rotation.z = Math.atan2(MOUTH.n[1], MOUTH.n[0]) - Math.PI / 2;
    heap.visible = false;
    group.add(heap);
    return {
      group,
      set(f) {
        let best = null;
        for (const l of levels) if (f >= l.f - 0.05) best = l;
        for (const l of levels) l.m.visible = l === best && f > 0.02;
        const over = Math.max(0, f - 1);
        heap.visible = over > 0.01;
        heap.scale.set(1, Math.min(1, over / 0.25), 1);
      },
    };
  }

  // ── 转向油缸 ──────────────────────────────────────────────────────────
  _buildSteering() {
    this.steerCyls = [-1, 1].map((s) => {
      const c = new Cylinder3D(this.M, { barrelR: 0.06, rodR: 0.035 }, 0.62);
      c.side = s;
      this.root.add(c.holder);
      return c;
    });
    this._sA = new THREE.Vector3();
    this._sB = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  // ── 驾驶室 ────────────────────────────────────────────────────────────
  _buildCab() {
    const M = this.M;
    const C = LOADER.cab;
    const { cab, shell, glass, L, H, hw, y0 } = cabShell(M, C, { grille: this.D.grille });
    this.rear.add(cab);

    // ── 内饰 ──
    const it = shell;
    add(it, box(L - 0.08, 0.04, hw * 2 - 0.06, (C.x0 + C.x1) / 2, y0 + 0.02, 0), M.floorMat);
    const seatX = C.x0 + 0.62;
    add(it, rbox(0.42, 0.24, 0.44, 0.03), M.plastic, seatX, y0 + 0.16, 0);
    add(it, rbox(0.5, 0.13, 0.5, 0.05), M.seatFabric, seatX + 0.02, y0 + 0.42, 0);
    const back = add(it, rbox(0.13, 0.66, 0.5, 0.05), M.seatFabric, seatX - 0.25, y0 + 0.78, 0);
    back.rotation.z = 0.14;
    add(it, rbox(0.1, 0.18, 0.3, 0.04), M.seatFabric, seatX - 0.32, y0 + 1.2, 0).rotation.z = 0.14;
    add(it, rod([seatX - 0.2, y0 + 0.48, -0.25], [seatX + 0.05, y0 + 0.49, -0.27], 0.012), M.plasticRed);
    // 右操纵台(先导手柄 + FNR 开关在手柄上)
    add(it, rbox(0.6, 0.42, 0.2, 0.03), M.plastic, seatX + 0.02, y0 + 0.5, 0.37);
    add(it, rbox(0.3, 0.07, 0.14, 0.03), M.seatFabric, seatX - 0.1, y0 + 0.74, 0.37);
    add(it, rbox(0.2, 0.06, 0.18, 0.02), M.plastic, seatX + 0.25, y0 + 0.72, 0.37);
    for (let i = 0; i < 4; i++) add(it, box(0.03, 0.015, 0.03), M.plasticLight, seatX + 0.04 + i * 0.05, y0 + 0.725, 0.43);
    // 仪表台 + 转向柱
    const dashX = C.x1 - 0.22;
    add(it, rbox(0.3, 0.55, hw * 2 - 0.1, 0.04), M.plastic, dashX + 0.05, y0 + 0.3, 0);
    add(it, rbox(0.22, 0.12, 0.7, 0.04), M.plastic, dashX, y0 + 0.62, 0).rotation.z = 0.5;
    // 踏板:左制动(带变速切断)、右制动、油门
    this.pedals = {};
    const pedal = (name, z, w, h, mat) => {
      const p = new THREE.Group();
      p.position.set(dashX - 0.05, y0 + 0.12, z);
      const m = new THREE.Mesh(rbox(w, 0.02, h, 0.008), mat);
      m.position.set(0.0, 0.1, 0);
      m.rotation.z = 0.9;
      p.add(m);
      cab.add(p);
      this.pedals[name] = p;
    };
    pedal('brake', -0.12, 0.2, 0.12, M.tread);
    pedal('brake2', 0.05, 0.2, 0.12, M.tread);
    pedal('accel', 0.2, 0.26, 0.1, M.tread);
    // 灭火器
    add(it, cylY(0.05, 0.34, 14, C.x0 + 0.15, y0 + 0.2, 0.42), M.plasticRed);

    cab.add(bake(shell));
    cab.add(glass);

    // 会动的件:方向盘、先导手柄、FNR 拨杆、驻车制动按钮、仪表屏
    const sw = steeringWheel(M, 0.2);
    sw.group.position.set(dashX - 0.06, y0 + 0.84, 0);
    sw.group.rotation.set(0, -Math.PI / 2, 0, 'YXZ');
    sw.group.rotateX(-0.75);
    cab.add(sw.group);
    this.steer = sw.wheel;
    // 手柄
    const js = new THREE.Group();
    js.position.set(seatX + 0.25, y0 + 0.76, 0.37);
    const bootG = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.05, 0.05, 12), M.rubber);
    bootG.position.y = 0.02;
    js.add(bootG);
    const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.12, 8), M.chrome);
    sh.position.y = 0.08;
    js.add(sh);
    const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.08, 6, 12), M.plastic);
    grip.position.set(0.008, 0.17, 0);
    js.add(grip);
    const fnr = new THREE.Mesh(box(0.02, 0.012, 0.03), M.plasticRed);
    fnr.position.set(-0.02, 0.2, 0);
    js.add(fnr);
    this.fnrSwitch = fnr;
    cab.add(js);
    this.joystick = js;
    // 转向柱左边的换向拨杆
    const fl = new THREE.Group();
    fl.position.set(dashX - 0.05, y0 + 0.8, -0.12);
    const flm = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.22, 8), M.black);
    flm.rotation.z = Math.PI / 2;
    flm.position.x = -0.1;
    fl.add(flm);
    const flk = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), M.plasticRed);
    flk.position.x = -0.21;
    fl.add(flk);
    cab.add(fl);
    this.fnrLever = fl;
    // 仪表屏
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 200;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.15), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    scr.position.set(dashX - 0.02, y0 + 0.72, 0.0);
    scr.rotation.set(0, -Math.PI / 2, 0, 'YXZ');
    scr.rotateX(-0.6);
    cab.add(scr);
    this.monitor = { canvas, ctx: canvas.getContext('2d'), tex };

    // 操作员 + 视点
    this.operator = buildOperator(M);
    this.operator.position.set(seatX + 0.02, y0 + 0.48, 0);
    cab.add(this.operator);
    this.eye = new THREE.Object3D();
    this.eye.position.set(seatX + 0.05, y0 + 1.3, 0);
    cab.add(this.eye);
    this.cab = cab;
    this.beacon = beacon(cab, M, C.x0 + 0.2, C.y1 + 0.08, -0.45);
  }

  // ════════════════════════════════════════════════════════════════════
  /** pose: { alpha 动臂角, Lt 转斗缸长度, gamma 铰接角, roll 后桥摆角 } */
  setPose(p) {
    this.front.rotation.y = p.gamma;
    const s = solveLoader(LK, p.alpha, p.Lt);
    if (!s) return null;
    this.lin = s;
    this.pose = { ...p, beta: s.beta };
    this.arm.rotation.z = p.alpha;
    this.rocker.position.set(s.R.x, s.R.y, 0);
    this.rocker.rotation.z = s.phi;
    this.link.position.set(s.Rb.x, s.Rb.y, 0);
    this.link.rotation.z = Math.atan2(s.Pb.y - s.Rb.y, s.Pb.x - s.Rb.x);
    this.bucket.position.set(s.B.x, s.B.y, 0);
    this.bucket.rotation.z = s.beta;
    for (const c of this.liftCyls) c.update(s.D, s.E);
    this.tiltCyl.update(s.C, s.Rt);
    this.rearAxle.rotation.x = p.axleRoll || 0;
    // 转向缸:缸底在后车架,杆端在前车架(随 γ 转)
    const cg = Math.cos(p.gamma);
    const sg = Math.sin(p.gamma);
    for (const c of this.steerCyls) {
      const z = c.side * 0.4;
      this._sA.set(-0.78, 1.0, c.side * 0.36);
      const fx = 0.55;
      this._sB.set(fx * cg + z * sg, 1.0, -fx * sg + z * cg);
      c.update(this._sA, this._sB, this._up);
    }
    return s;
  }

  setSoil(f) {
    this.soil.set(f);
  }

  /** 车轮滚动:front/rear 是本帧走过的路程 */
  roll(front, rear) {
    for (const w of this.wheels) w.g.rotation.z -= (w.front ? front : rear) / LOADER.tireR;
  }

  /** 驾驶室里的操纵件跟着输入动 */
  setControls(c) {
    this.steer.rotation.z = -c.steer * 2.2;
    this.joystick.rotation.z = -c.lift * 0.3;
    this.joystick.rotation.x = c.tilt * 0.3;
    this.pedals.accel.rotation.z = -c.accel * 0.3;
    this.pedals.brake.rotation.z = -c.brake * 0.3;
    this.pedals.brake2.rotation.z = -c.brake * 0.3;
    this.fnrLever.rotation.y = c.dir * 0.35;
    this.fnrSwitch.position.z = c.dir * 0.01;
  }

  updateFx(dt, s) {
    const M = this.M;
    if (s.running) {
      this._beaconT += dt;
      this.beacon.refl.rotation.y = this._beaconT * 7;
      const k = 0.5 + 0.5 * Math.sin(this._beaconT * 14);
      M.beacon.emissive.setRGB(k, 0.45 * k, 0);
    } else M.beacon.emissive.setRGB(0, 0, 0);
    M.lightLens.emissive.setRGB(s.lights ? 1 : 0, s.lights ? 0.95 : 0, s.lights ? 0.8 : 0);
    M.tailLight.emissive.setRGB(s.braking ? 0.9 : s.power ? 0.35 : 0.08, 0, 0);
    this._monT -= dt;
    if (this._monT <= 0) {
      this._monT = 0.2;
      drawLoaderMonitor(this.monitor, s);
    }
  }

  getEye(pos, quat) {
    this.eye.getWorldPosition(pos);
    this.cab.getWorldQuaternion(quat);
    return pos;
  }
  setOperatorVisible(v) {
    this.operator.visible = v;
  }
  exhaustWorld(out = new THREE.Vector3()) {
    out.copy(this.exhaustTip);
    return this.rear.localToWorld(out);
  }
  /** 斗齿尖中点(世界) */
  getTipWorld(t = new THREE.Vector3()) {
    t.set(BP.tip[0], BP.tip[1], 0);
    return this.bucket.localToWorld(t);
  }
  bucketLocalToWorld(x, y, z, out) {
    return this.bucket.localToWorld(out.set(x, y, z));
  }
}

/** 仪表屏:车速、档位、转速、驻车、油温 */
export function drawLoaderMonitor(mon, s) {
  const g = mon.ctx;
  const w = mon.canvas.width;
  const h = mon.canvas.height;
  g.fillStyle = s.power ? '#0b1420' : '#050607';
  g.fillRect(0, 0, w, h);
  if (!s.power) {
    mon.tex.needsUpdate = true;
    return;
  }
  if (s.selfTest) {
    g.fillStyle = '#1d6fd1';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff';
    g.font = 'bold 30px "Microsoft YaHei", sans-serif';
    g.textAlign = 'center';
    g.fillText('锐工 RG856', w / 2, h / 2);
    mon.tex.needsUpdate = true;
    return;
  }
  g.textAlign = 'left';
  g.fillStyle = '#16263a';
  g.fillRect(0, 0, w, 40);
  g.font = 'bold 28px Arial';
  g.fillStyle = s.dir === 1 ? '#6fe38a' : s.dir === -1 ? '#ff9a3a' : '#ffd24a';
  g.fillText(s.dir === 1 ? 'F' : s.dir === -1 ? 'R' : 'N', 12, 30);
  g.fillStyle = '#cfe0f2';
  g.fillText(String(s.gear), 46, 30);
  if (s.parkBrake) {
    g.fillStyle = '#ff4d3a';
    g.font = 'bold 22px "Microsoft YaHei", sans-serif';
    g.fillText('(P) 驻车', 90, 29);
  }
  g.textAlign = 'right';
  g.fillStyle = '#9fb2c8';
  g.font = '18px Arial';
  g.fillText(`${s.hours.toFixed(1)} h`, w - 10, 28);
  g.textAlign = 'center';
  g.fillStyle = '#e8f0f8';
  g.font = 'bold 60px Arial';
  g.fillText(Math.abs(s.speed * 3.6).toFixed(0), w / 2 - 40, 118);
  g.font = '16px Arial';
  g.fillStyle = '#9fb2c8';
  g.fillText('km/h', w / 2 - 40, 140);
  g.font = 'bold 30px Arial';
  g.fillStyle = '#cfe0f2';
  g.fillText(String(Math.round(s.rpm)), w / 2 + 90, 100);
  g.font = '16px Arial';
  g.fillStyle = '#9fb2c8';
  g.fillText('rpm', w / 2 + 90, 120);
  // 底部:水温、燃油条
  const bar = (x, label, v, color) => {
    g.fillStyle = '#223';
    g.fillRect(x, 160, 110, 14);
    g.fillStyle = color;
    g.fillRect(x + 2, 162, Math.max(0, Math.min(1, v)) * 106, 10);
    g.fillStyle = '#9fb2c8';
    g.font = '14px "Microsoft YaHei", sans-serif';
    g.textAlign = 'left';
    g.fillText(label, x, 192);
  };
  bar(30, '水温', s.coolant, '#4fb3ff');
  bar(w - 140, '燃油', s.fuel, '#6fe38a');
  if (s.warn) {
    g.fillStyle = '#ff4d3a';
    g.fillRect(60, 148, w - 120, 0);
  }
  mon.tex.needsUpdate = true;
}
