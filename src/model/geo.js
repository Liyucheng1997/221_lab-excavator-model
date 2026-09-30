/**
 * 建模工具:挤出、倒角盒、销轴、绕轮系的闭合带路径、随动软管、按材质合并。
 *
 * 模型零件很多(几百个),如果每个都是独立 Mesh,draw call 会压垮帧率。
 * 所以约定:静态零件先正常拼进一个 Group,最后 bake() 按材质合并成少数几个 Mesh。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// ── 形状 ───────────────────────────────────────────────────────────────

export function shapeFrom(pts) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return s;
}

/** 两端圆头的连杆轮廓(狗骨头形),a、b 是两个销孔中心 */
export function linkShape(a, b, ra, rb, holeR = 0) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx);
  const phi = Math.asin((ra - rb) / L);
  const s = new THREE.Shape();
  // 从 a 的下切点出发,沿外切线到 b,绕 b 半圈回来
  s.absarc(a[0], a[1], ra, ang + Math.PI / 2 + phi, ang + (3 * Math.PI) / 2 - phi, false);
  s.absarc(b[0], b[1], rb, ang - Math.PI / 2 - phi, ang + Math.PI / 2 + phi, false);
  s.closePath();
  if (holeR > 0) {
    for (const [c, r] of [
      [a, holeR],
      [b, holeR],
    ]) {
      const h = new THREE.Path();
      h.absarc(c[0], c[1], r, 0, Math.PI * 2, true);
      s.holes.push(h);
    }
  }
  return s;
}

export function roundRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** XY 平面上的形状沿 Z 挤出,Z 方向居中 */
export function extrude(shape, depth, bevel = 0.02, curveSegments = 10) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-3, depth - 2 * bevel),
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: bevel > 0 ? 2 : 0,
    curveSegments,
  });
  g.translate(0, 0, -depth / 2 + bevel);
  g.computeVertexNormals();
  return g;
}

/** 平面图(x, z)挤出成竖直方向的实体:底在 y0,顶在 y0+h */
export function extrudePlan(pts, y0, h, bevel = 0.03) {
  // 形状画在 XY 里,用 (x, -z) 使挤出后绕 X 转 -90° 刚好落回 (x, z)
  const g = extrude(
    shapeFrom(pts.map(([x, z]) => [x, -z])),
    h,
    bevel
  );
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0 + h / 2, 0);
  return g;
}

// ── 基本体 ─────────────────────────────────────────────────────────────

export function box(w, h, d, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

export function rbox(w, h, d, r = 0.03, x = 0, y = 0, z = 0, seg = 2) {
  const g = new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
  g.translate(x, y, z);
  return g;
}

/** 沿 Z 的圆柱(销轴、轮子) */
export function cylZ(r, len, seg = 16, x = 0, y = 0, z = 0) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

export function cylY(r, h, seg = 16, x = 0, y = 0, z = 0, r2 = r) {
  const g = new THREE.CylinderGeometry(r2, r, h, seg);
  g.translate(x, y + h / 2, z);
  return g;
}

/** 从原点沿 +X 伸出 1 的单位圆柱,之后用 scale.x 拉长(油缸、活塞杆) */
export function unitCylX(r, seg = 16) {
  const g = new THREE.CylinderGeometry(r, r, 1, seg);
  g.translate(0, 0.5, 0);
  g.rotateZ(-Math.PI / 2);
  return g;
}

/** 两点之间的圆管 */
export function rod(a, b, r, seg = 10) {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const L = va.distanceTo(vb);
  const g = new THREE.CylinderGeometry(r, r, L, seg);
  g.translate(0, L / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    vb.clone().sub(va).normalize()
  );
  g.applyQuaternion(q);
  g.translate(va.x, va.y, va.z);
  return g;
}

/** 过若干点的平滑管子(扶手、钢管) */
export function tube(points, r, seg = 40, radial = 8, closed = false, tension = 0.1) {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(...p)),
    closed,
    'catmullrom',
    tension
  );
  return new THREE.TubeGeometry(curve, seg, r, radial, closed);
}

