/**
 * 驾驶室:外壳(立柱、玻璃、门、雨刮、顶灯)+ 内饰(座椅、左右操纵台、先导手柄、安全锁杆、
 * 行走操纵杆和踏板、仪表、油门旋钮、钥匙、灭火器)+ 一个坐在里面的操作员。
 *
 * 驾驶室局部系:原点在地板中心,x 朝前,z 朝右(门在左侧 -Z)。
 * 内饰里会动的件(手柄、锁杆、行走杆、仪表屏)都暴露出来,每帧由输入驱动 ——
 * 驾驶室视角里能直接看到自己的手在推哪根杆。
 */
import * as THREE from 'three';
import { UPPER } from '../config.js';
import { add, bake, box, rbox, cylY, cylZ, shapeFrom, tube, rod } from './geo.js';

const L = UPPER.cab.length;
const W = UPPER.cab.width;
const H = UPPER.cab.height;
const X0 = -L / 2;
const X1 = L / 2;
const ZS = W / 2 - 0.02; // 侧面立柱的 z

/** XY 平面里两点之间放一根矩形截面的梁 */
function beam(g, mat, a, b, z, w = 0.06, d = 0.06) {
  const Lb = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const m = add(g, rbox(Lb + w * 0.6, w, d, 0.012), mat, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z);
  m.rotation.z = Math.atan2(b[1] - a[1], b[0] - a[0]);
  return m;
}

/** 一块玻璃:从 XY 平面轮廓做,放在给定 z */
function sideGlass(g, mat, pts, z) {
  const geo = new THREE.ShapeGeometry(shapeFrom(pts));
  const m = new THREE.Mesh(geo, mat);
  m.position.z = z;
  g.add(m);
  return m;
}

/** 两点之间一块矩形玻璃,宽度沿 z */
function slopedGlass(g, mat, a, b, width, zc = 0) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(len, width), mat);
  m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, zc);
  // 平面默认在 XY 里、法线 +Z;先转到 XZ 再绕 z 抬起
  m.rotation.order = 'ZXY';
  m.rotation.set(Math.PI / 2, 0, Math.atan2(b[1] - a[1], b[0] - a[0]));
  g.add(m);
  return m;
}

