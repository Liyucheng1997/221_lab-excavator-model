/**
 * 可挖掘地形:一张高度场网格(0.25 m 一格)。
 *
 * 顶点排布(rotateX(-90°) 之后,直接就是世界坐标):
 *   顶点 (i, j)  →  x = -size/2 + i·cell,  z = -size/2 + j·cell,  y = heights[j·(N+1)+i]
 *
 * 挖:沿斗齿刃口那条线段,把附近格子削到齿尖高度,削掉的体积进斗。
 * 刮:斗背/斗底贴着地面走,把高出来的土往前推 —— 平地就靠这个。
 * 卸:把体积摊到落点附近,再做松弛 —— 土堆不能立得比休止角更陡。
 */
import * as THREE from 'three';
import { TERRAIN } from './config.js';
import { clamp } from './linkage.js';

function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, z) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const tx = x - xi;
  const tz = z - zi;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const a = hash(xi, zi);
  const b = hash(xi + 1, zi);
  const c = hash(xi, zi + 1);
  const d = hash(xi + 1, zi + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

function detailTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#b8b0a4';
  g.fillRect(0, 0, 256, 256);
  // 石子、土块
  for (let i = 0; i < 900; i++) {
    const v = 120 + Math.random() * 110;
    g.fillStyle = `rgba(${v},${v * 0.95},${v * 0.88},${0.25 + Math.random() * 0.35})`;
    const r = 0.6 + Math.random() * 2.4;
    g.beginPath();
    g.ellipse(Math.random() * 256, Math.random() * 256, r, r * (0.6 + Math.random() * 0.5), Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }
  // 履带印/车辙那样的细纹
  g.strokeStyle = 'rgba(90,80,70,0.12)';
  for (let i = 0; i < 60; i++) {
    g.lineWidth = 0.5 + Math.random() * 1.5;
    g.beginPath();
    const y = Math.random() * 256;
    g.moveTo(0, y);
    g.bezierCurveTo(80, y + (Math.random() - 0.5) * 30, 170, y + (Math.random() - 0.5) * 30, 256, y);
    g.stroke();
  }
  const img = g.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 30;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export class Terrain {
  constructor() {
    this.size = TERRAIN.size;
    this.N = TERRAIN.segments;
    this.cell = this.size / this.N;
    this.stride = this.N + 1;
    const n = this.stride * this.stride;

    this.heights = new Float32Array(n);
    this.base = new Float32Array(n); // 原始地面,用于判分
    this.disturbed = new Float32Array(n); // 0 = 原状土(硬),1 = 翻动过的松土
    this.tint = new Float32Array(n); // 表层颜色变化(碎石、湿土)

    const geo = new THREE.PlaneGeometry(this.size, this.size, this.N, this.N);
    geo.rotateX(-Math.PI / 2);
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * this.size * 0.5, uv.getY(i) * this.size * 0.5);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), Math.hypot(this.size * 0.7071, TERRAIN.maxDigDepth + 6));
    for (const k of ['position', 'normal', 'color']) geo.attributes[k].setUsage(THREE.DynamicDrawUsage);
    this.geometry = geo;

    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: detailTexture(),
      roughness: 0.96,
      metalness: 0,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;

    this._c = new THREE.Color();
    this._dirty = null;
    this.generate({});
  }

  idx(i, j) {
    return j * this.stride + i;
  }
  gx(x) {
    return (x + this.size / 2) / this.cell;
  }
  gz(z) {
    return (z + this.size / 2) / this.cell;
  }
  wx(i) {
    return -this.size / 2 + i * this.cell;
  }
  wz(j) {
    return -this.size / 2 + j * this.cell;
  }

  /**
   * 生成场地。layout:
   *   flat: 平整度(0 = 起伏,1 = 全平)
   *   clear: [x, z, r] 机器脚下压平的范围
   *   features: [{type:'pile'|'pit'|'ramp'|'mound'|'bench', ...}]
   */
  generate(layout = {}) {
    const { stride } = this;
    const flat = layout.flat ?? 0.4;
    const [cx, cz, cr] = layout.clear || [0, 0, 7];
    const feats = layout.features || [];
    for (let j = 0; j < stride; j++) {
      for (let i = 0; i < stride; i++) {
        const x = this.wx(i);
        const z = this.wz(j);
        let h =
          (vnoise(x * 0.045, z * 0.045) - 0.5) * 0.9 +
          (vnoise(x * 0.13 + 7, z * 0.13 + 3) - 0.5) * 0.25 +
          (vnoise(x * 0.6, z * 0.6) - 0.5) * 0.04;
        h *= 1 - flat;
        const d = Math.hypot(x - cx, z - cz);
        h *= clamp((d - cr) / 8, 0, 1);
        let dist = 0;
        for (const f of feats) {
          const r = this._feature(f, x, z);
          h = r.h === undefined ? h + r.add : r.h + h * 0.05;
          dist = Math.max(dist, r.loose || 0);
        }
        const k = this.idx(i, j);
        this.heights[k] = h;
        this.disturbed[k] = dist;
        this.tint[k] = vnoise(x * 0.3 + 11, z * 0.3 - 5);
      }
    }
    this.base.set(this.heights);
    this._markAll();
    this.flush();
  }

  _feature(f, x, z) {
    switch (f.type) {
      case 'pile': {
        // 松土堆:圆锥 + 顶部平缓
        const d = Math.hypot(x - f.x, z - f.z);
        const t = clamp(1 - d / f.r, 0, 1);
        const add = f.h * Math.pow(t, 0.8) * (0.9 + 0.1 * vnoise(x * 1.3, z * 1.3));
        return { add, loose: t > 0 ? 1 : 0 };
      }
      case 'mound': {
        // 平地上的零散土包(平整场地练习用)
        const d = Math.hypot(x - f.x, z - f.z);
        const t = clamp(1 - d / f.r, 0, 1);
        return { add: f.h * t * t * (3 - 2 * t), loose: t > 0 ? 0.8 : 0 };
      }
      case 'pit': {
        const ax = Math.abs(x - f.x) - f.hx;
        const az = Math.abs(z - f.z) - f.hz;
        const e = Math.max(ax, az);
        const t = clamp(-e / 1.2, 0, 1);
        return { add: -f.depth * t };
      }
      case 'ramp': {
        // 沿 x 的坡道 + 顶部平台:x0→x1 上坡,x1→x2 平台,x2→x3 下坡;宽度 |z-zc|<w
        const { x0, x1, x2, x3, zc, w, h } = f;
        const edge = clamp((w + 1.5 - Math.abs(z - zc)) / 1.5, 0, 1);
        let y = 0;
        if (x > x0 && x < x1) y = ((x - x0) / (x1 - x0)) * h;
        else if (x >= x1 && x <= x2) y = h;
        else if (x > x2 && x < x3) y = ((x3 - x) / (x3 - x2)) * h;
        return { add: y * edge };
      }
      case 'level': {
        // 把一块区域强制压到某个高度
        const ax = Math.abs(x - f.x) - f.hx;
        const az = Math.abs(z - f.z) - f.hz;
        const e = Math.max(ax, az);
        if (e < 0) return { h: f.y };
        return { add: 0 };
      }
      default:
        return { add: 0 };
    }
  }

  _markAll() {
    this._dirty = { i0: 0, j0: 0, i1: this.N, j1: this.N };
  }

  _mark(i0, j0, i1, j1) {
    i0 = clamp(i0, 0, this.N);
    j0 = clamp(j0, 0, this.N);
    i1 = clamp(i1, 0, this.N);
    j1 = clamp(j1, 0, this.N);
    const d = this._dirty;
    if (!d) this._dirty = { i0, j0, i1, j1 };
    else {
      d.i0 = Math.min(d.i0, i0);
      d.j0 = Math.min(d.j0, j0);
      d.i1 = Math.max(d.i1, i1);
      d.j1 = Math.max(d.j1, j1);
    }
  }

  /** 双线性插值取高度 */
  heightAt(x, z) {
    const fx = clamp(this.gx(x), 0, this.N - 1e-4);
    const fz = clamp(this.gz(z), 0, this.N - 1e-4);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const h = this.heights;
    const k = this.idx(i, j);
    return (
      h[k] * (1 - tx) * (1 - tz) +
      h[k + 1] * tx * (1 - tz) +
      h[k + this.stride] * (1 - tx) * tz +
      h[k + this.stride + 1] * tx * tz
    );
  }

  looseAt(x, z) {
    const i = clamp(Math.round(this.gx(x)), 0, this.N);
    const j = clamp(Math.round(this.gz(z)), 0, this.N);
    return this.disturbed[this.idx(i, j)];
  }

  /** 把 volume 立方米的土卸在 (x,z) 附近,堆成一小堆 */
  deposit(x, z, volume, R = 1.0, relax = true) {
    const i0 = clamp(Math.floor(this.gx(x - R)), 0, this.N);
    const i1 = clamp(Math.ceil(this.gx(x + R)), 0, this.N);
    const j0 = clamp(Math.floor(this.gz(z - R)), 0, this.N);
    const j1 = clamp(Math.ceil(this.gz(z + R)), 0, this.N);
    let wsum = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(this.wx(i) - x, this.wz(j) - z);
        if (d < R) wsum += 1 - d / R;
      }
    }
    if (wsum <= 0) return;
    const cellArea = this.cell * this.cell;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(this.wx(i) - x, this.wz(j) - z);
        if (d >= R) continue;
        const w = (1 - d / R) / wsum;
        const k = this.idx(i, j);
        this.heights[k] += (volume * w) / cellArea;
        this.disturbed[k] = 1;
      }
    }
    this._mark(i0, j0, i1, j1);
    if (relax) this._relax(i0 - 6, j0 - 6, i1 + 6, j1 + 6, 8);
    else this._relax(i0 - 2, j0 - 2, i1 + 2, j1 + 2, 2);
  }

  /** 松弛:土堆不能比休止角更陡,陡了就往低处塌。只在动过的那一小片里迭代。 */
  _relax(i0, j0, i1, j1, iters) {
    i0 = clamp(i0, 1, this.N - 1);
    i1 = clamp(i1, 1, this.N - 1);
    j0 = clamp(j0, 1, this.N - 1);
    j1 = clamp(j1, 1, this.N - 1);
    const maxDrop = TERRAIN.soilRepose * this.cell;
    const h = this.heights;
    const S = this.stride;
    for (let it = 0; it < iters; it++) {
      let moved = 0;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const k = j * S + i;
          for (const nk of [k + 1, k - 1, k + S, k - S]) {
            const diff = h[k] - h[nk] - maxDrop;
            if (diff > 0) {
              // 原状土站得住(黏聚力),只有松土才塌
              const loose = Math.max(this.disturbed[k], 0.15);
              const m = diff * 0.22 * loose;
              h[k] -= m;
              h[nk] += m;
              this.disturbed[nk] = Math.max(this.disturbed[nk], 0.7);
              moved += m;
            }
          }
        }
      }
      if (moved < 1e-5) break;
    }
    this._mark(i0 - 1, j0 - 1, i1 + 1, j1 + 1);
  }

  /**
   * 把 heights 写回 GPU。只处理脏区,并且只上传脏区所在的那几行。
   * 法线用高度场的闭式解 n = normalize(-dh/dx, 1, -dh/dz),开销只跟挖动的面积成正比。
   */
  flush() {
    if (!this._dirty) return;
    const { i0, j0, i1, j1 } = this._dirty;
    const pos = this.geometry.attributes.position;
    const col = this.geometry.attributes.color;
    const nor = this.geometry.attributes.normal;
    const N = this.N;
    const h = this.heights;
    const ni0 = Math.max(0, i0 - 1);
    const nj0 = Math.max(0, j0 - 1);
    const ni1 = Math.min(N, i1 + 1);
    const nj1 = Math.min(N, j1 + 1);
    const inv = 1 / (2 * this.cell);
    for (let j = nj0; j <= nj1; j++) {
      for (let i = ni0; i <= ni1; i++) {
        const k = this.idx(i, j);
        pos.setY(k, h[k]);
        const l = this.idx(Math.max(0, i - 1), j);
        const r = this.idx(Math.min(N, i + 1), j);
        const u = this.idx(i, Math.max(0, j - 1));
        const dn = this.idx(i, Math.min(N, j + 1));
        const dx = (h[r] - h[l]) * inv;
        const dz = (h[dn] - h[u]) * inv;
        const len = Math.hypot(dx, 1, dz);
        nor.setXYZ(k, -dx / len, 1 / len, -dz / len);
        // 原状土偏干偏灰,新翻的土更深更湿;挖得越深颜色越偏红黄(下层土)
        const d = this.disturbed[k];
        const cut = clamp((this.base[k] - h[k]) / 2.5, 0, 1);
        const t = this.tint[k];
        const slope = clamp(Math.hypot(dx, dz) * 0.6, 0, 1);
        this._c.setRGB(
          0.58 - 0.16 * d + 0.06 * cut + 0.05 * (t - 0.5) - 0.05 * slope,
          0.5 - 0.17 * d - 0.03 * cut + 0.04 * (t - 0.5) - 0.05 * slope,
          0.39 - 0.14 * d - 0.07 * cut + 0.03 * (t - 0.5) - 0.04 * slope,
          THREE.SRGBColorSpace
        );
        col.setXYZ(k, this._c.r, this._c.g, this._c.b);
      }
    }
    // 只上传脏的那几行
    const start = this.idx(0, nj0);
    const count = (nj1 - nj0 + 1) * this.stride;
    for (const a of [pos, nor, col]) {
      a.clearUpdateRanges();
      a.addUpdateRange(start * 3, count * 3);
      a.needsUpdate = true;
    }
    this._dirty = null;
  }

  /** 某点相对原始地面挖掉/填高了多少(正 = 挖低了) */
  cutDepthAt(x, z) {
    const i = clamp(Math.round(this.gx(x)), 0, this.N);
    const j = clamp(Math.round(this.gz(z)), 0, this.N);
    const k = this.idx(i, j);
    return this.base[k] - this.heights[k];
  }

  /** 统计一个矩形区域里的高度,用于沟槽/平整类任务判分 */
  sampleRegion(cx, cz, halfX, halfZ) {
    const i0 = clamp(Math.ceil(this.gx(cx - halfX)), 0, this.N);
    const i1 = clamp(Math.floor(this.gx(cx + halfX)), 0, this.N);
    const j0 = clamp(Math.ceil(this.gz(cz - halfZ)), 0, this.N);
    const j1 = clamp(Math.floor(this.gz(cz + halfZ)), 0, this.N);
    const out = [];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) out.push(this.heights[this.idx(i, j)]);
    }
    return out;
  }

  /** 区域内原始地面平均高度 */
  baseRegion(cx, cz, halfX, halfZ) {
    const i0 = clamp(Math.ceil(this.gx(cx - halfX)), 0, this.N);
    const i1 = clamp(Math.floor(this.gx(cx + halfX)), 0, this.N);
    const j0 = clamp(Math.ceil(this.gz(cz - halfZ)), 0, this.N);
    const j1 = clamp(Math.floor(this.gz(cz + halfZ)), 0, this.N);
    const out = [];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) out.push(this.base[this.idx(i, j)]);
    }
    return out;
  }
}
