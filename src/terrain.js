/**
 * 可挖掘地形:一张高度场网格。
 *
 * 顶点排布(rotateX(-90°) 之后,直接就是世界坐标):
 *   顶点 (i, j)  →  x = -size/2 + i·cell,  z = -size/2 + j·cell,  y = heights[j·(N+1)+i]
 *
 * 挖:沿斗齿刃口那条线段,把附近格子削到齿尖高度,削掉的体积进斗。
 * 卸:把体积摊到落点附近,再做松弛 —— 土堆不能立得比休止角更陡。
 */
import * as THREE from 'three';
import { TERRAIN } from './config.js';
import { clamp } from './linkage.js';

export class Terrain {
  constructor(mats) {
    this.size = TERRAIN.size;
    this.N = TERRAIN.segments;
    this.cell = this.size / this.N;
    this.stride = this.N + 1;
    const n = this.stride * this.stride;

    this.heights = new Float32Array(n);
    this.base = new Float32Array(n); // 原始地面,用于"回填/平整"类任务判分
    this.disturbed = new Float32Array(n); // 0=原状土 1=翻动过的新土,只用于上色

    const geo = new THREE.PlaneGeometry(this.size, this.size, this.N, this.N);
    geo.rotateX(-Math.PI / 2);
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    // 包围球给死:地形只有高度在变,范围有限,没必要每次挖土都重算一遍。
    // 半径放宽到能盖住最深的坑和最高的土堆,免得视锥剔除把地面整块剔掉。
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, 0, 0),
      Math.hypot(this.size * 0.7071, TERRAIN.maxDigDepth + 4)
    );
    this.geometry = geo;

    const mat = mats.ground = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.97,
      metalness: 0,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;

    // 顶点色是按**线性空间**取的,不像 material.color 那样会自动从 sRGB 转过来。
    // 直接写"看起来对"的 sRGB 数值会明显偏亮发灰,所以这里显式声明色彩空间来转换。
    this._c = new THREE.Color();

    this._dirty = null;
    this.generate();
  }

  idx(i, j) {
    return j * this.stride + i;
  }

  /** 世界 x → 网格列坐标(浮点) */
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

  generate() {
    const { stride } = this;
    // 缓和的起伏 —— 场地大致是平的,但不能是块几何平板
    for (let j = 0; j < stride; j++) {
      for (let i = 0; i < stride; i++) {
        const x = this.wx(i);
        const z = this.wz(j);
        let h =
          0.28 * Math.sin(x * 0.075) * Math.cos(z * 0.062) +
          0.14 * Math.sin(x * 0.16 + 1.7) * Math.sin(z * 0.13) +
          0.05 * Math.sin(x * 0.5) * Math.cos(z * 0.43);
        // 机器脚下压平,免得一上来就卡在坑里
        const d = Math.hypot(x, z);
        h *= clamp((d - 7) / 6, 0, 1);
        this.heights[this.idx(i, j)] = h;
      }
    }
    this.base.set(this.heights);
    this.disturbed.fill(0);
    this._markAll();
    this.flush();
  }

  _markAll() {
    this._dirty = { i0: 0, j0: 0, i1: this.N, j1: this.N };
  }

  _mark(i0, j0, i1, j1) {
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
    const h00 = this.heights[this.idx(i, j)];
    const h10 = this.heights[this.idx(i + 1, j)];
    const h01 = this.heights[this.idx(i, j + 1)];
    const h11 = this.heights[this.idx(i + 1, j + 1)];
    return (
      h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz) + h01 * (1 - tx) * tz + h11 * tx * tz
    );
  }

  /**
   * 沿斗齿刃口切土。
   *   a, b   刃口两端(世界坐标)
   *   tipY   齿尖高度 —— 低于它的土才切得动
   *   maxVol 斗子还剩多少容量
   *   dt     步长
   * 返回本帧真正挖到的体积(m³)。
   */
  dig(a, b, tipY, maxVol, dt) {
    const reach = 0.34; // 刃口两侧的影响半径
    const maxCut = TERRAIN.digRate * dt;
    const minX = Math.min(a.x, b.x) - reach;
    const maxX = Math.max(a.x, b.x) + reach;
    const minZ = Math.min(a.z, b.z) - reach;
    const maxZ = Math.max(a.z, b.z) + reach;

    const i0 = clamp(Math.floor(this.gx(minX)), 0, this.N);
    const i1 = clamp(Math.ceil(this.gx(maxX)), 0, this.N);
    const j0 = clamp(Math.floor(this.gz(minZ)), 0, this.N);
    const j1 = clamp(Math.ceil(this.gz(maxZ)), 0, this.N);
    if (i1 < i0 || j1 < j0) return 0;

    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const eLen2 = ex * ex + ez * ez || 1e-6;
    const cellArea = this.cell * this.cell;
    let volume = 0;

    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (volume >= maxVol) break;
        const x = this.wx(i);
        const z = this.wz(j);
        // 点到刃口线段的距离
        let t = ((x - a.x) * ex + (z - a.z) * ez) / eLen2;
        t = clamp(t, 0, 1);
        const dx = x - (a.x + ex * t);
        const dz = z - (a.z + ez * t);
        if (dx * dx + dz * dz > reach * reach) continue;

        const k = this.idx(i, j);
        const h = this.heights[k];
        if (h <= tipY) continue;

        let cut = Math.min(h - tipY, maxCut);
        const vol = cut * cellArea;
        if (volume + vol > maxVol) cut = ((maxVol - volume) / cellArea) || 0;
        if (cut <= 0) continue;

        this.heights[k] = h - cut;
        this.disturbed[k] = 1;
        volume += cut * cellArea;
      }
    }
    if (volume > 0) {
      this._mark(i0, j0, i1, j1);
      this._relax(i0 - 3, j0 - 3, i1 + 3, j1 + 3, 3);
    }
    return volume;
  }

  /** 把 volume 立方米的土卸在 (x,z) 附近,堆成一小堆 */
  deposit(x, z, volume) {
    const R = 1.5;
    const i0 = clamp(Math.floor(this.gx(x - R)), 0, this.N);
    const i1 = clamp(Math.ceil(this.gx(x + R)), 0, this.N);
    const j0 = clamp(Math.floor(this.gz(z - R)), 0, this.N);
    const j1 = clamp(Math.ceil(this.gz(z + R)), 0, this.N);

    // 先算权重和,保证摊下去的总体积正好等于 volume
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
    this._relax(i0 - 5, j0 - 5, i1 + 5, j1 + 5, 6);
  }

  /**
   * 松弛:土堆不能比休止角更陡,陡了就往低处塌。
   * 只在动过的那一小片里迭代,所以每帧开销很小。
   */
  _relax(i0, j0, i1, j1, iters) {
    i0 = clamp(i0, 0, this.N);
    i1 = clamp(i1, 0, this.N);
    j0 = clamp(j0, 0, this.N);
    j1 = clamp(j1, 0, this.N);
    const maxDrop = TERRAIN.soilRepose * this.cell;
    for (let it = 0; it < iters; it++) {
      let moved = 0;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const k = this.idx(i, j);
          const h = this.heights[k];
          for (const [di, dj] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const ni = i + di;
            const nj = j + dj;
            if (ni < 0 || ni > this.N || nj < 0 || nj > this.N) continue;
            const nk = this.idx(ni, nj);
            const diff = h - this.heights[nk] - maxDrop;
            if (diff > 0) {
              const m = diff * 0.25;
              this.heights[k] -= m;
              this.heights[nk] += m;
              this.disturbed[nk] = Math.max(this.disturbed[nk], 0.7);
              moved += m;
            }
          }
        }
      }
      if (moved < 1e-4) break;
    }
    this._mark(i0, j0, i1, j1);
  }

  /**
   * 把 heights 写回 GPU。只处理脏区。
   *
   * 法线是**解析**求的,不用 computeVertexNormals():
   * 后者每次要扫全部 48841 个顶点、约 8.7ms,挖土时每帧都触发,直接吃掉半个帧预算。
   * 高度场的法线本来就有闭式解 n = normalize(-dh/dx, 1, -dh/dz),只需要邻居的高度,
   * 于是开销就只跟真正挖动的那一小片成正比了。
   */
  flush() {
    if (!this._dirty) return;
    const { i0, j0, i1, j1 } = this._dirty;
    const pos = this.geometry.attributes.position;
    const col = this.geometry.attributes.color;
    const nor = this.geometry.attributes.normal;
    const N = this.N;
    const h = this.heights;

    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = this.idx(i, j);
        pos.setY(k, h[k]);
        // 新翻的土更深更红,原状土偏干偏灰 —— 这样你能一眼看出自己挖过哪儿
        const d = this.disturbed[k];
        this._c.setRGB(0.52 - 0.18 * d, 0.42 - 0.19 * d, 0.3 - 0.15 * d, THREE.SRGBColorSpace);
        col.setXYZ(k, this._c.r, this._c.g, this._c.b);
      }
    }

    // 顶点高度一变,相邻顶点的法线也跟着变,所以法线要比高度多算一圈
    const ni0 = Math.max(0, i0 - 1);
    const nj0 = Math.max(0, j0 - 1);
    const ni1 = Math.min(N, i1 + 1);
    const nj1 = Math.min(N, j1 + 1);
    const inv = 1 / (2 * this.cell);
    for (let j = nj0; j <= nj1; j++) {
      for (let i = ni0; i <= ni1; i++) {
        const l = this.idx(Math.max(0, i - 1), j);
        const r = this.idx(Math.min(N, i + 1), j);
        const u = this.idx(i, Math.max(0, j - 1));
        const dn = this.idx(i, Math.min(N, j + 1));
        const dx = (h[r] - h[l]) * inv;
        const dz = (h[dn] - h[u]) * inv;
        const len = Math.hypot(dx, 1, dz);
        nor.setXYZ(this.idx(i, j), -dx / len, 1 / len, -dz / len);
      }
    }

    pos.needsUpdate = true;
    col.needsUpdate = true;
    nor.needsUpdate = true;
    this._dirty = null;
  }

  /** 某点相对原始地面挖掉/填高了多少(正 = 挖低了) */
  cutDepthAt(x, z) {
    const fx = clamp(Math.round(this.gx(x)), 0, this.N);
    const fz = clamp(Math.round(this.gz(z)), 0, this.N);
    const k = this.idx(fx, fz);
    return this.base[k] - this.heights[k];
  }

  /** 统计一个矩形区域里的高度,用于沟槽/平整类任务判分 */
  sampleRegion(cx, cz, halfX, halfZ) {
    const i0 = clamp(Math.floor(this.gx(cx - halfX)), 0, this.N);
    const i1 = clamp(Math.ceil(this.gx(cx + halfX)), 0, this.N);
    const j0 = clamp(Math.floor(this.gz(cz - halfZ)), 0, this.N);
    const j1 = clamp(Math.ceil(this.gz(cz + halfZ)), 0, this.N);
    const out = [];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) out.push(this.heights[this.idx(i, j)]);
    }
    return out;
  }
}
