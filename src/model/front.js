/**
 * 工作装置:动臂、斗杆、铲斗、四组油缸、摇臂/连杆、液压管路。
 *
 * 所有几何都在各自的"局部二维系"里画(见 config.js),z 只用于左右布置。
 * 油缸、连杆、软管每帧由姿态推出来 —— 没有任何一处是"摆着好看"的独立动画。
 */
import * as THREE from 'three';
import { BOOM, ARM, BUCKET } from '../config.js';
import {
  add,
  bake,
  box,
  rbox,
  cylZ,
  extrude,
  shapeFrom,
  linkShape,
  unitCylX,
  bolts,
  pipe,
  DynamicHose,
} from './geo.js';
import { lerp, clamp, dir, dist, sub } from '../linkage.js';

// ── 形体工具 ───────────────────────────────────────────────────────────

/** 挤出后按 x 位置收窄 z 宽度(做锥形箱梁) */
function taperZ(geo, fn) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) * fn(p.getX(i)));
  geo.computeVertexNormals();
  return geo;
}

/** 沿一串点铺一条"翼缘板"(箱梁上下盖板) */
function flangeStrip(parent, pts, width, thick, mat, side = 1) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const L = Math.hypot(x1 - x0, y1 - y0);
    const a = Math.atan2(y1 - y0, x1 - x0);
    const w = typeof width === 'function' ? width((x0 + x1) / 2) : width;
    const m = add(parent, box(L + 0.012, thick, w), mat);
    m.position.set((x0 + x1) / 2 - (Math.sin(a) * thick * side) / 2, (y0 + y1) / 2 + (Math.cos(a) * thick * side) / 2, 0);
    m.rotation.z = a;
  }
}