export function buildCab(M, swing) {
  const cab = new THREE.Group();
  cab.position.set(UPPER.cab.x, UPPER.deckY, UPPER.cab.z);
  swing.add(cab);
  const shell = new THREE.Group();
  const glassG = new THREE.Group();

  // 关键轮廓点(侧视)
  const FB = [X1, 0.04];
  const FS = [X1 - 0.02, 0.64]; // 下前窗顶 / 上前窗底
  const FT = [X1 - 0.2, H - 0.08]; // 上前窗顶
  const RF = [X1 - 0.32, H]; // 顶棚前缘
  const RT = [X0 + 0.02, H];
  const RB = [X0, 0.04];

  // ── 骨架 ──
  for (const z of [-ZS, ZS]) {
    beam(shell, M.black, FB, FS, z);
    beam(shell, M.black, FS, FT, z, 0.07, 0.07);
    beam(shell, M.black, FT, RF, z, 0.07, 0.07);
    beam(shell, M.black, RF, RT, z, 0.07, 0.07);
    beam(shell, M.black, [X0, H - 0.02], RB, z, 0.08, 0.08);
    beam(shell, M.body, RB, FB, z, 0.1, 0.07);
  }
  // 横梁
  for (const [x, y] of [FS, FT, RF, [X0 + 0.02, H - 0.02], [X0 + 0.02, 0.9], [X1 - 0.01, 0.06]]) {
    add(shell, rbox(0.06, 0.06, W - 0.02, 0.012), M.black, x, y, 0);
  }
  // 顶棚:外壳 + 前沿遮阳檐 + 雨水槽
  add(shell, rbox(L - 0.28, 0.07, W + 0.02, 0.03), M.body, -0.12, H + 0.02, 0);
  const brow = add(shell, rbox(0.3, 0.05, W + 0.02, 0.02), M.body, X1 - 0.3, H - 0.02, 0);
  brow.rotation.z = -0.35;
  add(shell, rbox(0.9, 0.05, W - 0.2, 0.02), M.bodyDark, -0.3, H + 0.07, 0);

  // 左侧门(-Z):门框 + 门把手 + 铰链
  const doorX0 = X0 + 0.3;
  const doorX1 = X1 - 0.52;
  beam(shell, M.black, [doorX0, 0.06], [doorX0, H - 0.05], -ZS - 0.005, 0.05, 0.05);
  beam(shell, M.black, [doorX1, 0.06], [doorX1, H - 0.05], -ZS - 0.005, 0.05, 0.05);
  beam(shell, M.black, [doorX0, 0.95], [doorX1, 0.95], -ZS - 0.005, 0.045, 0.045);
  add(shell, box(doorX1 - doorX0, 0.4, 0.03, (doorX0 + doorX1) / 2, 0.26, -ZS - 0.005), M.body);
  add(shell, rbox(0.12, 0.03, 0.04, 0.01, doorX1 - 0.12, 0.92, -ZS - 0.035), M.chrome);
  for (const y of [0.35, 1.4]) add(shell, cylY(0.018, 0.1, 8, doorX0 - 0.02, y, -ZS - 0.03), M.steelDark);
  // 门前的竖扶手
  add(shell, tube([[X1 - 0.02, 0.35, -ZS - 0.09], [X1 - 0.03, 0.4, -ZS - 0.12], [X1 - 0.12, 1.45, -ZS - 0.12], [X1 - 0.13, 1.5, -ZS - 0.09]], 0.016, 20, 6), M.black);
  // 右侧下半截钢板
  add(shell, box(L - 0.12, 0.5, 0.025, 0, 0.3, ZS + 0.005), M.body);
  // 后侧下半截钢板
  add(shell, box(0.025, 0.86, W - 0.04, X0 + 0.012, 0.47, 0), M.body);

  // 顶灯 ×2(前)
  const roofLights = [];
  for (const z of [-0.3, 0.3]) {
    add(shell, rbox(0.12, 0.12, 0.16, 0.02), M.black, X1 - 0.34, H + 0.12, z);
    const lens = add(shell, cylZ(0.05, 0.02, 14), M.lightLens, X1 - 0.27, H + 0.12, z);
    lens.rotation.y = Math.PI / 2;
    roofLights.push(new THREE.Vector3(X1 - 0.25, H + 0.12, z));
  }
  // 雨刮(停在右立柱边)
  add(shell, rod([FS[0] - 0.03, FS[1] + 0.05, ZS - 0.06], [FT[0] + 0.02, FT[1] - 0.1, ZS - 0.1], 0.008), M.black);
  add(shell, cylZ(0.02, 0.04, 10, FS[0] - 0.02, FS[1] + 0.04, ZS - 0.06), M.black);

  // ── 玻璃 ──
  slopedGlass(glassG, M.glass, FS, FT, W - 0.06);
  slopedGlass(glassG, M.glass, [FB[0] - 0.01, 0.12], [FS[0] - 0.005, FS[1] - 0.04], W - 0.06);
  // 右侧大窗
  sideGlass(glassG, M.glass, [[X0 + 0.04, 0.56], [FS[0] - 0.04, 0.56], [FT[0] - 0.03, FT[1] - 0.03], [RF[0], H - 0.04], [X0 + 0.04, H - 0.04]], ZS);
  // 左侧:门上窗、门下窗、前小窗、后小窗
  sideGlass(glassG, M.glass, [[doorX0 + 0.03, 0.99], [doorX1 - 0.03, 0.99], [doorX1 - 0.03, H - 0.07], [doorX0 + 0.03, H - 0.07]], -ZS);
  sideGlass(glassG, M.glass, [[doorX0 + 0.03, 0.48], [doorX1 - 0.03, 0.48], [doorX1 - 0.03, 0.91], [doorX0 + 0.03, 0.91]], -ZS);
  sideGlass(glassG, M.glass, [[doorX1 + 0.03, 0.1], [FB[0] - 0.04, 0.1], [FS[0] - 0.04, FS[1]], [FT[0] - 0.03, FT[1] - 0.03], [RF[0], H - 0.04], [doorX1 + 0.03, H - 0.04]], -ZS);
  sideGlass(glassG, M.glass, [[X0 + 0.04, 0.5], [doorX0 - 0.03, 0.5], [doorX0 - 0.03, H - 0.05], [X0 + 0.04, H - 0.05]], -ZS);
  // 后窗
  const rg = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.08, H - 0.98), M.glassDark);
  rg.position.set(X0 + 0.01, 0.9 + (H - 0.98) / 2, 0);
  rg.rotation.y = Math.PI / 2;
  glassG.add(rg);
  // 天窗
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(0.5, W - 0.3), M.glassDark);
  sky.rotation.x = -Math.PI / 2;
  sky.position.set(0.1, H + 0.061, 0);
  glassG.add(sky);

  // ── 内饰 ──
  const it = new THREE.Group();
  add(it, box(L - 0.08, 0.04, W - 0.06, 0, 0.02, 0), M.floorMat);
  // 座椅:减震底座 + 坐垫 + 靠背 + 头枕
  const seatX = -0.32;
  add(it, rbox(0.42, 0.2, 0.44, 0.03), M.plastic, seatX, 0.14, 0);
  add(it, rbox(0.5, 0.13, 0.5, 0.05), M.seatFabric, seatX + 0.02, 0.4, 0);
  const back = add(it, rbox(0.13, 0.64, 0.48, 0.05), M.seatFabric, seatX - 0.24, 0.76, 0);
  back.rotation.z = 0.16;
  const head = add(it, rbox(0.1, 0.18, 0.3, 0.04), M.seatFabric, seatX - 0.32, 1.16, 0);
  head.rotation.z = 0.16;
  // 安全带
  add(it, rod([seatX - 0.2, 0.46, -0.24], [seatX + 0.05, 0.47, -0.26], 0.012), M.plasticRed);

  // 左右操纵台
  for (const s of [-1, 1]) {
    const z = s * 0.34;
    add(it, rbox(0.66, 0.4, 0.18, 0.03), M.plastic, -0.2, 0.46, z);
    add(it, rbox(0.3, 0.07, 0.12, 0.03), M.seatFabric, -0.32, 0.7, z); // 扶手
    add(it, rbox(0.18, 0.08, 0.17, 0.02), M.plastic, 0.07, 0.68, z); // 手柄座
  }
  // 右操纵台上的油门旋钮、钥匙、开关面板
  add(it, rbox(0.26, 0.02, 0.14, 0.01), M.blackGloss, -0.18, 0.665, 0.34);
  for (let i = 0; i < 4; i++) add(it, box(0.03, 0.015, 0.03), M.plasticLight, -0.26 + i * 0.05, 0.68, 0.38);

  // 前方仪表柱
  add(it, rbox(0.08, 0.7, 0.08, 0.02), M.plastic, X1 - 0.18, 0.55, 0.38);

  // 灭火器(座椅后)
  add(it, cylY(0.05, 0.34, 14, X0 + 0.14, 0.2, 0.3), M.plasticRed);
  add(it, cylY(0.015, 0.06, 8, X0 + 0.14, 0.54, 0.3), M.black);

  shell.add(it);
  const bakedShell = bake(shell);
  cab.add(bakedShell);
  cab.add(glassG); // 玻璃是透明的,单独留着,别和不透明件合并

  // ── 会动的内饰件 ──
  const parts = {};

  // 先导手柄(左右)
  parts.sticks = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0.07, 0.72, s * 0.34);
    const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.055, 0.06, 12), M.rubber);
    boot.position.y = 0.02;
    pivot.add(boot);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.12, 8), M.chrome);
    shaft.position.y = 0.08;
    pivot.add(shaft);
    const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.09, 6, 12), M.plastic);
    grip.position.set(0.008, 0.18, 0);
    grip.rotation.z = -0.12;
    pivot.add(grip);
    const btn = new THREE.Mesh(cylY(0.01, 0.012, 10), s > 0 ? M.plasticRed : M.plasticLight);
    btn.position.set(0.02, 0.23, 0);
    pivot.add(btn);
    cab.add(pivot);
    parts.sticks.push(pivot);
  }

  // 安全锁杆(左操纵台外侧):放下 = 解锁可操作;抬起 = 锁定(液压切断)
  {
    const pivot = new THREE.Group();
    pivot.position.set(0.12, 0.54, -0.46);
    const arm = new THREE.Mesh(rbox(0.26, 0.025, 0.025, 0.008), M.black);
    arm.position.x = 0.13;
    pivot.add(arm);
    const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.07, 4, 10), M.plasticRed);
    grip.rotation.z = Math.PI / 2;
    grip.position.x = 0.28;
    pivot.add(grip);
    cab.add(pivot);
    parts.lockLever = pivot;
  }

  // 行走操纵杆 + 踏板(左右各一)
  parts.travelLevers = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(X1 - 0.32, 0.3, s * 0.11);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.62, 8), M.steelDark);
    shaft.position.y = 0.31;
    pivot.add(shaft);
    const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.08, 4, 10), M.rubber);
    grip.position.set(-0.01, 0.63, 0);
    grip.rotation.x = Math.PI / 2;
    pivot.add(grip);
    const pedal = new THREE.Mesh(rbox(0.26, 0.025, 0.11, 0.008), M.tread);
    pedal.position.set(0.1, -0.22, 0);
    pedal.rotation.z = 0.35;
    pivot.add(pedal);
    // 踏板底座
    add(cab, rbox(0.1, 0.26, 0.12, 0.02), M.plastic, X1 - 0.3, 0.13, s * 0.11);
    cab.add(pivot);
    parts.travelLevers.push(pivot);
  }

  // 油门旋钮
  {
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.032, 0.03, 16), M.blackGloss);
    knob.position.set(-0.12, 0.69, 0.34);
    const mark = new THREE.Mesh(box(0.028, 0.006, 0.006), M.body);
    mark.position.set(0.012, 0.016, 0);
    knob.add(mark);
    cab.add(knob);
    parts.throttleKnob = knob;
  }
  // 钥匙
  {
    const key = new THREE.Group();
    key.position.set(-0.3, 0.69, 0.4);
    const barrel = new THREE.Mesh(cylY(0.018, 0.012, 12), M.chrome);
    key.add(barrel);
    const head = new THREE.Mesh(rbox(0.035, 0.012, 0.022, 0.004, 0, 0.03, 0), M.black);
    key.add(head);
    cab.add(key);
    parts.key = key;
  }

  // 仪表屏:canvas 贴图,每隔一会儿重画
  {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const housing = new THREE.Group();
    housing.position.set(X1 - 0.2, 0.98, 0.34);
    housing.add(new THREE.Mesh(rbox(0.05, 0.19, 0.24, 0.015), M.black));
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.21, 0.155),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
    );
    screen.position.x = -0.026;
    screen.rotation.y = -Math.PI / 2;
    housing.add(screen);
    // 朝向操作员的眼睛
    housing.lookAt(new THREE.Vector3(-0.24, 1.26, 0).applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, 0)));
    housing.rotateY(Math.PI / 2);
    cab.add(housing);
    parts.monitor = { canvas, ctx: canvas.getContext('2d'), tex, t: 0 };
  }

  // 操作员视点:坐姿眼高约在坐垫上方 0.8 m
  parts.eye = new THREE.Object3D();
  parts.eye.position.set(-0.22, 1.26, 0);
  cab.add(parts.eye);

  parts.operator = buildOperator(M);
  parts.operator.position.set(seatX + 0.02, 0.46, 0);
  cab.add(parts.operator);

  parts.roofLights = roofLights;
  parts.group = cab;
  return parts;
}

