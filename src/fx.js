/**
 * 特效:从斗口落下的土块、落地扬尘、排气烟。
 *
 * 落土不是"瞬间出现在地上",而是一块块从斗刃掉下去 —— 落在车厢里就进车,落在外面就堆在地上。
 * 这样你能亲眼看到"斗子没对准车厢、土撒到车外面去了"。
 */
import * as THREE from 'three';

const MAX_CHUNKS = 700;
const G = 9.8;

function smokeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Fx {
  /**
   * surface(p) → { y, target }  给定位置正下方的落点高度和落到了什么上面
   * onLand(p, vol, target)      土块落地
   */
  constructor(scene, { surface, onLand }) {
    this.surface = surface;
    this.onLand = onLand;
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x6b5234, roughness: 1, flatShading: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_CHUNKS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.chunks = [];
    this._d = new THREE.Object3D();
    this.pending = new Map(); // 落地体积按 0.4 m 网格攒一下再交给地形,避免每块都做一次松弛
    this._flushT = 0;

    // 扬尘 / 烟:精灵池
    const tex = smokeTexture();
    this.puffs = [];
    for (let i = 0; i < 90; i++) {
      const m = new THREE.SpriteMaterial({ map: tex, color: 0xb8a58a, transparent: true, depthWrite: false, opacity: 0 });
      const s = new THREE.Sprite(m);
      s.visible = false;
      scene.add(s);
      this.puffs.push({ s, life: 0, max: 1, vel: new THREE.Vector3(), grow: 1 });
    }
    this._puffI = 0;
    this._smokeAcc = 0;
  }

  /** 从 p 撒出 vol 立方米的土,初速度 vel(斗子的速度) */
  spill(p, vol, vel) {
    const n = Math.min(40, Math.max(1, Math.round(vol / 0.0035)));
    const each = vol / n;
    for (let i = 0; i < n; i++) {
      if (this.chunks.length >= MAX_CHUNKS) {
        // 满了就直接落地,不丢体积
        this._land(p, each, this.surface(p).target);
        continue;
      }
      const size = 0.05 + Math.random() * 0.09;
      this.chunks.push({
        p: new THREE.Vector3(p.x + (Math.random() - 0.5) * 1.0, p.y - Math.random() * 0.1, p.z + (Math.random() - 0.5) * 1.0),
        v: new THREE.Vector3(vel.x * 0.6 + (Math.random() - 0.5) * 0.6, vel.y * 0.4 - Math.random() * 0.5, vel.z * 0.6 + (Math.random() - 0.5) * 0.6),
        r: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        size,
        vol: each,
        y0: p.y,
      });
    }
  }

  _land(p, vol, target, fallH = 0) {
    if (target === 'ground') {
      const key = `${Math.round(p.x / 0.4)},${Math.round(p.z / 0.4)}`;
      const e = this.pending.get(key);
      if (e) e.vol += vol;
      else this.pending.set(key, { x: Math.round(p.x / 0.4) * 0.4, z: Math.round(p.z / 0.4) * 0.4, vol });
    } else {
      this.onLand(p, vol, target, fallH);
    }
  }

  puff(p, color = 0xb8a58a, size = 1.2, life = 1.6, vel = null, opacity = 0.5) {
    const q = this.puffs[this._puffI];
    this._puffI = (this._puffI + 1) % this.puffs.length;
    q.s.position.copy(p);
    q.s.material.color.set(color);
    q.s.visible = true;
    q.life = 0;
    q.max = life;
    q.size = size;
    q.opacity = opacity;
    q.vel.copy(vel || new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.3 + Math.random() * 0.3, (Math.random() - 0.5) * 0.4));
  }

  /** 排气:负载越大冒得越多越黑(柴油机突加负载冒黑烟,真机就这样) */
  exhaust(dt, p, rpm, load, running) {
    if (!running) return;
    this._smokeAcc += dt * (1.5 + load * 7);
    while (this._smokeAcc > 1) {
      this._smokeAcc -= 1;
      const dark = 0x9a9a9a - Math.round(load * 0x5a) * 0x010101;
      this.puff(p, dark, 0.35 + load * 0.4, 1.6 + load, new THREE.Vector3(0.1, 0.9 + rpm / 2000, 0.05), 0.12 + load * 0.35);
    }
  }

  update(dt) {
    let n = 0;
    const d = this._d;
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      c.v.y -= G * dt;
      c.p.addScaledVector(c.v, dt);
      c.r.x += dt * 5;
      c.r.y += dt * 4;
      const s = this.surface(c.p);
      if (c.p.y <= s.y) {
        c.p.y = s.y;
        this._land(c.p, c.vol, s.target, c.y0 - s.y);
        if (Math.random() < 0.08) this.puff(c.p.clone().setY(s.y + 0.2), 0xb8a58a, 1.0, 1.4);
        this.chunks.splice(i, 1);
        continue;
      }
    }
    for (const c of this.chunks) {
      d.position.copy(c.p);
      d.rotation.copy(c.r);
      d.scale.setScalar(c.size);
      d.updateMatrix();
      this.mesh.setMatrixAt(n++, d.matrix);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;

    this._flushT += dt;
    if (this._flushT > 0.15 && this.pending.size) {
      this._flushT = 0;
      for (const e of this.pending.values()) this.onLand(new THREE.Vector3(e.x, 0, e.z), e.vol, 'ground');
      this.pending.clear();
    }

    for (const q of this.puffs) {
      if (!q.s.visible) continue;
      q.life += dt;
      const t = q.life / q.max;
      if (t >= 1) {
        q.s.visible = false;
        continue;
      }
      q.s.position.addScaledVector(q.vel, dt);
      q.s.scale.setScalar(q.size * (0.6 + t * 1.8));
      q.s.material.opacity = q.opacity * (1 - t) * Math.min(1, t * 6);
    }
  }

  clear() {
    this.chunks.length = 0;
    this.pending.clear();
    this.mesh.count = 0;
  }
}