/** 沿一串二维点、宽度沿 Z 的一条曲面(斗内衬板) */
function ribbon(pts, width) {
  const pos = [];
  const idx = [];
  pts.forEach(([x, y]) => pos.push(x, y, -width / 2, x, y, width / 2));
  for (let i = 0; i < pts.length - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0).map((_, i) => (i % 2 ? (i % 4 > 1 ? 1 : 0) : pts.length ? Math.floor(i / 4) / pts.length : 0)), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 销轴 + 两端挡板螺栓 */
function pinWithCaps(parent, M, x, y, r, len) {
  add(parent, cylZ(r, len, 18), M.pin, x, y, 0);
  for (const s of [-1, 1]) {
    add(parent, cylZ(r * 1.35, 0.02, 18), M.steelDark, x, y, (s * len) / 2);
    add(parent, bolts([[x + r * 0.6, y + r * 0.6, (s * (len + 0.03)) / 2]], 0.014, 0.02), M.pin);
  }
}

// ── 液压油缸 ───────────────────────────────────────────────────────────

/**
 * 一根油缸:缸筒长度固定,活塞杆随两端铰点距离伸缩。
 * 组件平放在父级的 XY 平面里(z 用来做成对布置的左右偏移)。
 * 暴露 basePort / headPort 两个油口(组件局部系),给软管接。
 */
export class HydraulicCylinder {
  constructor(M, { barrelR, rodR }, barrelLen, z = 0, portSide = 1) {
    this.z = z;
    this.barrelLen = barrelLen;
    this.group = new THREE.Group();
    const stat = new THREE.Group();

    // 缸底:圆头 + 耳环
    add(stat, unitCylX(barrelR, 20), M.barrel).scale.x = barrelLen;
    const cap = new THREE.SphereGeometry(barrelR, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    cap.rotateZ(Math.PI / 2);
    add(stat, cap, M.barrel);
    add(stat, cylZ(barrelR * 0.9, barrelR * 1.3, 16), M.steelDark, -barrelR * 0.55, 0, 0);
    add(stat, box(barrelR * 1.1, barrelR * 1.4, barrelR * 1.2), M.steelDark, -barrelR * 0.3, 0, 0);
    // 缸头压盖
    add(stat, unitCylX(barrelR * 1.16, 20), M.steelDark, barrelLen - 0.11, 0, 0).scale.x = 0.11;
    add(stat, unitCylX(barrelR * 0.92, 16), M.steel, barrelLen, 0, 0).scale.x = 0.03;
    add(
      stat,
      bolts(
        Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return [barrelLen - 0.005, Math.cos(a) * barrelR * 0.98, Math.sin(a) * barrelR * 0.98];
        }),
        0.012,
        0.018,
        'x'
      ),
      M.pin
    );
    // 两个油口块 + 缸底到缸头的钢管
    const py = portSide * (barrelR + 0.025);
    add(stat, box(0.09, 0.06, 0.07), M.steel, 0.14, portSide * (barrelR + 0.01), 0);
    add(stat, box(0.09, 0.06, 0.07), M.steel, barrelLen - 0.2, portSide * (barrelR + 0.01), 0);
    add(stat, pipe([[0.19, py, 0.03], [barrelLen - 0.26, py, 0.03]], 0.014), M.pipe);
    for (let i = 1; i < 3; i++) {
      add(stat, box(0.03, 0.04, 0.05), M.steelDark, (barrelLen * i) / 3, portSide * (barrelR + 0.012), 0.03);
    }
    this.basePort = new THREE.Vector3(0.14, portSide * (barrelR + 0.04), -0.02);
    this.headPort = new THREE.Vector3(barrelLen - 0.2, portSide * (barrelR + 0.04), -0.02);
    this.group.add(bake(stat));

    // 活塞杆:画满全长,被缸筒挡住的那段正好模拟"缩进去"
    this.rod = new THREE.Mesh(unitCylX(rodR, 16), M.rod);
    this.rod.castShadow = true;
    this.group.add(this.rod);
    // 杆端耳环
    this.rodEye = new THREE.Group();
    add(this.rodEye, cylZ(rodR * 1.9, rodR * 2.3, 18), M.steelDark);
    add(this.rodEye, unitCylX(rodR * 1.25, 12), M.steelDark, -0.16, 0, 0).scale.x = 0.14;
    this.group.add(this.rodEye);
  }

  /** base / rodPt 是父级 XY 平面里的二维点 */
  update(base, rodPt) {
    const L = dist(base, rodPt);
    this.group.position.set(base.x, base.y, this.z);
    this.group.rotation.z = dir(sub(rodPt, base));
    this.rod.scale.x = L;
    this.rodEye.position.x = L;
    this.length = L;
  }

  /** 油口在父系(group 的父级)里的位置 */
  portInParent(which, out = new THREE.Vector3()) {
    out.copy(which === 'base' ? this.basePort : this.headPort);
    this.group.updateMatrix();
    return out.applyMatrix4(this.group.matrix);
  }
}

// ── 动臂 ───────────────────────────────────────────────────────────────

function boomProfile() {
  const [kx, ky] = BOOM.knee;
  const [tx, ty] = BOOM.tip;
  const cx = 2 * kx - 0.5 * tx;
  const cy = 2 * ky - 0.5 * ty;
  const spine = (t) => {
    const u = 1 - t;
    return [2 * u * t * cx + t * t * tx, 2 * u * t * cy + t * t * ty];
  };
  const halfH = (t) =>
    t < 0.5
      ? lerp(BOOM.halfHeightRoot, BOOM.halfHeightKnee, Math.sin((t / 0.5) * (Math.PI / 2)))
      : lerp(BOOM.halfHeightKnee, BOOM.halfHeightTip, (t - 0.5) / 0.5);
  const N = 26;
  const upper = [];
  const lower = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const [x, y] = spine(t);
    // 法线方向偏移,弯折处才不会变薄
    const [x2, y2] = spine(Math.min(1, t + 1e-3));
    const [x1, y1] = spine(Math.max(0, t - 1e-3));
    const a = Math.atan2(y2 - y1, x2 - x1);
    const h = halfH(t);
    upper.push([x - Math.sin(a) * h, y + Math.cos(a) * h]);
    lower.push([x + Math.sin(a) * h, y - Math.cos(a) * h]);
  }
  return { upper, lower, spine };
}