/** 坐着的操作员:安全帽 + 反光背心。第三人称视角里有个人,尺度感立刻就对了。 */
function buildOperator(M) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xc89878, roughness: 0.8 });
  const vest = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.7 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0x2c3a52, roughness: 0.9 });
  const helmet = new THREE.MeshStandardMaterial({ color: 0xf3c318, roughness: 0.4 });
  const part = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => add(g, geo, mat, x, y, z, rx, ry, rz);
  // 大腿、小腿
  for (const s of [-1, 1]) {
    part(new THREE.CapsuleGeometry(0.07, 0.34, 4, 8), cloth, 0.2, 0.08, s * 0.11, 0, 0, Math.PI / 2);
    part(new THREE.CapsuleGeometry(0.06, 0.34, 4, 8), cloth, 0.42, -0.14, s * 0.12, 0, 0, 0.25);
    part(rbox(0.22, 0.08, 0.1, 0.03), M.black, 0.5, -0.36, s * 0.12);
  }
  // 躯干
  part(new THREE.CapsuleGeometry(0.16, 0.34, 4, 12), vest, -0.05, 0.36, 0, 0, 0, 0.12);
  // 手臂:搭在扶手上握着手柄
  for (const s of [-1, 1]) {
    part(new THREE.CapsuleGeometry(0.05, 0.24, 4, 8), cloth, -0.02, 0.36, s * 0.22, 0.2 * s, 0, 0.6);
    part(new THREE.CapsuleGeometry(0.045, 0.24, 4, 8), cloth, 0.2, 0.28, s * 0.3, 0, 0, Math.PI / 2 - 0.2);
    part(new THREE.SphereGeometry(0.045, 10, 8), skin, 0.36, 0.34, s * 0.34);
  }
  // 头 + 安全帽
  part(new THREE.SphereGeometry(0.1, 16, 12), skin, -0.02, 0.76, 0);
  part(new THREE.SphereGeometry(0.118, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), helmet, -0.02, 0.79, 0);
  part(new THREE.CylinderGeometry(0.13, 0.13, 0.012, 18), helmet, 0.0, 0.79, 0);
  const baked = bake(g);
  baked.traverse((o) => (o.castShadow = true));
  return baked;
}

