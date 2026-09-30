/**
 * 行走装置:X 形车架、回转支承、两条履带(驱动轮在后、引导轮在前)。
 *
 * 履带是真的一节一节绕着轮系走的:
 *   路径 = 支重轮底 → 引导轮 → 托链轮 → 驱动轮 的外公切线 + 圆弧(geo.beltPath)
 *   每一节 = 一对链节 + 销套 + 一块三筋履带板,沿"相邻两销的弦"摆放 —— 所以绕轮时能看到折线感。
 *   驱动轮、引导轮、支重轮、托链轮的转角都由履带走过的路程换算,没有打滑。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { UNDERCARRIAGE as UC } from '../config.js';
import { add, bake, beltPath, box, cylY, cylZ, extrude, latheZ, shapeFrom, bolts, rbox, rod } from './geo.js';
import { lerp } from '../linkage.js';

const LINK_HALF_H = 0.06; // 链节半高(链节中心线到链节外缘)
const LINK_Z = 0.1; // 两片链节的 z 位置
const SPROCKET_R = (UC.pitch * 12) / (2 * Math.PI); // 驱动轮节圆:12 个销套啮合位

/** 沿 X 挤出的截面(截面在 (z, y) 里画) */
function extrudeX(section, x0, x1, bevel = 0.015) {
  const g = extrude(shapeFrom(section.map(([z, y]) => [-z, y])), x1 - x0, bevel);
  g.rotateY(Math.PI / 2);
  g.translate((x0 + x1) / 2, 0, 0);
  return g;
}

/** 一块三筋履带板(局部系:x 沿链节方向,-y 朝外) */
function shoeGeometry() {
  const p = UC.pitch * 0.97;
  const y0 = -LINK_HALF_H;
  const t = 0.026;
  const h = 0.048; // 主筋高
  const pts = [
    [-p / 2, y0],
    [p / 2, y0],
    [p / 2, y0 - t],
    // 主筋(前缘)
    [p / 2 - 0.012, y0 - t - h],
    [p / 2 - 0.05, y0 - t - h],
    [p / 2 - 0.06, y0 - t],
    // 中筋
    [0.02, y0 - t],
    [0.012, y0 - t - h * 0.72],
    [-0.022, y0 - t - h * 0.72],
    [-0.03, y0 - t],
    // 后筋
    [-p / 2 + 0.05, y0 - t],
    [-p / 2 + 0.044, y0 - t - h * 0.5],
    [-p / 2 + 0.01, y0 - t - h * 0.5],
    [-p / 2, y0 - t],
  ];
  const plate = extrude(shapeFrom(pts), UC.shoeWidth, 0.006, 1);
  // 板上 4 颗螺栓(在链节那一面)
  const b = bolts(
    [
      [-0.045, y0 + 0.004, -0.14],
      [0.045, y0 + 0.004, -0.14],
      [-0.045, y0 + 0.004, 0.14],
      [0.045, y0 + 0.004, 0.14],
    ],
    0.014,
    0.012,
    'y'
  );
  const bb = b.index ? b.toNonIndexed() : b;
  const pp = plate.index ? plate.toNonIndexed() : plate;
  bb.deleteAttribute('uv');
  pp.deleteAttribute('uv');
  return mergeGeometries([pp, bb]);
}

/** 一节链节:两片链节板 + 销套 */
function linkGeometry() {
  const p = UC.pitch;
  const h = LINK_HALF_H;
  // 链节板侧面:两头圆、中间收腰
  const s = new THREE.Shape();
  s.moveTo(-p / 2, -h);
  s.lineTo(p / 2, -h);
  s.quadraticCurveTo(p / 2 + 0.035, 0, p / 2, h * 0.8);
  s.lineTo(0.02, h * 0.7);
  s.quadraticCurveTo(0, h * 0.55, -0.02, h * 0.7);
  s.lineTo(-p / 2, h * 0.8);
  s.quadraticCurveTo(-p / 2 - 0.035, 0, -p / 2, -h);
  const parts = [];
  for (const z of [-LINK_Z, LINK_Z]) {
    const g = extrude(s, 0.045, 0.006, 4);
    g.translate(0, 0, z);
    parts.push(g.toNonIndexed());
  }
  const bush = cylZ(0.032, LINK_Z * 2 + 0.07, 10, p / 2, 0, 0).toNonIndexed();
  const pinEnd = cylZ(0.022, LINK_Z * 2 + 0.1, 8, p / 2, 0, 0).toNonIndexed();
  for (const g of [...parts, bush, pinEnd]) g.deleteAttribute('uv');
  return mergeGeometries([...parts, bush, pinEnd]);
}