export function boomTopAt(x) {
  // 动臂上缘在给定 x 处的高度(近似),给管路和支座定位用
  const { upper } = boomProfile();
  for (let i = 0; i < upper.length - 1; i++) {
    if (x >= upper[i][0] && x <= upper[i + 1][0]) {
      const t = (x - upper[i][0]) / (upper[i + 1][0] - upper[i][0]);
      return lerp(upper[i][1], upper[i + 1][1], t);
    }
  }
  return upper[upper.length - 1][1];
}

function boomWidth(x) {
  // 根部到弯折处等宽,之后收窄到臂头
  const t = clamp((x - 4.4) / (BOOM.tip[0] - 4.4), 0, 1);
  return lerp(BOOM.width, BOOM.noseWidth, t);
}

function buildBoom(M) {
  const g = new THREE.Group();
  const { upper, lower } = boomProfile();
  // 根部绕根铰包一圈圆头:从下缘起点顺时针绕到上缘起点
  const a0 = Math.atan2(lower[0][1], lower[0][0]);
  let a1 = Math.atan2(upper[0][1], upper[0][0]);
  while (a1 > a0) a1 -= Math.PI * 2;
  const root = [];
  for (let i = 1; i < 10; i++) {
    const a = lerp(a0, a1, i / 10);
    root.push([Math.cos(a) * 0.3, Math.sin(a) * 0.3]);
  }
  const outline = [...upper, ...lower.slice().reverse(), ...root];
  const body = extrude(shapeFrom(outline), 1, 0.025);
  taperZ(body, (x) => (boomWidth(x) - 0.03));
  add(g, body, M.boom);

  // 上下翼缘板(比腹板略宽,看得出是焊接箱梁)
  flangeStrip(g, upper.slice(1), (x) => boomWidth(x) + 0.02, 0.028, M.boom, 1);
  flangeStrip(g, lower.slice(1), (x) => boomWidth(x) + 0.02, 0.028, M.boom, -1);

  // 弯折处两侧的加强板
  const knee = shapeFrom([
    [2.1, 1.0],
    [2.95, 1.3],
    [3.8, 1.05],
    [3.8, 0.55],
    [2.95, 0.78],
    [2.1, 0.55],
  ]);
  for (const s of [-1, 1]) {
    add(g, extrude(knee, 0.02, 0.006), M.boom, 0, 0, s * (BOOM.width / 2 + 0.005));
  }

  // 根铰轴套
  add(g, cylZ(0.21, BOOM.width + 0.1, 24), M.boom);
  pinWithCaps(g, M, 0, 0, 0.1, BOOM.width + 0.5);

  // 动臂缸杆端支座(下缘两侧耳板 + 轴套)
  const [rx, ry] = BOOM.cyl.rod;
  for (const s of [-1, 1]) {
    const ear = linkShape([rx - 0.35, ry + 0.35], [rx, ry], 0.18, 0.13);
    add(g, extrude(ear, 0.04, 0.008), M.boom, 0, 0, s * (BOOM.width / 2 - 0.02));
  }
  add(g, cylZ(0.12, BOOM.width + 0.06, 18), M.boom, rx, ry, 0);
  pinWithCaps(g, M, rx, ry, 0.065, BOOM.cyl.pairZ * 2 + 0.28);

  // 斗杆缸缸底支座(上缘)
  const [ax, ay] = ARM.cyl.base;
  const topY = boomTopAt(ax);
  const brk = shapeFrom([
    [ax - 0.55, topY - 0.02],
    [ax - 0.15, ay + 0.04],
    [ax + 0.12, ay + 0.1],
    [ax + 0.22, ay - 0.05],
    [ax + 0.55, topY - 0.08],
  ]);
  for (const s of [-1, 1]) add(g, extrude(brk, 0.04, 0.008), M.boom, 0, 0, s * 0.16);
  add(g, cylZ(0.12, 0.36, 18), M.boom, ax, ay, 0);
  pinWithCaps(g, M, ax, ay, 0.07, 0.44);

  // 臂头轴套(斗杆的叉板夹着它)
  add(g, cylZ(0.2, BOOM.noseWidth, 24), M.boom, BOOM.tip[0], BOOM.tip[1], 0);
  pinWithCaps(g, M, BOOM.tip[0], BOOM.tip[1], 0.095, 0.66);

  // ── 管路:四根钢管沿动臂上缘走到臂头 ──
  const lines = [];
  const zs = [-0.19, -0.1, 0.1, 0.19];
  for (const z of zs) {
    const pts = [];
    for (const x of [0.25, 0.8, 1.6, 2.3, 2.95, 3.6, 4.4, 5.05]) pts.push([x, boomTopAt(x) + 0.06, z]);
    lines.push(pts);
    add(g, pipe(pts, 0.022), M.pipe);
  }
  // 管夹
  for (const x of [0.8, 1.9, 3.3, 4.4]) {
    add(g, rbox(0.07, 0.07, 0.5, 0.01, x, boomTopAt(x) + 0.06, 0), M.steelDark);
    add(g, bolts([[x, boomTopAt(x) + 0.1, -0.23], [x, boomTopAt(x) + 0.1, 0.23]], 0.012, 0.012, 'y'), M.pin);
  }
  // 斗杆缸的两根管子从中间两根分出去,在支座前接软管
  // 工作灯(动臂左侧)
  const lx = 1.35;
  const ly = boomTopAt(lx) - 0.18;
  add(g, rbox(0.16, 0.16, 0.12, 0.02), M.black, lx, ly, -(BOOM.width / 2 + 0.1));
  const lens = add(g, cylZ(0.055, 0.02, 16), M.lightLens, lx + 0.05, ly, -(BOOM.width / 2 + 0.1));
  lens.rotation.y = Math.PI / 2;
  add(g, box(0.05, 0.05, 0.08), M.black, lx, ly, -(BOOM.width / 2 + 0.03));

  // 贴花:两侧型号
  for (const s of [-1, 1]) {
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.35), M.decalModel);
    pl.position.set(1.55, 0.72, s * (BOOM.width / 2 + 0.004));
    const tilt = Math.atan2(1.15, 2.95) * 0.85;
    // 背面那张转 180° 之后倾角要取反,字才会顺着动臂往上走
    pl.rotation.set(0, s > 0 ? 0 : Math.PI, s > 0 ? tilt : -tilt);
    g.add(pl);
  }

  const baked = bake(g);
  // 贴花是透明材质,bake 后照样保留
  return { mesh: baked, pipeEnds: lines.map((l) => l[l.length - 1]), pipeStarts: lines.map((l) => l[0]) };
}