/** 仪表屏内容(类似小松/卡特的彩色监视器) */
export function drawMonitor(mon, s) {
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
    g.fillText('锐工 RG215', w / 2, h / 2 - 12);
    g.font = '18px "Microsoft YaHei", sans-serif';
    g.fillText('系统自检中…', w / 2, h / 2 + 22);
    mon.tex.needsUpdate = true;
    return;
  }
  g.textAlign = 'left';
  // 顶栏:作业模式、行走档位、自动怠速
  g.fillStyle = '#16263a';
  g.fillRect(0, 0, w, 44);
  g.font = 'bold 26px Arial';
  g.fillStyle = '#ffd24a';
  g.fillText(s.mode, 10, 32);
  g.fillStyle = s.travelHi ? '#6fe38a' : '#9fb2c8';
  g.font = 'bold 22px "Microsoft YaHei", sans-serif';
  g.fillText(s.travelHi ? '兔' : '龟', 70, 31);
  g.fillStyle = s.autoIdle ? '#6fe38a' : '#556';
  g.fillText('AI', 108, 31);
  g.fillStyle = '#cfe0f2';
  g.font = '20px Arial';
  g.textAlign = 'right';
  g.fillText(`${s.hours.toFixed(1)} h`, w - 10, 30);
  g.textAlign = 'left';

  // 左:水温表;右:燃油表(竖条)
  const gauge = (x, label, v, color, warn) => {
    g.fillStyle = '#223';
    g.fillRect(x, 60, 26, 140);
    g.fillStyle = warn ? '#ff4d3a' : color;
    const hh = Math.max(0, Math.min(1, v)) * 136;
    g.fillRect(x + 2, 198 - hh, 22, hh);
    g.fillStyle = '#9fb2c8';
    g.font = '16px "Microsoft YaHei", sans-serif';
    g.fillText(label, x - 2, 222);
  };
  gauge(14, '水温', s.coolant, '#4fb3ff', s.coolant > 0.92);
  gauge(w - 42, '燃油', s.fuel, '#6fe38a', s.fuel < 0.12);

  // 中:转速
  g.fillStyle = '#e8f0f8';
  g.font = 'bold 54px Arial';
  g.textAlign = 'center';
  g.fillText(s.running ? String(Math.round(s.rpm)) : '0', w / 2, 118);
  g.font = '16px Arial';
  g.fillStyle = '#9fb2c8';
  g.fillText('rpm', w / 2, 140);
  // 油门档位
  g.fillStyle = '#9fb2c8';
  g.font = '18px "Microsoft YaHei", sans-serif';
  g.fillText(`油门 ${s.throttle} 档`, w / 2, 170);
  // 警示条
  if (s.warn) {
    g.fillStyle = '#ff4d3a';
    g.fillRect(56, 186, w - 112, 34);
    g.fillStyle = '#fff';
    g.font = 'bold 18px "Microsoft YaHei", sans-serif';
    g.fillText(s.warn, w / 2, 210);
  } else if (s.locked) {
    g.fillStyle = '#2f4d2f';
    g.fillRect(56, 186, w - 112, 34);
    g.fillStyle = '#b8f5b8';
    g.font = 'bold 18px "Microsoft YaHei", sans-serif';
    g.fillText('先导锁定', w / 2, 210);
  }
  mon.tex.needsUpdate = true;
}