class TrackBelt {
  constructor(M, side) {
    const circles = [
      { x: -UC.lowerRollerSpan / 2, y: UC.rollerY, r: UC.rollerR },
      { x: UC.lowerRollerSpan / 2, y: UC.rollerY, r: UC.rollerR },
      { x: UC.idler.x, y: UC.idler.y, r: UC.idler.r },
      { x: UC.carrierRollers[0], y: UC.carrierY, r: 0.14 },
      { x: UC.carrierRollers[1], y: UC.carrierY, r: 0.14 },
      { x: UC.sprocket.x, y: UC.sprocket.y, r: SPROCKET_R },
    ];
    this.path = beltPath(circles);
    this.count = Math.round(this.path.length / UC.pitch);
    this.pitch = this.path.length / this.count;
    this.s = 0;

    this.shoes = new THREE.InstancedMesh(shoeGeometry(), M.shoe, this.count);
    this.links = new THREE.InstancedMesh(linkGeometry(), M.link, this.count);
    for (const m of [this.shoes, this.links]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
    }
    this.side = side;
    this._d = new THREE.Object3D();
    this._a = { x: 0, y: 0, a: 0 };
    this._b = { x: 0, y: 0, a: 0 };
    this.update(0);
  }

  /** s 增大 = 底面那段往 +X 走,即机器往后退。前进时传负值。 */
  update(ds) {
    this.s = (this.s + ds) % this.path.length;
    const d = this._d;
    for (let i = 0; i < this.count; i++) {
      const a = this.path.at(this.s + i * this.pitch, this._a);
      const b = this.path.at(this.s + (i + 1) * this.pitch, this._b);
      // 放在两销的弦中点,朝向沿弦 —— 绕轮时呈折线,和真的一样
      d.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, 0);
      d.rotation.set(0, 0, Math.atan2(b.y - a.y, b.x - a.x));
      d.updateMatrix();
      this.shoes.setMatrixAt(i, d.matrix);
      this.links.setMatrixAt(i, d.matrix);
    }
    this.shoes.instanceMatrix.needsUpdate = true;
    this.links.instanceMatrix.needsUpdate = true;
  }
}

// ── 轮子 ───────────────────────────────────────────────────────────────

function sprocketGeometry() {
  const n = 24; // 双节距齿形:每隔一个齿槽啮合一个销套
  const rRoot = SPROCKET_R - 0.03;
  const rTip = SPROCKET_R + 0.06;
  const s = new THREE.Shape();
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 0.3) / n) * Math.PI * 2;
    const a2 = ((i + 0.5) / n) * Math.PI * 2;
    const a3 = ((i + 0.7) / n) * Math.PI * 2;
    const p = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
    const [x0, y0] = p(rRoot, a0);
    if (i === 0) s.moveTo(x0, y0);
    else s.lineTo(x0, y0);
    s.lineTo(...p(rTip - 0.012, a1));
    s.lineTo(...p(rTip, a2));
    s.lineTo(...p(rTip - 0.012, a3));
  }
  s.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, 0.12, 0, Math.PI * 2, true);
  s.holes.push(hole);
  const plate = extrude(s, 0.07, 0.008, 2);
  return plate;
}

function idlerGeometry() {
  // 中间一圈凸缘卡在两排链节之间,两侧是踏面
  return latheZ(
    [
      [0.1, -0.15],
      [0.22, -0.15],
      [0.27, -0.14],
      [0.29, -0.13],
      [0.29, -0.06],
      [0.33, -0.05],
      [0.33, 0.05],
      [0.29, 0.06],
      [0.29, 0.13],
      [0.27, 0.14],
      [0.22, 0.15],
      [0.1, 0.15],
    ],
    32
  );
}

function rollerGeometry() {
  // 双边支重轮
  return latheZ(
    [
      [0.045, -0.2],
      [0.06, -0.19],
      [0.06, -0.16],
      [0.105, -0.155],
      [0.105, -0.13],
      [0.078, -0.12],
      [0.078, -0.07],
      [0.095, -0.06],
      [0.095, 0.06],
      [0.078, 0.07],
      [0.078, 0.12],
      [0.105, 0.13],
      [0.105, 0.155],
      [0.06, 0.16],
      [0.06, 0.19],
      [0.045, 0.2],
    ],
    20
  );
}

function carrierGeometry() {
  return latheZ(
    [
      [0.03, -0.15],
      [0.05, -0.14],
      [0.09, -0.13],
      [0.09, 0.13],
      [0.05, 0.14],
      [0.03, 0.15],
    ],
    16
  );
}

// ── 整个行走装置 ───────────────────────────────────────────────────────