// ── 斗杆 ───────────────────────────────────────────────────────────────

function armWidth(x) {
  return lerp(ARM.width, 0.36, clamp((x - 0.4) / 2.4, 0, 1));
}

function buildArm(M) {
  const g = new THREE.Group();
  const [hx, hy] = ARM.cyl.rod; // 斗杆缸杆端(后上凸耳)
  const tip = ARM.tip[0];
  const top = [
    [tip + 0.05, 0.16],
    [2.3, 0.2],
    [1.4, 0.28],
    [0.6, 0.36],
    [0.1, 0.42],
    [-0.35, 0.5],
    [hx + 0.05, hy + 0.15],
    [hx - 0.12, hy + 0.08],
  ];
  const bottom = [
    [hx - 0.14, hy - 0.08],
    [hx - 0.02, hy - 0.16],
    [-0.45, 0.1],
    [-0.3, -0.22],
    [0.1, -0.32],
    [0.8, -0.33],
    [1.8, -0.26],
    [tip - 0.1, -0.18],
    [tip + 0.05, -0.15],
  ];
  const outline = [...top, ...bottom];
  const body = extrude(shapeFrom(outline), 1, 0.022);
  taperZ(body, (x) => armWidth(x) - 0.03);
  add(g, body, M.boom);
  flangeStrip(g, top.slice(0, 6).reverse(), (x) => armWidth(x) + 0.016, 0.024, M.boom, 1);
  flangeStrip(g, bottom.slice(3), (x) => armWidth(x) + 0.016, 0.024, M.boom, -1);

  // 根部叉板:夹住臂头
  const fork = linkShape([0, 0], [0.55, 0.05], 0.3, 0.26);
  for (const s of [-1, 1]) add(g, extrude(fork, 0.05, 0.01), M.boom, 0, 0, s * (BOOM.noseWidth / 2 + 0.035));
  for (const s of [-1, 1]) add(g, cylZ(0.2, 0.06, 24), M.boom, 0, 0, s * (BOOM.noseWidth / 2 + 0.04));

  // 杆端凸耳轴套
  add(g, cylZ(0.13, 0.4, 20), M.boom, hx, hy, 0);
  pinWithCaps(g, M, hx, hy, 0.075, 0.46);

  // 铲斗缸缸底支座
  const [bx, by] = BUCKET.linkage.cylBase;
  for (const s of [-1, 1]) {
    add(g, extrude(linkShape([bx - 0.3, 0.3], [bx, by], 0.14, 0.11), 0.035, 0.008), M.boom, 0, 0, s * 0.14);
  }
  pinWithCaps(g, M, bx, by, 0.065, 0.36);

  // 摇臂铰座(斗杆两侧的凸台)
  const [px, py] = BUCKET.linkage.Ph;
  for (const s of [-1, 1]) {
    add(g, cylZ(0.11, 0.05, 18), M.boom, px, py, s * (armWidth(px) / 2 + 0.01));
    add(g, extrude(linkShape([px - 0.25, py - 0.05], [px, py], 0.1, 0.11), 0.03, 0.006), M.boom, 0, 0, s * (armWidth(px) / 2 - 0.005));
  }
  pinWithCaps(g, M, px, py, 0.055, 0.56);

  // 斗杆头:铲斗铰点轴套
  add(g, cylZ(0.16, 0.36, 22), M.boom, tip, 0, 0);
  pinWithCaps(g, M, tip, 0, 0.08, 0.82);

  // 斗杆上缘的两根钢管(去铲斗缸)
  const lines = [];
  for (const z of [-0.07, 0.07]) {
    const pts = [
      [-0.2, 0.56, z],
      [0.05, 0.5, z],
      [0.18, 0.49, z],
    ];
    lines.push(pts);
    add(g, pipe(pts, 0.02), M.pipe);
  }
  // 护板(防落石砸管子)
  add(g, rbox(0.5, 0.03, 0.26, 0.01, 0.0, 0.62, 0), M.steelDark);

  // 贴花
  for (const s of [-1, 1]) {
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.15), M.decalHazard);
    pl.position.set(2.2, 0.0, s * (armWidth(2.2) / 2 + 0.012));
    if (s < 0) pl.rotation.y = Math.PI;
    g.add(pl);
  }

  return { mesh: bake(g), pipeEnds: lines.map((l) => l[l.length - 1]), pipeStarts: lines.map((l) => l[0]) };
}

