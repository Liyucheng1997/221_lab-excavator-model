/**
 * 单钢轮振动压路机(20 吨级,徐工 XS203 / 柳工 6620 / 卡特 CS56 量级)。品牌"锐工 RG620"是虚构的。
 *
 * 层级:
 *   root ── 铰接中心正下方的地面,朝向 = 后车架朝向
 *    ├─ 后车架:驾驶室(ROPS + 内饰)、发动机罩、后桥 + 两只驱动轮胎、挡泥板、平台、梯子、配重保险杠
 *    ├─ 转向油缸 ×2
 *    └─ front(绕铰接销转 γ)
 *         ├─ 前车架(钢轮框架):两侧板、前后横梁、摆动铰接座、刮泥板、前灯
 *         ├─ 两侧的减振器圈(8 个橡胶减振块)+ 振动马达 / 钢轮驱动马达
 *         └─ drum ── 钢轮(滚动 + 振动时跟着抖)
 *
 * 钢轮:直径 1.6 m、宽 2.13 m;轮胎 23.1-26;轴距 3.1 m。
 */
import * as THREE from 'three';
import { add, bake, box, rbox, cylY, cylZ, extrude, extrudePlan, shapeFrom, linkShape, tube, rod, bolts, pipe, latheZ } from '../model/geo.js';
import { buildOperator } from '../model/cab.js';
import { decalTexture } from '../model/materials.js';
import { wheelSet, Cylinder3D, steeringWheel, workLight, headLamp, handrail, beacon, step, pinZ, decal, cabShell } from './parts.js';

export const ROLLER = {
  lf: 1.75, // 钢轮中心到铰接销
  lr: 1.35, // 后桥到铰接销
  drumR: 0.8,
  drumW: 2.13,
  track: 1.8,
  tireR: 0.79,
  tireW: 0.59,
  rimR: 0.33,
  gammaMax: 35 * (Math.PI / 180),
  cab: { x0: -2.0, x1: -0.55, hw: 0.72, y0: 1.72, y1: 3.34 },
};
const R = ROLLER;
const FZ = R.drumW / 2 + 0.17; // 钢轮框架侧板的 z

function rollerMaterials(M) {
  const decalMat = (tex) => new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  return {
    model: decalMat(decalTexture('RG620', { color: '#151515' })),
    brand: decalMat(decalTexture([{ text: 'RUIGONG', font: 'bold 92px "Arial Black", sans-serif' }], { color: '#161616' })),
    vib: decalMat(decalTexture([{ text: '振动轮 · 严禁站人', font: 'bold 60px "Microsoft YaHei", sans-serif' }], { color: '#151515', bg: '#f2c200' })),
    grille: new THREE.MeshStandardMaterial({ map: M.louver.map, color: 0x9a9a9a, roughness: 0.6, metalness: 0.3 }),
    // 钢轮:磨得发亮的钢,边上一圈没磨到的油漆
    drum: new THREE.MeshStandardMaterial({ color: 0xc4c6c8, map: M.cast.map, roughness: 0.42, metalness: 0.55 }),
    drumEnd: M.body,
    rubberMount: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 }),
  };
}

export class RollerModel {
  constructor(M) {
    this.M = M;
    this.D = rollerMaterials(M);
    this.root = new THREE.Group();
    this.rear = new THREE.Group();
    this.front = new THREE.Group();
    this.root.add(this.rear, this.front);
    // 前车架先绕铰接销转(y),再绕自身纵轴摆(x,摆动铰)
    this.front.rotation.order = 'YXZ';
    this._buildRear();
    this._buildFront();
    this._buildSteering();
    this._buildCab();
    this._beaconT = 0;
    this._monT = 0;
    this._vibT = 0;
  }