export class Undercarriage {
  constructor(M) {
    this.group = new THREE.Group();
    const stat = new THREE.Group(); // 静态零件,最后合并

    this._buildCarbody(M, stat);

    this.belts = [];
    this.spinners = []; // { mesh, r, phase, side }
    for (const [side, sz] of [
      [0, -1], // 左
      [1, 1], // 右
    ]) {
      const zc = (sz * UC.gauge) / 2;
      this._buildSideFrame(M, stat, zc, sz);

      const belt = new TrackBelt(M, side);
      belt.shoes.position.z = zc;
      belt.links.position.z = zc;
      this.group.add(belt.shoes, belt.links);
      this.belts.push(belt);

      // 驱动轮(两片齿圈 + 轮毂)
      const spr = new THREE.Group();
      spr.position.set(UC.sprocket.x, UC.sprocket.y, zc);
      const sg = sprocketGeometry();
      add(spr, sg, M.cast, 0, 0, -0.06);
      add(spr, sg, M.cast, 0, 0, 0.06);
      add(spr, latheZ([[0.05, -0.2], [0.26, -0.2], [0.27, -0.12], [0.27, 0.12], [0.24, 0.13], [0.05, 0.13]], 28), M.steelDark);
      add(
        spr,
        bolts(
          Array.from({ length: 12 }, (_, i) => {
            const a = (i / 12) * Math.PI * 2;
            return [Math.cos(a) * 0.2, Math.sin(a) * 0.2, sz * 0.1];
          }),
          0.018,
          0.03
        ),
        M.pin
      );
      this.group.add(spr);
      this.spinners.push({ obj: spr, r: SPROCKET_R, side });

      // 引导轮
      const idl = new THREE.Group();
      idl.position.set(UC.idler.x, UC.idler.y, zc);
      add(idl, idlerGeometry(), M.cast);
      // 辐板上的减重孔(画成深色圆片)
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        for (const s of [-1, 1]) {
          add(idl, cylZ(0.045, 0.005, 12), M.steelDark, Math.cos(a) * 0.18, Math.sin(a) * 0.18, s * 0.152);
        }
      }
      add(idl, cylZ(0.07, 0.34, 14), M.pin);
      this.group.add(idl);
      this.spinners.push({ obj: idl, r: UC.idler.r - 0.06, side });

      // 支重轮
      const rg = rollerGeometry();
      for (let i = 0; i < UC.lowerRollers; i++) {
        const x = lerp(-UC.lowerRollerSpan / 2, UC.lowerRollerSpan / 2, i / (UC.lowerRollers - 1));
        const r = new THREE.Group();
        r.position.set(x, UC.rollerY, zc);
        add(r, rg, M.cast);
        add(r, cylZ(0.035, 0.44, 8), M.pin);
        this.group.add(r);
        this.spinners.push({ obj: r, r: UC.rollerR - LINK_HALF_H, side });
      }
      // 托链轮
      const cg = carrierGeometry();
      for (const x of UC.carrierRollers) {
        const r = new THREE.Group();
        r.position.set(x, UC.carrierY, zc);
        add(r, cg, M.cast);
        this.group.add(r);
        this.spinners.push({ obj: r, r: 0.14 - LINK_HALF_H, side });
        // 托链轮支架(静态)
        add(stat, box(0.14, 0.14, 0.12), M.steelDark, x, UC.carrierY - 0.08, zc - sz * 0.2);
      }
    }