// ── 铲斗 ───────────────────────────────────────────────────────────────

function buildBucket(M) {
  const D = BUCKET.design;
  const W = BUCKET.width;
  const g = new THREE.Group(); // 设计系

  // 斗壳:外轮廓 + 内轮廓回程 = C 形钢板,挤出后天然是空心的。外面刷漆,里面贴一层磨亮的衬板
  add(g, extrude(shapeFrom([...D.outer, ...D.inner]), W - 0.07, 0.01, 1), M.boom);
  add(g, ribbon(D.inner.map(([x, y]) => [x, y]), W - 0.08), M.bucketIn);

  // 两侧侧板:外轮廓 + 斗口直线闭合;前缘加厚做侧刃
  const side = shapeFrom([...D.outer, D.inner[0], D.inner[D.inner.length - 1]]);
  for (const s of [-1, 1]) {
    add(g, extrude(side, 0.035, 0.008), M.boom, 0, 0, s * (W / 2 - 0.018));
    // 侧刃:沿斗口前半段的厚条
    const a = D.inner[D.inner.length - 1];
    const b = D.edge;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const m = add(g, box(L, 0.06, 0.06), M.tooth, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.02, s * (W / 2 - 0.02));
    m.rotation.z = Math.atan2(b[1] - a[1], b[0] - a[0]);
  }

  // 刃口板
  const e0 = D.outer[D.outer.length - 2];
  const e1 = D.edge;
  const ea = Math.atan2(e1[1] - e0[1], e1[0] - e0[0]);
  const lip = add(g, box(0.3, 0.055, W - 0.02), M.tooth, e1[0] - Math.cos(ea) * 0.12, e1[1] - Math.sin(ea) * 0.12 + 0.012, 0);
  lip.rotation.z = ea;

  // 齿座 + 斗齿:齿座焊在刃口上,斗齿用销子卡在齿座上
  const adapter = extrude(
    shapeFrom([
      [-0.2, 0.05],
      [0.06, 0.035],
      [0.12, 0.012],
      [0.12, -0.028],
      [0.06, -0.04],
      [-0.2, -0.04],
    ]),
    0.1,
    0.012
  );
  const toothGeo = taperZ(
    extrude(
      shapeFrom([
        [0, 0.03],
        [0.17, 0.008],
        [0.2, -0.004],
        [0.19, -0.016],
        [0, -0.034],
      ]),
      0.1,
      0.01
    ),
    (x) => lerp(1, 0.55, clamp(x / 0.2, 0, 1))
  );
  for (let i = 0; i < BUCKET.teeth; i++) {
    const z = lerp(-W / 2 + 0.14, W / 2 - 0.14, i / (BUCKET.teeth - 1));
    const t = new THREE.Group();
    t.position.set(e1[0], e1[1] + 0.01, z);
    t.rotation.z = ea;
    add(t, adapter, M.steelDark);
    add(t, toothGeo, M.tooth, 0.1, -0.003, 0);
    add(t, cylZ(0.014, 0.11, 8), M.pin, 0.07, 0.0, 0);
    g.add(t);
  }

  // 斗底耐磨条
  for (const z of [-0.36, 0, 0.36]) {
    for (let i = 4; i < D.outer.length - 1; i++) {
      const [x0, y0] = D.outer[i];
      const [x1, y1] = D.outer[i + 1];
      const L = Math.hypot(x1 - x0, y1 - y0);
      const a = Math.atan2(y1 - y0, x1 - x0);
      const m = add(g, box(L, 0.025, 0.08), M.tooth, (x0 + x1) / 2 + Math.sin(a) * 0.012, (y0 + y1) / 2 - Math.cos(a) * 0.012, z);
      m.rotation.z = a;
    }
  }

  // 顶板上的耳板:两个销孔 —— 铰点(原点)和连杆耳(lug)
  const lug = [D.lugR * Math.cos(D.lugDir), D.lugR * Math.sin(D.lugDir)];
  const ear = shapeFrom([
    [-0.3, -0.1],
    [0.44, -0.1],
    [0.52, 0.0],
    [0.5, 0.13],
    [0.38, 0.2],
    [0.24, 0.15],
    [0.1, 0.16],
    [-0.05, 0.15],
    [-0.15, 0.08],
    [-0.26, -0.03],
  ]);
  for (const s of [-1, 1]) {
    add(g, extrude(ear, 0.04, 0.008), M.boom, 0, 0, s * 0.33);
    add(g, cylZ(0.14, 0.07, 20), M.boom, 0, 0, s * 0.36);
    add(g, cylZ(0.12, 0.07, 20), M.boom, lug[0], lug[1], s * 0.36);
  }
  pinWithCaps(g, M, lug[0], lug[1], 0.055, 0.84);
  // 耳板之间的加强筋
  add(g, box(0.6, 0.05, 0.62), M.boom, 0.08, -0.075, 0);

  // 背板上的吊耳
  add(g, cylZ(0.045, 0.1, 12), M.steelDark, 0.55, -0.6, 0);

  const baked = bake(g);
  const holder = new THREE.Group();
  holder.add(baked);
  holder.rotation.z = BUCKET.bodyRot; // 设计系 → 铲斗局部系
  return holder;
}