  // ── 前车架 + 钢轮 ─────────────────────────────────────────────────────
  _buildFront() {
    const M = this.M;
    const D = this.D;
    const g = new THREE.Group();
    const X = R.lf;
    // 侧板:上面一条宽带连前后横梁,下面一个圆盘托住减振器座 —— 前后露出钢轮的圆弧
    const sp = [
      [X - 1.06, 1.55],
      [X + 1.06, 1.55],
      [X + 1.1, 1.22],
      [X + 0.98, 1.06],
      [X + 0.52, 1.02],
    ];
    for (let i = 0; i <= 16; i++) {
      const a = 0.42 - (i / 16) * (Math.PI + 0.84);
      sp.push([X + Math.cos(a) * 0.62, R.drumR + Math.sin(a) * 0.62]);
    }
    sp.push([X - 0.52, 1.02], [X - 0.98, 1.06], [X - 1.1, 1.22]);
    const side = shapeFrom(sp);
    const hole = new THREE.Path();
    hole.absarc(X, R.drumR, 0.43, 0, Math.PI * 2, true);
    side.holes.push(hole);
    for (const s of [-1, 1]) {
      add(g, extrude(side, 0.05, 0.012, 16), M.body, 0, 0, s * FZ);
      // 侧板外的加强翻边 + 警示贴
      add(g, box(2.1, 0.04, 0.08, X, 1.53, s * (FZ + 0.03)), M.bodyDark);
      decal(g, D.vib, 0.7, 0.13, X - 0.6, 1.3, s * (FZ + 0.028), s > 0 ? 0 : Math.PI);
      decal(g, M.decalHazard, 0.45, 0.08, X + 0.75, 1.3, s * (FZ + 0.028), s > 0 ? 0 : Math.PI);
      // 减振器座圈 + 8 个橡胶减振块
      add(g, cylZ(0.46, 0.04, 36, X, R.drumR, s * (FZ - 0.07)), M.body);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        add(g, cylZ(0.065, 0.11, 14, X + Math.cos(a) * 0.33, R.drumR + Math.sin(a) * 0.33, s * (FZ - 0.14)), D.rubberMount);
        add(g, cylZ(0.04, 0.02, 6, X + Math.cos(a) * 0.33, R.drumR + Math.sin(a) * 0.33, s * (FZ + 0.03)), M.pin);
      }
      // 马达:一侧是钢轮驱动马达(带减速机),另一侧是振动马达
      const motorZ = s * (FZ + 0.12);
      add(g, cylZ(0.17, 0.18, 24, X, R.drumR, motorZ), M.steelDark);
      add(g, cylZ(0.13, 0.08, 20, X, R.drumR, s * (FZ + 0.24)), M.cast);
      add(g, bolts(Array.from({ length: 8 }, (_, i) => [X + Math.cos((i / 8) * 6.28) * 0.15, R.drumR + Math.sin((i / 8) * 6.28) * 0.15, s * (FZ + 0.215)]), 0.012, 0.02, 'z'), M.pin);
      add(g, box(0.12, 0.12, 0.1, X + 0.1, R.drumR + 0.12, s * (FZ + 0.25)), M.steel);
      // 马达油管:往上走到车架顶部
      add(g, pipe([[X + 0.12, R.drumR + 0.18, s * (FZ + 0.25)], [X + 0.3, 1.2, s * (FZ + 0.22)], [X - 0.3, 1.45, s * (FZ + 0.08)], [X - 1.0, 1.42, s * 0.9]], 0.018), M.hose);
      add(g, pipe([[X + 0.05, R.drumR + 0.18, s * (FZ + 0.28)], [X + 0.18, 1.18, s * (FZ + 0.26)], [X - 0.4, 1.4, s * (FZ + 0.1)], [X - 1.0, 1.36, s * 0.86]], 0.018), M.hose);
    }
    // 前横梁(带灯)+ 后横梁(接铰接座)
    add(g, rbox(0.32, 0.36, FZ * 2 + 0.05, 0.04), M.body, X + 0.98, 1.36, 0);
    add(g, rbox(0.36, 0.4, FZ * 2 + 0.05, 0.04), M.body, X - 0.98, 1.34, 0);
    add(g, box(0.34, 0.03, FZ * 2 - 0.1, X + 0.98, 1.555, 0), M.tread);
    // 前横梁上的灯 + 示廓灯
    for (const s of [-1, 1]) {
      workLight(g, M, X + 1.12, 1.66, s * 0.85, 0, 1.1);
      add(g, rbox(0.04, 0.08, 0.14, 0.015), M.reflector, X + 1.15, 1.3, s * 0.95);
      add(g, rbox(0.05, 0.08, 0.1, 0.015), M.plasticRed, X + 1.15, 1.42, s * 1.05);
    }
    decal(g, D.brand, 0.9, 0.18, X + 1.142, 1.36, 0, Math.PI / 2);
    // 刮泥板:前后各一,贴着钢轮表面,用两根支臂吊在侧板上
    for (const sx of [-1, 1]) {
      const a = sx > 0 ? 0.28 : Math.PI - 0.28;
      const px = X + Math.cos(a) * (R.drumR + 0.04);
      const py = R.drumR + Math.sin(a) * (R.drumR + 0.04) - 0.36;
      const bar = add(g, box(0.05, 0.16, R.drumW - 0.04, px, py + 0.04, 0), M.steelDark);
      bar.rotation.z = sx * 0.4;
      add(g, box(0.02, 0.06, R.drumW - 0.06, px - sx * 0.02, py - 0.04, 0), M.rubber);
      for (const s of [-1, 1]) add(g, rod([px + sx * 0.05, py + 0.1, s * (R.drumW / 2 - 0.1)], [X + sx * 0.95, 1.15, s * (FZ - 0.05)], 0.02), M.steelDark);
    }
    // 铰接座 + 摆动铰(轴线沿 x 的大圆筒)
    add(g, cylZ(0.24, 0.5, 24), M.cast, 0.38, 0.98, 0, 0, Math.PI / 2, 0);
    add(g, extrude(shapeFrom([[0.15, 0.62], [X - 1.1, 1.08], [X - 1.1, 1.6], [0.15, 1.3]]), 0.6, 0.02), M.body, 0, 0, 0);
    for (const s of [-1, 1]) add(g, rod([X - 1.1, 1.3, s * 0.95], [0.4, 1.0, s * 0.25], 0.06), M.body);
    add(g, cylZ(0.27, 0.06, 24), M.steelDark, 0.12, 0.98, 0, 0, Math.PI / 2, 0);
    add(g, bolts(Array.from({ length: 10 }, (_, i) => [0.1, 0.98 + Math.cos((i / 10) * 6.28) * 0.22, Math.sin((i / 10) * 6.28) * 0.22]), 0.014, 0.02, 'x'), M.pin);
    // 前铰接耳
    for (const y of [1.28, 0.68]) {
      const ear = linkShape([0.0, 0], [0.4, 0], 0.16, 0.18);
      const m = add(g, extrude(ear, 0.1, 0.01), M.body, 0, y, 0);
      m.rotation.x = Math.PI / 2;
    }
    this.front.add(bake(g));