/** 带折角的钢管:折点处用小圆角过渡 */
export function pipe(points, r, radial = 8) {
  const path = new THREE.CurvePath();
  const P = points.map((p) => new THREE.Vector3(...p));
  const bend = 0.08;
  let prev = P[0].clone();
  for (let i = 1; i < P.length - 1; i++) {
    const a = P[i].clone().sub(P[i - 1]).normalize();
    const b = P[i + 1].clone().sub(P[i]).normalize();
    const p1 = P[i].clone().addScaledVector(a, -bend);
    const p2 = P[i].clone().addScaledVector(b, bend);
    path.add(new THREE.LineCurve3(prev, p1));
    path.add(new THREE.QuadraticBezierCurve3(p1, P[i].clone(), p2));
    prev = p2;
  }
  path.add(new THREE.LineCurve3(prev, P[P.length - 1].clone()));
  return new THREE.TubeGeometry(path, Math.max(8, P.length * 8), r, radial, false);
}

/** 螺栓头阵列(六角头) */
export function bolts(positions, r = 0.018, h = 0.015, axis = 'z') {
  const geos = positions.map(([x, y, z]) => {
    const g = new THREE.CylinderGeometry(r, r, h, 6);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    else if (axis === 'x') g.rotateZ(Math.PI / 2);
    g.translate(x, y, z);
    return g;
  });
  return mergeGeometries(geos);
}

/** 旋转体(支重轮、引导轮)。profile 是 [半径, 轴向位置] 列表,轴沿 Z */
export function latheZ(profile, seg = 24) {
  const g = new THREE.LatheGeometry(
    profile.map(([r, z]) => new THREE.Vector2(r, z)),
    seg
  );
  g.rotateX(Math.PI / 2);
  return g;
}

// ── 组装辅助 ───────────────────────────────────────────────────────────

/** 往 parent 里加一个 Mesh */
export function add(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/**
 * 把一个 Group 里所有静态 Mesh 按材质合并。返回新 Group(坐标系与原 group 相同)。
 * 合并前统一转成非索引几何并只保留 position/normal/uv,避免属性不一致导致合并失败。
 */
export function bake(group, { castShadow = true, receiveShadow = true } = {}) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map();
  group.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    g.applyMatrix4(m);
    const key = o.material;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(g);
  });
  const out = new THREE.Group();
  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = castShadow && !mat.transparent;
    mesh.receiveShadow = receiveShadow;
    out.add(mesh);
    for (const g of geos) g.dispose();
  }
  return out;
}

// ── 绕轮系的闭合带(履带) ────────────────────────────────────────────

/**
 * circles:按逆时针(从 +Z 看)排列的一串圆 {x, y, r},构成凸包。
 * 返回沿外侧的闭合路径:相邻圆之间走外公切线,在圆上走圆弧。
 * at(s) → { x, y, a } 位置与切线方向。
 */
