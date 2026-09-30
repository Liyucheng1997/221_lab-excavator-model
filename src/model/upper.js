/**
 * 上部回转体:平台、动臂支座、配重、发动机舱、油箱/液压油箱/工具箱、扶手、后视镜、警示灯。
 * 回转平台局部系原点在回转中心正下方的地面,x 朝前,驾驶室在左(-Z)。
 */
import * as THREE from 'three';
import { UPPER, BOOM } from '../config.js';
import { add, bake, box, rbox, cylY, cylZ, extrude, extrudePlan, shapeFrom, tube, bolts, rod, linkShape } from './geo.js';

const HW = UPPER.width / 2;

/** 尾部按回转半径画圆弧的平面轮廓 */
function tailArc(r, z0, z1, xFront, step = 0.1) {
  const pts = [[xFront, z1]];
  for (let z = z1; z >= z0 - 1e-6; z -= step) {
    pts.push([-Math.sqrt(Math.max(0.01, r * r - z * z)), z]);
  }
  pts.push([-Math.sqrt(Math.max(0.01, r * r - z0 * z0)), z0]);
  pts.push([xFront, z0]);
  return pts;
}

export function buildUpper(M, swing) {
  const g = new THREE.Group();
  const out = {};

  // ── 回转平台 ──
  const deckPlan = [
    [UPPER.noseX - 0.2, -HW],
    [UPPER.noseX - 0.2, HW],
    ...tailArc(2.4, -HW, HW, -1.6).slice(1, -1),
  ];
  add(g, extrudePlan(deckPlan, UPPER.bottomY, UPPER.deckY - UPPER.bottomY, 0.025), M.black);
  // 平台底面到回转支承的过渡(黑色底座)
  add(g, cylY(1.0, UPPER.bottomY - 1.0, 36, 0, 1.0, 0), M.black);
  // 左右两侧的走台边(防滑板)
  add(g, box(1.9, 0.02, 0.34, 0.5, UPPER.deckY + 0.01, HW - 0.17), M.tread);

  // ── 动臂支座:两片立板,上有根铰、前伸出两个动臂缸缸底耳座 ──
  const [fx, fy] = BOOM.foot;
  const [cx, cy] = BOOM.cyl.base;
  const tower = shapeFrom([
    [-0.55, UPPER.deckY],
    [cx + 0.2, UPPER.deckY],
    [cx + 0.25, cy - 0.15],
    [cx + 0.05, UPPER.bottomY - 0.02],
    [fx + 0.3, UPPER.bottomY - 0.02],
    [fx + 0.35, UPPER.deckY + 0.1],
    [fx + 0.3, fy - 0.05],
    [fx + 0.1, fy + 0.26],
    [fx - 0.2, fy + 0.25],
    [fx - 0.42, fy - 0.1],
  ]);
  for (const s of [-1, 1]) {
    add(g, extrude(tower, 0.07, 0.012), M.bodyDark, 0, 0, s * (BOOM.width / 2 + 0.06));
    add(g, cylZ(0.26, 0.1, 24), M.bodyDark, fx, fy, s * (BOOM.width / 2 + 0.08));
  }
  // 动臂缸缸底耳座(每根缸两片)
  for (const s of [-1, 1]) {
    for (const d of [-0.1, 0.1]) {
      const ear = linkShape([cx - 0.25, UPPER.bottomY + 0.05], [cx, cy], 0.14, 0.13);
      add(g, extrude(ear, 0.04, 0.008), M.bodyDark, 0, 0, s * BOOM.cyl.pairZ + d);
    }
    add(g, cylZ(0.06, 0.3, 14, cx, cy, s * BOOM.cyl.pairZ), M.pin);
  }
  // 动臂根部与驾驶室之间的底板护罩
  add(g, box(1.1, 0.12, 0.36, 0.7, UPPER.deckY + 0.06, -0.5), M.black);

  // ── 配重:外缘贴着尾部回转半径,边角大圆角 ──
  // 挤出的倒角会把轮廓往外撑 bevel 那么多,所以先内缩
  const cwBevel = 0.06;
  const cwPlan = tailArc(UPPER.tailRadius - cwBevel, -HW + cwBevel, HW - cwBevel, -1.82, 0.08);
  const cwH = UPPER.hoodTopY - UPPER.cwBottomY;
  add(g, extrudePlan(cwPlan, UPPER.cwBottomY, cwH, cwBevel), M.body);
  // 配重下沿的黑色护边 + 尾灯 + 反光片
  add(g, extrudePlan(tailArc(UPPER.tailRadius + 0.012, -HW + 0.04, HW - 0.04, -2.1, 0.08), UPPER.cwBottomY, 0.12, 0.02), M.black);
  for (const s of [-1, 1]) {
    const a = s * 0.4;
    const x = -UPPER.tailRadius * Math.cos(a);
    const z = UPPER.tailRadius * Math.sin(a);
    const tl = add(g, rbox(0.04, 0.09, 0.22, 0.015), M.tailLight, x, UPPER.cwBottomY + 0.3, z);
    tl.rotation.y = a;
    const rf = add(g, box(0.02, 0.05, 0.14), M.reflector, x, UPPER.cwBottomY + 0.2, z);
    rf.rotation.y = a;
  }
  // 吊装孔
  for (const s of [-1, 1]) add(g, cylY(0.07, 0.03, 16, -2.35, UPPER.hoodTopY, s * 0.75), M.steelDark);
  // 配重背面的品牌贴花:贴在一段圆柱面上
  {
    const r = UPPER.tailRadius + 0.006;
    const geo = new THREE.CylinderGeometry(r, r, 0.4, 24, 1, true, Math.PI * 1.5 - 0.4, 0.8);
    const m = new THREE.Mesh(geo, M.decalBrandWhite);
    m.position.y = UPPER.cwBottomY + 0.8;
    g.add(m);
    const geo2 = new THREE.CylinderGeometry(r + 0.002, r + 0.002, 0.26, 20, 1, true, Math.PI * 1.5 + 0.1, 0.13);
    const m2 = new THREE.Mesh(geo2, M.decalWarn);
    m2.position.y = UPPER.cwBottomY + 0.35;
    g.add(m2);
  }

  // ── 发动机舱:机罩 + 两侧检修门(百叶) ──
  const hoodX0 = -1.9;
  const hoodX1 = -0.44;
  const hoodY0 = UPPER.deckY;
  const hoodH = UPPER.hoodTopY - hoodY0 - 0.04;
  add(g, rbox(hoodX1 - hoodX0, hoodH, UPPER.width - 0.04, 0.07, (hoodX0 + hoodX1) / 2, hoodY0 + hoodH / 2, 0), M.body);
  // 机罩顶盖(略鼓起) + 合页 + 拉手
  add(g, rbox(1.2, 0.07, 1.4, 0.03, -1.15, UPPER.hoodTopY - 0.01, 0.35), M.bodyDark);
  add(g, rbox(0.9, 0.06, 0.9, 0.03, -1.2, UPPER.hoodTopY - 0.02, -0.75), M.bodyDark);
  add(g, tube([[-0.62, UPPER.hoodTopY + 0.03, 0.2], [-0.58, UPPER.hoodTopY + 0.08, 0.3], [-0.58, UPPER.hoodTopY + 0.08, 0.45], [-0.62, UPPER.hoodTopY + 0.03, 0.55]], 0.015, 16, 6), M.black);
  // 侧门百叶
  for (const s of [-1, 1]) {
    const pl = add(g, new THREE.PlaneGeometry(0.95, 0.5), M.louver, -1.2, hoodY0 + 0.62, s * (HW - 0.015));
    pl.rotation.y = s > 0 ? 0 : Math.PI;
    // 门缝 + 门把手
    add(g, box(0.012, hoodH - 0.12, 0.01, -0.62, hoodY0 + hoodH / 2, s * (HW - 0.018)), M.black);
    add(g, box(0.12, 0.03, 0.03, -0.72, hoodY0 + 0.75, s * (HW - 0.005)), M.black);
    add(g, box(1.42, 0.012, 0.01, -1.17, hoodY0 + 0.12, s * (HW - 0.018)), M.black);
  }
  // 排气管 + 防雨帽
  const exX = -1.0;
  const exZ = 0.95;
  add(g, cylY(0.07, 0.62, 16, exX, UPPER.hoodTopY - 0.05, exZ), M.pipe);
  const capM = add(g, cylZ(0.085, 0.02, 16), M.steelDark, exX, UPPER.hoodTopY + 0.6, exZ);
  capM.rotation.set(Math.PI / 2 - 0.5, 0, 0);
  add(g, cylY(0.11, 0.18, 16, exX, UPPER.hoodTopY - 0.02, exZ), M.pipe);
  out.exhaustTip = new THREE.Vector3(exX, UPPER.hoodTopY + 0.62, exZ);
  // 空滤进气帽
  add(g, cylY(0.075, 0.28, 14, -1.6, UPPER.hoodTopY - 0.02, 0.2), M.black);
  add(g, cylY(0.12, 0.12, 16, -1.6, UPPER.hoodTopY + 0.24, 0.2, 0.09), M.black);

  // ── 右前:工具箱 / 燃油箱 / 液压油箱 ──
  const rz0 = 0.46;
  const rzC = (rz0 + HW) / 2;
  const rw = HW - rz0;
  // 工具箱(前端带斜面)
  const tb = shapeFrom([
    [0.9, UPPER.deckY],
    [UPPER.noseX - 0.22, UPPER.deckY],
    [UPPER.noseX - 0.22, UPPER.deckY + 0.55],
    [UPPER.noseX - 0.45, UPPER.deckY + 0.78],
    [0.9, UPPER.deckY + 0.78],
  ]);
  add(g, extrude(tb, rw, 0.03), M.body, 0, 0, rzC);
  add(g, box(0.5, 0.02, rw - 0.06, 1.18, UPPER.deckY + 0.79, rzC), M.tread);
  add(g, box(0.012, 0.5, 0.01, 1.1, UPPER.deckY + 0.35, HW - 0.005), M.black);
  add(g, box(0.1, 0.03, 0.02, 1.3, UPPER.deckY + 0.6, HW + 0.005), M.black);
  // 燃油箱
  add(g, rbox(0.95, 0.98, rw, 0.05, 0.42, UPPER.deckY + 0.49, rzC), M.body);
  add(g, box(0.9, 0.02, rw - 0.08, 0.42, UPPER.deckY + 0.99, rzC), M.tread);
  add(g, cylY(0.07, 0.07, 16, 0.25, UPPER.deckY + 0.98, rzC + 0.2), M.black); // 加油口
  // 油位计(侧面)
  add(g, box(0.05, 0.4, 0.02, 0.6, UPPER.deckY + 0.5, HW + 0.005), M.black);
  add(g, box(0.02, 0.3, 0.012, 0.6, UPPER.deckY + 0.5, HW + 0.014), M.glassDark);
  out.fuelGauge = new THREE.Vector3(0.6, UPPER.deckY + 0.5, HW + 0.02);
  // 液压油箱
  add(g, rbox(0.52, 1.18, rw, 0.05, -0.2, UPPER.deckY + 0.59, rzC), M.body);
  add(g, cylY(0.06, 0.1, 14, -0.25, UPPER.deckY + 1.17, rzC), M.black); // 呼吸器
  add(g, box(0.05, 0.22, 0.02, -0.02, UPPER.deckY + 0.55, HW + 0.005), M.black);
  add(g, box(0.025, 0.16, 0.012, -0.02, UPPER.deckY + 0.55, HW + 0.014), M.glassDark);
  out.hydGauge = new THREE.Vector3(-0.02, UPPER.deckY + 0.55, HW + 0.02);
  // 主控阀盖板(动臂右侧)
  add(g, rbox(1.1, 0.35, 0.18, 0.03, 0.3, UPPER.deckY + 0.18, rz0 - 0.1), M.bodyDark);

  // ── 扶手(右侧)+ 台阶 ──
  const hy = UPPER.hoodTopY + 0.42;
  const railPts = [
    [1.35, UPPER.deckY + 0.78, HW - 0.06],
    [1.35, hy - 0.2, HW - 0.06],
    [1.2, hy, HW - 0.06],
    [-0.6, hy, HW - 0.06],
    [-1.8, hy, HW - 0.06],
    [-1.95, hy - 0.1, HW - 0.06],
    [-1.95, UPPER.hoodTopY, HW - 0.06],
  ];
  add(g, tube(railPts, 0.022, 60, 8, false, 0.0), M.body);
  for (const x of [0.4, -0.6]) add(g, rod([x, UPPER.hoodTopY - 0.2, HW - 0.06], [x, hy, HW - 0.06], 0.02), M.body);
  // 右前台阶(挂在平台前缘下)
  add(g, box(0.34, 0.02, 0.3, 1.22, UPPER.deckY - 0.28, HW - 0.2), M.tread);
  add(g, box(0.02, 0.28, 0.3, 1.38, UPPER.deckY - 0.14, HW - 0.2), M.black);

  // ── 后视镜 ──
  const mirror = (x, y, z, ry, stay) => {
    add(g, rod(stay, [x, y, z], 0.012), M.black);
    const m = add(g, rbox(0.03, 0.26, 0.18, 0.012), M.black, x, y, z);
    m.rotation.y = ry;
    const gl = add(g, box(0.004, 0.22, 0.15), M.mirror, x - Math.cos(ry) * 0.018, y, z + Math.sin(ry) * 0.018);
    gl.rotation.y = ry;
  };
  mirror(1.38, hy + 0.3, HW + 0.08, 0.35, [1.35, hy - 0.2, HW - 0.06]);
  mirror(-1.9, hy + 0.1, HW + 0.02, -0.3, [-1.95, hy - 0.1, HW - 0.06]);

  // ── 后视摄像头 ──
  add(g, rbox(0.12, 0.1, 0.14, 0.02), M.black, -2.5, UPPER.hoodTopY + 0.05, 0);

  // ── 警示灯座(配重上) ──
  add(g, cylY(0.07, 0.05, 16, -1.95, UPPER.hoodTopY, -0.9), M.black);

  const baked = bake(g);
  swing.add(baked);

  // 警示灯罩单独做,要闪
  const beacon = new THREE.Group();
  beacon.position.set(-1.95, UPPER.hoodTopY + 0.05, -0.9);
  const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.14, 16), M.beacon);
  dome.position.y = 0.07;
  beacon.add(dome);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.beacon);
  cap.position.y = 0.14;
  beacon.add(cap);
  const refl = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.09, 0.08), M.chrome);
  refl.position.y = 0.07;
  beacon.add(refl);
  swing.add(beacon);
  out.beacon = { group: beacon, refl };

  return out;
}