/** 斗里的土:把斗腔截面挤出来,再按装满程度从斗底往上"长";装满后在斗口上方鼓出一个包 */
function buildSoil(M) {
  const D = BUCKET.design;
  const holder = new THREE.Group();
  holder.rotation.z = BUCKET.bodyRot;
  const cavity = shapeFrom(D.inner.map(([x, y]) => [x, y + 0.004]));
  const fill = new THREE.Mesh(extrude(cavity, BUCKET.width - 0.1, 0.02, 4), M.soil);
  fill.castShadow = true;
  holder.add(fill);

  // 斗口上的土包:压扁的半球,加点噪声显得是一坨土
  const heapGeo = new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = heapGeo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const n = 1 + (Math.sin(p.getX(i) * 9.1) * Math.cos(p.getZ(i) * 7.3) + Math.sin(p.getX(i) * 17 + p.getZ(i) * 13)) * 0.06;
    p.setXYZ(i, p.getX(i) * n, p.getY(i) * n, p.getZ(i) * n);
  }
  heapGeo.computeVertexNormals();
  const heap = new THREE.Mesh(heapGeo, M.soil);
  heap.castShadow = true;
  const m0 = D.inner[D.inner.length - 1];
  const m1 = D.inner[0];
  const heapHolder = new THREE.Group();
  heapHolder.position.set((m0[0] + m1[0]) / 2, (m0[1] + m1[1]) / 2, 0);
  heapHolder.rotation.z = Math.atan2(m1[1] - m0[1], m1[0] - m0[0]);
  heap.rotation.x = Math.PI; // 半球朝斗口外侧(斗口法线在斗口线的顺时针侧)
  heapHolder.add(heap);
  holder.add(heapHolder);
  // 斗腔最深点:从这里往斗口方向缩放
  const deep = [0.3, -0.72];
  return {
    holder,
    set(f) {
      holder.visible = f > 0.01;
      if (!holder.visible) return;
      const inner = clamp(f / 0.75, 0, 1);
      const s = Math.pow(inner, 0.6);
      fill.scale.set(s, s, 1);
      fill.position.set(deep[0] * (1 - s), deep[1] * (1 - s), 0);
      const h = clamp((f - 0.6) / 0.6, 0, 1);
      heap.visible = h > 0.01;
      const mouthLen = Math.hypot(m1[0] - m0[0], m1[1] - m0[1]);
      heap.scale.set(mouthLen * 0.46, 0.05 + h * 0.34, (BUCKET.width - 0.12) / 2);
    },
  };
}