    // ── 钢轮(会转)──
    const drum = new THREE.Group();
    drum.position.set(X, R.drumR, 0);
    const dg = new THREE.Group();
    const W = R.drumW;
    // 钢轮筒体:两端倒角,中间一道环焊缝
    const prof = [
      [R.drumR - 0.06, -W / 2],
      [R.drumR - 0.012, -W / 2],
      [R.drumR, -W / 2 + 0.03],
      [R.drumR, -0.006],
      [R.drumR + 0.002, 0],
      [R.drumR, 0.006],
      [R.drumR, W / 2 - 0.03],
      [R.drumR - 0.012, W / 2],
      [R.drumR - 0.06, W / 2],
    ];
    add(dg, latheZ(prof, 72), D.drum);
    // 端板(略凹进去)+ 加强辐条 + 轴承座
    for (const s of [-1, 1]) {
      add(dg, cylZ(R.drumR - 0.05, 0.03, 48, 0, 0, s * (W / 2 - 0.05)), M.bodyDark);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const sp = add(dg, box(R.drumR - 0.32, 0.06, 0.03), M.bodyDark, Math.cos(a) * (R.drumR * 0.55), Math.sin(a) * (R.drumR * 0.55), s * (W / 2 - 0.03));
        sp.rotation.z = a;
      }
      add(dg, cylZ(0.3, 0.06, 32, 0, 0, s * (W / 2 - 0.02)), M.steelDark);
      add(dg, bolts(Array.from({ length: 12 }, (_, i) => [Math.cos((i / 12) * 6.28) * 0.25, Math.sin((i / 12) * 6.28) * 0.25, s * (W / 2 + 0.015)]), 0.014, 0.02, 'z'), M.pin);
      // 一圈没磨到的油漆(钢轮边缘)
      add(dg, latheZ([[R.drumR + 0.002, s * (W / 2) - 0.026], [R.drumR + 0.002, s * (W / 2) + 0.0]].sort((a, b) => a[1] - b[1]), 72), M.body);
    }
    drum.add(bake(dg));
    this.front.add(drum);
    this.drum = drum;
    // 钢轮振动时整体抖,用一个外层壳子来做位移(滚动用 drum.rotation)
    this.drumShake = new THREE.Group();
    this.front.remove(drum);
    this.drumShake.add(drum);
    this.front.add(this.drumShake);
  }

  // ── 后车架 ────────────────────────────────────────────────────────────
  _buildRear() {
    const M = this.M;
    const D = this.D;
    const g = new THREE.Group();
    const C = R.cab;
    // 大梁
    const rail = shapeFrom([
      [-0.2, 0.6],
      [-0.2, 1.38],
      [-0.6, 1.5],
      [-3.0, 1.5],
      [-3.1, 1.3],
      [-3.1, 0.62],
      [-2.4, 0.55],
      [-0.9, 0.55],
    ]);
    for (const s of [-1, 1]) add(g, extrude(rail, 0.05, 0.01), M.black, 0, 0, s * 0.5);
    for (const x of [-0.5, -2.3, -2.95]) add(g, box(0.12, 0.5, 0.96, x, 1.05, 0), M.black);
    for (const y of [1.38, 1.18, 0.78, 0.58]) {
      const ear = linkShape([-0.4, 0], [0, 0], 0.2, 0.17);
      const m = add(g, extrude(ear, 0.05, 0.008), M.black, 0, y, 0);
      m.rotation.x = Math.PI / 2;
    }
    add(g, cylY(0.06, 1.0, 16, 0, 0.47, 0), M.pin);
    for (const y of [1.44, 0.5]) add(g, cylY(0.09, 0.025, 16, 0, y, 0), M.steelDark);

    // 后桥(驱动桥)+ 后轮
    const ag = new THREE.Group();
    add(ag, cylZ(0.12, R.track - 0.25, 20, 0, 0, 0), M.steelDark);
    const diff = new THREE.SphereGeometry(0.27, 24, 16);
    diff.scale(1, 1, 0.75);
    add(ag, diff, M.cast, 0.0, 0, 0);
    add(ag, cylY(0.07, 0.35, 14, -0.15, 0.1, 0), M.steelDark); // 行走马达
    for (const s of [-1, 1]) {
      add(ag, cylZ(0.16, 0.1, 20, 0, 0, s * 0.6), M.cast);
      add(ag, rbox(0.12, 0.2, 0.09, 0.02), M.plasticRed, 0.0, 0.2, s * 0.66);
    }
    ag.position.set(-R.lr, R.tireR, 0);
    g.add(ag);

    // 驾驶平台:比后轮宽,前面挂两级踏步(左右都能上)
    add(g, box(1.8, 0.07, 2.2, (C.x0 + C.x1) / 2 + 0.05, C.y0 - 0.06, 0), M.black);
    add(g, box(1.7, 0.012, 2.12, (C.x0 + C.x1) / 2 + 0.05, C.y0 - 0.02, 0), M.tread);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) step(g, M, -0.35, 0.55 + i * 0.36, s * 1.0, 0.34, 0.2);
      for (const x of [-0.17, -0.53]) add(g, box(0.03, 1.1, 0.06, x, 1.08, s * 1.0), M.black);
      handrail(g, M.body, [[-0.15, C.y0, s * 1.06], [-0.15, C.y0 + 0.75, s * 1.06], [-0.6, C.y0 + 0.95, s * 1.06], [-1.95, C.y0 + 0.95, s * 1.06], [-2.05, C.y0, s * 1.06]], 0.02);
    }
    // 后挡泥板
    for (const s of [-1, 1]) {
      const z = s * (R.track / 2);
      const R0 = R.tireR + 0.09;
      const pts = [];
      for (let i = 0; i <= 12; i++) {
        const a = Math.PI * 0.42 + (Math.PI * 0.5 * i) / 12;
        pts.push([-R.lr + Math.cos(a) * R0, R.tireR + Math.sin(a) * R0]);
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[i + 1];
        const L = Math.hypot(x1 - x0, y1 - y0);
        const m = add(g, box(L + 0.01, 0.03, 0.7), M.body, (x0 + x1) / 2, (y0 + y1) / 2, z);
        m.rotation.z = Math.atan2(y1 - y0, x1 - x0);
      }
    }

    // ── 发动机罩:平顶、四周大圆角,两侧百叶 + 检修门,后面散热格栅 ──
    const hx0 = -2.0;
    const hx1 = -3.18;
    const hood = [];
    for (const [x, z] of [
      [hx0, -0.92],
      [hx0, 0.92],
    ])
      hood.push([x, z]);
    const cr = 0.22;
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * (Math.PI / 2);
      hood.push([hx1 + cr - Math.sin(a) * cr, 0.92 - cr + Math.cos(a) * cr]);
    }
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * (Math.PI / 2);
      hood.push([hx1 + cr - Math.cos(a) * cr, -0.92 + cr - Math.sin(a) * cr]);
    }
    add(g, extrudePlan(hood, 1.6, 0.62, 0.08), M.body);
    // 机罩顶:略窄、四周倒圆
    add(g, extrudePlan(hood.map(([x, z]) => [x - 0.02, z * 0.93]), 2.2, 0.08, 0.06), M.bodyDark);
    for (const s of [-1, 1]) {
      const pl = add(g, new THREE.PlaneGeometry(0.75, 0.42), D.grille, -2.6, 1.86, s * 1.003);
      pl.rotation.y = s > 0 ? 0 : Math.PI;
      add(g, box(0.012, 0.6, 0.008, -2.13, 1.86, s * 1.0), M.black);
      add(g, rbox(0.06, 0.05, 0.02, 0.008), M.black, -2.2, 2.08, s * 1.006);
      decal(g, D.model, 0.5, 0.13, -2.62, 2.14, s * 1.004, s > 0 ? 0 : Math.PI);
    }
    const rg = add(g, new THREE.PlaneGeometry(1.3, 0.48), D.grille, hx1 - 0.08, 1.86, 0);
    rg.rotation.y = -Math.PI / 2;
    // 排气管 + 空滤
    add(g, cylY(0.065, 0.55, 16, -2.3, 2.25, 0.55), M.pipe);
    const cap = add(g, cylZ(0.075, 0.015, 16), M.steelDark, -2.27, 2.82, 0.55);
    cap.rotation.set(Math.PI / 2, 0, 0.4);
    this.exhaustTip = new THREE.Vector3(-2.3, 2.82, 0.55);
    add(g, cylY(0.11, 0.25, 16, -2.25, 2.25, -0.55, 0.09), M.plastic);
    add(g, cylY(0.12, 0.02, 16, -2.25, 2.5, -0.55), M.black);

    // 发动机舱下半截的侧裙板(后轮后面一直包到保险杠)
    for (const s of [-1, 1]) {
      add(g, box(1.0, 0.85, 0.04, -2.68, 1.18, s * 0.94), M.body);
      const pl = add(g, new THREE.PlaneGeometry(0.5, 0.3), D.grille, -2.75, 1.2, s * 0.962);
      pl.rotation.y = s > 0 ? 0 : Math.PI;
      decal(g, M.decalHazard, 0.36, 0.06, -2.4, 0.86, s * 0.961, s > 0 ? 0 : Math.PI);
    }
    add(g, box(0.04, 0.85, 1.9, -3.15, 1.18, 0), M.body);
    // ── 后保险杠 / 配重:灯、反光片、拖车钩 ──
    add(g, rbox(0.35, 0.6, 2.05, 0.07), M.body, -3.2, 1.0, 0);
    add(g, box(0.36, 0.05, 2.0, -3.2, 0.68, 0), M.black);
    for (const s of [-1, 1]) {
      add(g, rbox(0.05, 0.14, 0.3, 0.02), M.black, -3.385, 1.12, s * 0.75);
      add(g, box(0.02, 0.1, 0.1), M.tailLight, -3.41, 1.12, s * 0.82);
      add(g, box(0.02, 0.1, 0.08), M.reflector, -3.41, 1.12, s * 0.71);
      add(g, box(0.02, 0.1, 0.07), M.lightLens, -3.41, 1.12, s * 0.62);
    }
    add(g, box(0.2, 0.15, 0.3, -3.45, 0.85, 0), M.steelDark);
    add(g, cylY(0.04, 0.3, 12, -3.5, 0.72, 0), M.pin);
    decal(g, D.brand, 0.8, 0.16, -3.378, 0.93, 0, -Math.PI / 2);

    // 平台下:液压油箱(右)、燃油箱(左)
    add(g, rbox(0.55, 0.42, 0.3, 0.04), M.body, -1.25, 1.35, 0.75);
    add(g, box(0.02, 0.2, 0.05, -0.97, 1.35, 0.75), M.glassDark);
    add(g, rbox(0.55, 0.42, 0.3, 0.04), M.body, -1.25, 1.35, -0.75);
    add(g, cylY(0.06, 0.06, 14, -1.15, 1.56, -0.75), M.black);
    this.rear.add(bake(g));

    // 后轮
    const mk = wheelSet(M, { R: R.tireR, W: R.tireW, rimR: R.rimR, pattern: 'R1', depth: 0.07, pitch: 18, hubR: 0.18, hubOut: 0.1, nuts: 12, style: 'roller' });
    this.wheels = [];
    for (const s of [-1, 1]) {
      const w = mk(s);
      w.position.set(-R.lr, R.tireR, s * (R.track / 2 + 0.06));
      this.rear.add(w);
      this.wheels.push(w);
    }
  }

  _buildSteering() {
    this.steerCyls = [-1, 1].map((s) => {
      const c = new Cylinder3D(this.M, { barrelR: 0.055, rodR: 0.032 }, 0.55);
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
    const C = R.cab;
    const { cab, shell, glass, hw, y0, L, seatX, dashX } = cabShell(M, C, { grille: this.D.grille });
    this.rear.add(cab);
    const it = shell;
    add(it, box(L - 0.08, 0.04, hw * 2 - 0.06, (C.x0 + C.x1) / 2, y0 + 0.02, 0), M.floorMat);
    // 座椅(可旋转底座)
    add(it, cylY(0.16, 0.12, 20, seatX, y0 + 0.04, 0), M.steelDark);
    add(it, rbox(0.42, 0.18, 0.44, 0.03), M.plastic, seatX, y0 + 0.24, 0);
    add(it, rbox(0.5, 0.13, 0.5, 0.05), M.seatFabric, seatX + 0.02, y0 + 0.42, 0);
    const back = add(it, rbox(0.13, 0.66, 0.5, 0.05), M.seatFabric, seatX - 0.25, y0 + 0.78, 0);
    back.rotation.z = 0.14;
    add(it, rbox(0.1, 0.18, 0.3, 0.04), M.seatFabric, seatX - 0.32, y0 + 1.2, 0).rotation.z = 0.14;
    add(it, rod([seatX - 0.2, y0 + 0.48, -0.25], [seatX + 0.05, y0 + 0.49, -0.27], 0.012), M.plasticRed);
    // 右侧操纵台:行走手柄座、振幅开关、油门开关、急停
    add(it, rbox(0.62, 0.44, 0.22, 0.03), M.plastic, seatX + 0.04, y0 + 0.5, 0.38);
    add(it, rbox(0.3, 0.07, 0.14, 0.03), M.seatFabric, seatX - 0.1, y0 + 0.75, 0.38);
    add(it, box(0.2, 0.01, 0.04, seatX + 0.22, y0 + 0.725, 0.38), M.black); // 手柄导槽
    add(it, cylY(0.03, 0.03, 16, seatX + 0.3, y0 + 0.72, 0.46), M.plasticRed); // 急停
    add(it, cylY(0.022, 0.02, 12, seatX + 0.08, y0 + 0.72, 0.45), M.blackGloss); // 油门开关
    add(it, box(0.03, 0.02, 0.04, seatX + 0.02, y0 + 0.73, 0.45), M.plasticLight); // 振幅开关
    // 仪表台 + 转向柱
    add(it, rbox(0.3, 0.55, hw * 2 - 0.1, 0.04), M.plastic, dashX + 0.05, y0 + 0.3, 0);
    add(it, rbox(0.22, 0.12, 0.7, 0.04), M.plastic, dashX, y0 + 0.62, 0).rotation.z = 0.5;
    add(it, cylY(0.05, 0.34, 14, C.x0 + 0.15, y0 + 0.2, 0.42), M.plasticRed); // 灭火器
    cab.add(bake(shell));
    cab.add(glass);

    const sw = steeringWheel(M, 0.19);
    sw.group.position.set(dashX - 0.06, y0 + 0.84, 0);
    sw.group.rotation.set(0, -Math.PI / 2, 0, 'YXZ');
    sw.group.rotateX(-0.75);
    cab.add(sw.group);
    this.steer = sw.wheel;
    // 行走手柄(静液压:推多少走多快,松手留在原位)
    const lv = new THREE.Group();
    lv.position.set(seatX + 0.22, y0 + 0.72, 0.38);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.2, 8), M.chrome);
    shaft.position.y = 0.1;
    lv.add(shaft);
    const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.07, 6, 12), M.plastic);
    grip.position.y = 0.23;
    lv.add(grip);
    const vb = new THREE.Mesh(cylY(0.013, 0.015, 10), M.plasticRed); // 振动按钮
    vb.position.set(0.02, 0.28, 0);
    lv.add(vb);
    cab.add(lv);
    this.lever = lv;
    this.vibeButton = vb;
    // 仪表屏(显示压实遍数图)
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 220;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.165), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    scr.position.set(dashX - 0.02, y0 + 0.72, 0);
    scr.rotation.set(0, -Math.PI / 2, 0, 'YXZ');
    scr.rotateX(-0.6);
    cab.add(scr);
    this.monitor = { canvas, ctx: canvas.getContext('2d'), tex };

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
  /** p: { gamma 铰接角, shake 振动位移 } */
  setPose(p) {
    this.front.rotation.y = p.gamma;
    this.drumShake.position.y = p.shake || 0;
    const cg = Math.cos(p.gamma);
    const sg = Math.sin(p.gamma);
    for (const c of this.steerCyls) {
      const z = c.side * 0.42;
      this._sA.set(-0.72, 1.0, c.side * 0.4);
      const fx = 0.6;
      this._sB.set(fx * cg + z * sg, 1.0, -fx * sg + z * cg);
      c.update(this._sA, this._sB, this._up);
    }
  }

  /** 钢轮 / 后轮滚动(本帧走过的路程) */
  roll(front, rear) {
    this.drum.rotation.z -= front / R.drumR;
    for (const w of this.wheels) w.rotation.z -= rear / R.tireR;
  }

  setControls(c) {
    this.steer.rotation.z = -c.steer * 2.2;
    this.lever.rotation.z = -c.lever * 0.45;
    this.vibeButton.material = c.vibe ? this.M.lightLens : this.M.plasticRed;
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
    M.tailLight.emissive.setRGB(s.power ? 0.35 : 0.08, 0, 0);
    this._monT -= dt;
    if (this._monT <= 0) {
      this._monT = 0.25;
      if (s.drawMonitor) s.drawMonitor(this.monitor);
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
  /** 钢轮前沿底部(世界)—— 俯视相机看这里 */
  getTipWorld(t = new THREE.Vector3()) {
    t.set(R.lf, 0.05, 0);
    return this.front.localToWorld(t);
  }
}
