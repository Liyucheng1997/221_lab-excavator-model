/**
 * 高空作业课程用的道具:钢结构厂房的一跨(H 型钢柱 + 屋面钢梁 + 檩条)和吊在梁下的灯具。
 * 钢架实现和其他道具一样的碰撞接口 hit(p) → 'block',平台护栏撞上去就停。
 */
import * as THREE from 'three';
import { add, bake, box, cylY, cylZ, bolts } from '../model/geo.js';

const steelMat = new THREE.MeshStandardMaterial({ color: 0x6f8aa3, roughness: 0.55, metalness: 0.5 });
const greyMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.6, metalness: 0.4 });
const concrete = new THREE.MeshStandardMaterial({ color: 0xa8a39a, roughness: 0.95 });
const lampBody = new THREE.MeshStandardMaterial({ color: 0x2f3338, roughness: 0.45, metalness: 0.6 });
const lampLens = new THREE.MeshStandardMaterial({ color: 0xf4f1e6, emissive: 0x000000, roughness: 0.2 });
const markMat = new THREE.MeshBasicMaterial({ color: 0x46d67f, transparent: true, opacity: 0.6, depthWrite: false });

/** H 型钢:沿 y 竖着的柱子(翼缘朝 ±x) */
function hColumn(g, x, z, h, w = 0.36, d = 0.36) {
  add(g, box(0.02, h, d * 0.92, x, h / 2, z), steelMat);
  for (const s of [-1, 1]) add(g, box(0.025, h, d, x + (s * w) / 2, h / 2, z), steelMat);
  add(g, box(w + 0.2, 0.03, d + 0.2, x, 0.015, z), greyMat);
  add(g, bolts([[x - w / 2 - 0.06, 0.04, z - 0.15], [x - w / 2 - 0.06, 0.04, z + 0.15], [x + w / 2 + 0.06, 0.04, z - 0.15], [x + w / 2 + 0.06, 0.04, z + 0.15]], 0.02, 0.03, 'y'), greyMat);
  add(g, box(w + 0.5, 0.25, d + 0.5, x, -0.1, z), concrete);
}

/** H 型钢梁:沿 z 水平(翼缘在上下) */
function hBeamZ(g, x, y, z0, z1, hgt = 0.5, w = 0.28) {
  const L = z1 - z0;
  const zc = (z0 + z1) / 2;
  add(g, box(0.016, hgt, L, x, y, zc), steelMat);
  for (const s of [-1, 1]) add(g, box(w, 0.022, L, x, y + (s * hgt) / 2, zc), steelMat);
}

/**
 * 一跨钢结构:两根柱子(z = ±halfSpan)+ 屋面梁(底面高 beamY)+ 沿 x 的两根檩条。
 * 柱子在 x = cx。
 */
export class SteelBay {
  constructor({ cx = 12, halfSpan = 4, beamY = 8.8, extraBeams = [] } = {}) {
    this.kind = 'beam';
    this.name = '钢梁';
    this.group = new THREE.Group();
    const g = new THREE.Group();
    const colH = beamY + 0.55;
    this.boxes = [];
    for (const s of [-1, 1]) {
      hColumn(g, cx, s * halfSpan, colH);
      this.boxes.push({ x0: cx - 0.25, x1: cx + 0.25, y0: -1, y1: colH, z0: s * halfSpan - 0.25, z1: s * halfSpan + 0.25 });
      // 牛腿 + 吊车梁(像真厂房)
      add(g, box(0.4, 0.3, 0.3, cx, beamY - 1.6, s * (halfSpan - 0.3)), steelMat);
    }
    hBeamZ(g, cx, beamY + 0.25, -halfSpan - 0.2, halfSpan + 0.2);
    this.boxes.push({ x0: cx - 0.2, x1: cx + 0.2, y0: beamY, y1: beamY + 0.55, z0: -halfSpan - 0.3, z1: halfSpan + 0.3 });
    // 檩条:沿 x 伸出去(C 型钢)
    for (const z of [-2.6, -0.9, 0.9, 2.6]) {
      add(g, box(4.2, 0.2, 0.08, cx, beamY + 0.6, z), greyMat);
    }
    // 屋面板(只做一条,示意)
    add(g, box(4.4, 0.03, halfSpan * 2 + 0.6, cx, beamY + 0.72, 0), new THREE.MeshStandardMaterial({ color: 0xd6dde3, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide }));
    // 额外的横管(上方障碍:消防水管、风管)
    for (const b of extraBeams) {
      const L = b.x1 - b.x0;
      add(g, cylZ(b.r, L, 18), new THREE.MeshStandardMaterial({ color: b.color ?? 0xc0392b, roughness: 0.5, metalness: 0.3 }), (b.x0 + b.x1) / 2, b.y, b.z, 0, Math.PI / 2, 0);
      for (const x of [b.x0 + 0.3, b.x1 - 0.3]) add(g, cylY(0.02, beamY - b.y, 6, x, b.y, b.z), greyMat);
      this.boxes.push({ x0: b.x0, x1: b.x1, y0: b.y - b.r, y1: b.y + b.r, z0: b.z - b.r, z1: b.z + b.r });
    }
    const baked = bake(g);
    baked.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.group.add(baked);
  }
  hit(p) {
    for (const b of this.boxes) {
      if (p.x > b.x0 && p.x < b.x1 && p.y > b.y0 && p.y < b.y1 && p.z > b.z0 && p.z < b.z1) return 'block';
    }
    return null;
  }
}

/** 吊在梁下的工矿灯 —— 高空作业的"作业点"。done() 后灯亮起来 */
export class HighBayLamp {
  constructor(x, y, z) {
    this.group = new THREE.Group();
    this.group.position.set(x, y, z);
    this.pos = new THREE.Vector3(x, y, z);
    const g = this.group;
    add(g, cylY(0.012, 0.6, 6, 0, 0, 0), greyMat); // 吊杆
    add(g, cylY(0.09, 0.14, 16, 0, -0.14, 0), lampBody);
    const shade = new THREE.ConeGeometry(0.28, 0.24, 24, 1, true);
    shade.translate(0, -0.26, 0);
    add(g, shade, lampBody).material.side = THREE.DoubleSide;
    this.lens = new THREE.Mesh(new THREE.CircleGeometry(0.27, 24), lampLens.clone());
    this.lens.rotation.x = Math.PI / 2;
    this.lens.position.y = -0.375;
    g.add(this.lens);
    // 地面上的投影标记(提示该停在哪)
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 32), markMat.clone());
    this.ring.rotation.x = -Math.PI / 2;
    this.lit = false;
  }
  /** 灯具最低点 */
  get bottom() {
    return this.pos.y - 0.38;
  }
  setLit(v) {
    this.lit = v;
    this.lens.material.emissive.setRGB(v ? 1 : 0, v ? 0.95 : 0, v ? 0.8 : 0);
  }
}