// ── 摇臂 / 连杆 ────────────────────────────────────────────────────────

function powerLinkGeometry() {
  // 两片狗骨头形,Ph 在原点,H 在 +X(长 L1)
  const L = BUCKET.linkage.L1;
  return extrude(linkShape([0, 0], [L, 0], 0.1, 0.09), 0.04, 0.01);
}

function idlerLinkGroup(M) {
  // H 形连杆:两片 + 中间横梁,H 在原点,Pb 在 +X(长 L2)
  const L = BUCKET.linkage.L2;
  const g = new THREE.Group();
  const plate = extrude(linkShape([0, 0], [L, 0], 0.095, 0.1), 0.04, 0.01);
  for (const s of [-1, 1]) add(g, plate, M.steel, 0, 0, s * 0.285);
  add(g, box(0.14, 0.09, 0.53), M.steel, L * 0.5, -0.02, 0);
  return bake(g);
}

// ── 装配 ───────────────────────────────────────────────────────────────

export function buildFront(M, swing) {
  const F = {};

  // 动臂
  F.boomPivot = new THREE.Group();
  F.boomPivot.position.set(BOOM.foot[0], BOOM.foot[1], 0);
  swing.add(F.boomPivot);
  const boom = buildBoom(M);
  F.boomPivot.add(boom.mesh);

  // 斗杆
  F.armPivot = new THREE.Group();
  F.armPivot.position.set(BOOM.tip[0], BOOM.tip[1], 0);
  F.boomPivot.add(F.armPivot);
  const arm = buildArm(M);
  F.armPivot.add(arm.mesh);

  // 铲斗
  F.bucketPivot = new THREE.Group();
  F.bucketPivot.position.set(ARM.tip[0], ARM.tip[1], 0);
  F.armPivot.add(F.bucketPivot);
  F.bucketPivot.add(buildBucket(M));
  F.soil = buildSoil(M);
  F.bucketPivot.add(F.soil.holder);

  // ── 油缸 ──
  F.boomCyls = [];
  for (const s of [-1, 1]) {
    const c = new HydraulicCylinder(M, BOOM.cyl, 2.14, s * BOOM.cyl.pairZ, 1);
    swing.add(c.group);
    F.boomCyls.push(c);
  }
  F.armCyl = new HydraulicCylinder(M, ARM.cyl, 2.2, 0, 1);
  F.boomPivot.add(F.armCyl.group);
  F.bucketCyl = new HydraulicCylinder(M, BUCKET.linkage, 1.6, 0, 1);
  F.armPivot.add(F.bucketCyl.group);

  // 摇臂两片 + H 连杆
  F.powerLinks = [];
  const plg = powerLinkGeometry();
  for (const s of [-1, 1]) {
    const m = add(F.armPivot, plg, M.steel);
    m.position.z = s * 0.235;
    F.powerLinks.push(m);
  }
  F.idlerLink = idlerLinkGroup(M);
  F.armPivot.add(F.idlerLink);
  F.hPin = new THREE.Mesh(cylZ(0.055, 0.66, 16), M.pin);
  F.armPivot.add(F.hPin);

  // ── 软管 ──
  // 1) 动臂缸:平台上的硬管口 → 缸底油口 / 缸头油口
  F.boomHoses = [];
  for (const c of F.boomCyls) {
    for (const which of ['base', 'head']) {
      const h = new DynamicHose(M.hose, 0.026, 16, 8, 0.4);
      swing.add(h.mesh);
      F.boomHoses.push({ hose: h, cyl: c, which });
    }
  }
  // 2) 斗杆缸:动臂中间两根钢管的末端 → 缸底 / 缸头油口
  F.armHoses = [
    { hose: new DynamicHose(M.hose, 0.026, 16, 8, 0.45), from: [2.3, boomTopAt(2.3) + 0.06, -0.1], which: 'base' },
    { hose: new DynamicHose(M.hose, 0.026, 16, 8, 0.45), from: [2.3, boomTopAt(2.3) + 0.06, 0.1], which: 'head' },
  ];
  for (const h of F.armHoses) F.boomPivot.add(h.hose.mesh);
  // 3) 铲斗缸:动臂末端的两根外侧钢管 → 斗杆上的钢管(跨过臂头,随斗杆转)
  F.bucketHoses = boom.pipeEnds
    .filter((_, i) => i === 0 || i === 3)
    .map((p, i) => ({ hose: new DynamicHose(M.hose, 0.028, 22, 8, 0.55), from: p, to: arm.pipeStarts[i] }));
  for (const h of F.bucketHoses) F.boomPivot.add(h.hose.mesh);
  // 4) 斗杆钢管末端 → 铲斗缸油口
  F.bucketCylHoses = arm.pipeEnds.map((p, i) => ({
    hose: new DynamicHose(M.hose, 0.024, 12, 8, 0.35),
    from: p,
    which: i === 0 ? 'base' : 'head',
  }));
  for (const h of F.bucketCylHoses) F.armPivot.add(h.hose.mesh);

  return F;
}