    const baked = bake(stat);
    this.group.add(baked);
    this.dist = [0, 0];
  }

  _buildCarbody(M, g) {
    // 中央车体:八角形箱体
    const oct = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      oct.push([Math.cos(a) * 0.82, Math.sin(a) * 0.82]);
    }
    const body = extrude(shapeFrom(oct), 0.5, 0.03);
    body.rotateX(-Math.PI / 2);
    add(g, body, M.steelDark, 0, 0.7, 0);
    // X 形车架腿:从中央斜伸到两侧履带架
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const a = [sx * 0.35, 0.72, sz * 0.35];
        const b = [sx * 1.05, 0.62, sz * (UC.gauge / 2 - 0.12)];
        const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
        const leg = rbox(len, 0.42, 0.42, 0.04);
        const m = add(g, leg, M.steelDark, (a[0] + b[0]) / 2, 0.64, (a[2] + b[2]) / 2);
        m.rotation.y = -Math.atan2(b[2] - a[2], b[0] - a[0]);
      }
    }
    // 回转支承:外圈 + 一圈螺栓
    add(g, latheZ([[0.7, -0.05], [0.98, -0.05], [0.98, 0.05], [0.7, 0.05]], 48), M.cast, 0, UC.swingBearingY - 0.02, 0, -Math.PI / 2, 0, 0);
    // latheZ 轴沿 Z,转到沿 Y
    const bl = [];
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      bl.push([Math.cos(a) * 0.9, UC.swingBearingY + 0.035, Math.sin(a) * 0.9]);
    }
    add(g, bolts(bl, 0.018, 0.03, 'y'), M.pin);
    add(g, cylY(0.72, 0.05, 40, 0, UC.swingBearingY - 0.07, 0), M.steelDark);
    // 中心回转接头
    add(g, cylY(0.12, 0.3, 14, 0, 0.9, 0), M.steel);
    // 底护板
    add(g, box(1.3, 0.03, 1.3, 0, 0.44, 0), M.steelDark);
  }

  _buildSideFrame(M, g, zc, sz) {
    // 履带架:箱形梁,顶面做成斜坡好让泥土滑落
    const hw = 0.19;
    const frame = extrudeX(
      [
        [-hw, 0.36],
        [hw, 0.36],
        [hw, 0.58],
        [0.07, 0.67],
        [-0.07, 0.67],
        [-hw, 0.58],
      ],
      -1.58,
      1.42
    );
    add(g, frame, M.steelDark, 0, 0, zc);
    // 支重轮内侧护板(外侧敞开,看得见支重轮)
    add(g, box(UC.lowerRollerSpan + 0.3, 0.14, 0.025, 0, 0.31, zc - sz * 0.215), M.steelDark);
    // 引导轮叉架 + 张紧缓冲器罩
    add(g, rbox(0.62, 0.3, 0.3, 0.03), M.steelDark, UC.idler.x - 0.38, UC.idler.y, zc);
    add(g, cylZ(0.09, 0.36, 14, UC.idler.x, UC.idler.y, zc), M.steel);
    // 引导轮护板
    add(g, box(0.4, 0.34, 0.02, UC.idler.x - 0.12, UC.idler.y + 0.02, zc + sz * 0.18), M.steelDark);
    // 行走马达(驱动轮内侧)
    const motor = latheZ(
      [
        [0.05, 0],
        [0.3, 0],
        [0.3, 0.05],
        [0.26, 0.08],
        [0.26, 0.22],
        [0.19, 0.28],
        [0.05, 0.28],
      ],
      28
    );
    const m = add(g, motor, M.steelDark, UC.sprocket.x, UC.sprocket.y, zc - sz * 0.17);
    if (sz > 0) m.rotation.y = Math.PI;
    add(g, bolts(
      Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2;
        return [UC.sprocket.x + Math.cos(a) * 0.22, UC.sprocket.y + Math.sin(a) * 0.22, zc - sz * 0.25];
      }),
      0.016,
      0.025
    ), M.pin);
    // 行走马达护罩 + 油管
    add(g, box(0.45, 0.12, 0.26, UC.sprocket.x + 0.25, UC.sprocket.y + 0.28, zc - sz * 0.25), M.steelDark);
    add(g, rod([UC.sprocket.x + 0.15, UC.sprocket.y + 0.1, zc - sz * 0.42], [-0.3, 0.8, zc - sz * 0.9], 0.02), M.hose);
    add(g, rod([UC.sprocket.x + 0.2, UC.sprocket.y + 0.05, zc - sz * 0.42], [-0.3, 0.75, zc - sz * 0.88], 0.02), M.hose);
    // 支重轮支座
    for (let i = 0; i < UC.lowerRollers; i++) {
      const x = lerp(-UC.lowerRollerSpan / 2, UC.lowerRollerSpan / 2, i / (UC.lowerRollers - 1));
      add(g, box(0.18, 0.08, 0.5, x, 0.36, zc), M.steelDark);
    }
    // 行驶方向标:引导轮一端是"前"
    const arrow = new THREE.Shape();
    arrow.moveTo(0.18, 0);
    arrow.lineTo(0.02, 0.1);
    arrow.lineTo(0.02, 0.04);
    arrow.lineTo(-0.16, 0.04);
    arrow.lineTo(-0.16, -0.04);
    arrow.lineTo(0.02, -0.04);
    arrow.lineTo(0.02, -0.1);
    arrow.closePath();
    const ag = new THREE.ShapeGeometry(arrow);
    const am = add(g, ag, M.body, 0.9, 0.47, zc + sz * (hw + 0.004));
    if (sz < 0) am.rotation.x = Math.PI; // 翻到外侧,箭头仍指向 +X
  }

  /** 左右履带各自走过的距离(米,正 = 向前) */
  drive(left, right) {
    const ds = [left, right];
    for (let i = 0; i < 2; i++) {
      // 向前走时,贴地那一段相对车身往后跑,即 s 减小
      this.belts[i].update(-ds[i]);
      this.dist[i] += ds[i];
    }
    for (const sp of this.spinners) {
      // 所有轮子都随履带逆时针(+Z)转:角度 = s / r
      sp.obj.rotation.z = -this.dist[sp.side] / sp.r;
    }
  }
}