export function beltPath(circles) {
  const n = circles.length;
  const segs = [];
  // 每对相邻圆的外公切线:法线 n 满足 n·(cj-ci) = ri-rj,且 n 在行进方向右侧(外侧)
  const tangents = [];
  for (let i = 0; i < n; i++) {
    const a = circles[i];
    const b = circles[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L = Math.hypot(dx, dy);
    const ux = dx / L;
    const uy = dy / L;
    const sphi = (a.r - b.r) / L;
    const cphi = Math.sqrt(1 - sphi * sphi);
    // 右法线 (uy, -ux),再朝 u 方向偏 φ
    const nx = cphi * uy + sphi * ux;
    const ny = cphi * -ux + sphi * uy;
    tangents.push({
      nx,
      ny,
      p0: [a.x + a.r * nx, a.y + a.r * ny],
      p1: [b.x + b.r * nx, b.y + b.r * ny],
    });
  }
  for (let i = 0; i < n; i++) {
    const t = tangents[i];
    const len = Math.hypot(t.p1[0] - t.p0[0], t.p1[1] - t.p0[1]);
    segs.push({ type: 'line', p0: t.p0, p1: t.p1, len, a: Math.atan2(t.p1[1] - t.p0[1], t.p1[0] - t.p0[0]) });
    // 在下一个圆上从这条切线的法线转到下一条切线的法线(整条带逆时针走,法线也逆时针转)
    const c = circles[(i + 1) % n];
    const nxt = tangents[(i + 1) % n];
    let a0 = Math.atan2(t.ny, t.nx);
    let a1 = Math.atan2(nxt.ny, nxt.nx);
    let da = a1 - a0;
    while (da < 0) da += Math.PI * 2;
    while (da >= Math.PI * 2) da -= Math.PI * 2;
    segs.push({ type: 'arc', c, a0, da, len: da * c.r });
  }
  const total = segs.reduce((s, g) => s + g.len, 0);
  return {
    length: total,
    at(s, out = { x: 0, y: 0, a: 0 }) {
      s = ((s % total) + total) % total;
      for (const g of segs) {
        if (s <= g.len) {
          if (g.type === 'line') {
            const t = g.len > 0 ? s / g.len : 0;
            out.x = g.p0[0] + (g.p1[0] - g.p0[0]) * t;
            out.y = g.p0[1] + (g.p1[1] - g.p0[1]) * t;
            out.a = g.a;
          } else {
            const ang = g.a0 + s / g.c.r;
            out.x = g.c.x + g.c.r * Math.cos(ang);
            out.y = g.c.y + g.c.r * Math.sin(ang);
            out.a = ang + Math.PI / 2;
          }
          return out;
        }
        s -= g.len;
      }
      return out;
    },
  };
}

// ── 随动软管 ───────────────────────────────────────────────────────────

/**
 * 两端固定在不同运动件上的液压软管。每帧给两端的位置和出管方向,
 * 中间按三次贝塞尔弯过去,原地改写顶点,不重建几何。
 */
export class DynamicHose {
  constructor(mat, r = 0.028, segments = 18, radial = 8, slack = 0.35) {
    this.segments = segments;
    this.radial = radial;
    this.r = r;
    this.slack = slack;
    const geo = new THREE.BufferGeometry();
    const vcount = (segments + 1) * (radial + 1);
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vcount * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(vcount * 3), 3));
    const idx = [];
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < radial; j++) {
        const a = i * (radial + 1) + j;
        const b = (i + 1) * (radial + 1) + j;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    geo.setIndex(idx);
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this._p = new THREE.Vector3();
    this._t = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 0, 1);
  }

  /** p0, p1: 端点;d0, d1: 出管方向(单位向量,d1 指向管子外面) */
  update(p0, d0, p1, d1) {
    const L = p0.distanceTo(p1);
    const k = Math.max(0.25, L * this.slack);
    const c0 = p0.clone().addScaledVector(d0, k);
    const c1 = p1.clone().addScaledVector(d1, k);
    const pos = this.geo.attributes.position.array;
    const nor = this.geo.attributes.normal.array;
    const { segments, radial, r } = this;
    let prevN = null;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const u = 1 - t;
      // 位置与导数
      this._p
        .copy(p0)
        .multiplyScalar(u * u * u)
        .addScaledVector(c0, 3 * u * u * t)
        .addScaledVector(c1, 3 * u * t * t)
        .addScaledVector(p1, t * t * t);
      this._t
        .copy(c0)
        .sub(p0)
        .multiplyScalar(3 * u * u)
        .addScaledVector(c1.clone().sub(c0), 6 * u * t)
        .addScaledVector(p1.clone().sub(c1), 3 * t * t)
        .normalize();
      // 平行输运的法线,避免管子拧麻花
      if (!prevN) {
        this._n.copy(this._up).cross(this._t);
        if (this._n.lengthSq() < 1e-6) this._n.set(1, 0, 0).cross(this._t);
        this._n.normalize();
      } else {
        this._n.copy(prevN).addScaledVector(this._t, -prevN.dot(this._t)).normalize();
      }
      prevN = this._n.clone();
      this._b.copy(this._t).cross(this._n);
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        const cx = Math.cos(a);
        const cy = Math.sin(a);
        const nx = this._n.x * cx + this._b.x * cy;
        const ny = this._n.y * cx + this._b.y * cy;
        const nz = this._n.z * cx + this._b.z * cy;
        const o = (i * (radial + 1) + j) * 3;
        pos[o] = this._p.x + nx * r;
        pos[o + 1] = this._p.y + ny * r;
        pos[o + 2] = this._p.z + nz * r;
        nor[o] = nx;
        nor[o + 1] = ny;
        nor[o + 2] = nz;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
  }
}
