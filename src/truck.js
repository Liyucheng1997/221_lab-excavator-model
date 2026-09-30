/**
 * 自卸车:模型 + 自动驾驶 + 车厢里的土。
 *
 * 行为和真实工地一致:
 *   进场 → 开过装车位 → 倒车(倒车喇叭"嘀嘀")→ 停稳等装 → 挖机手按一声喇叭 → 开走 → 下一辆进场
 * 车厢里的土是一张小高度场:落在哪就堆在哪,堆陡了会塌,超过厢板就从边上撒出去。
 * 所以你得像真机手一样,先装车厢前部、再装后部,装得均匀。
 */
import * as THREE from 'three';
import { add, bake, box, rbox, cylZ, cylY } from './model/geo.js';
import { clamp, lerp } from './linkage.js';

const BED = { x0: -4.2, x1: 1.1, halfZ: 1.13, floorY: 1.5, wallH: 1.15 };
const CAB = { x0: 1.55, x1: 3.95, halfZ: 1.25, y0: 1.0, y1: 3.2 };
const NX = 22;
const NZ = 9;

function truckMaterials(M) {
  return {
    cab: new THREE.MeshStandardMaterial({ color: 0xc8202a, roughness: 0.35, metalness: 0.3 }),
    cabDark: new THREE.MeshStandardMaterial({ color: 0x8e141b, roughness: 0.45, metalness: 0.3 }),
    bed: new THREE.MeshStandardMaterial({ color: 0x3d5c86, map: M.body.map, roughness: 0.6, metalness: 0.4 }),
    bedIn: new THREE.MeshStandardMaterial({ color: 0x5b6068, map: M.cast.map, roughness: 0.55, metalness: 0.6 }),
    chrome: M.chrome,
    black: M.black,
    tire: M.tire,
    rim: new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.35, metalness: 0.8 }),
    glass: M.glassDark,
    light: M.lightLens,
    tail: M.tailLight,
    steel: M.steelDark,
  };
}

export class DumpTruck {
  constructor(M) {
    this.group = new THREE.Group();
    this.capacity = 8.0; // m³ 车厢容积
    const T = truckMaterials(M);
    this.T = T;
    const g = new THREE.Group();

    // ── 车架 ──
    for (const z of [-0.5, 0.5]) add(g, box(8.6, 0.28, 0.14, -0.4, 0.95, z), T.steel);
    add(g, box(0.9, 0.5, 0.7, -2.2, 0.8, -1.0), T.chrome); // 油箱
    add(g, box(0.9, 0.5, 0.5, 0.2, 0.8, 1.05), T.black); // 电瓶箱

    // ── 驾驶室(平头) ──
    add(g, rbox(2.3, 2.0, 2.5, 0.12), T.cab, 2.8, 2.15, 0);
    add(g, rbox(2.2, 0.35, 2.4, 0.08), T.cabDark, 2.75, 3.28, 0); // 顶
    add(g, box(0.06, 0.9, 2.2, 3.96, 2.55, 0), T.glass); // 前风挡
    for (const s of [-1, 1]) add(g, box(1.1, 0.75, 0.04, 3.1, 2.6, s * 1.26), T.glass); // 侧窗
    add(g, box(0.08, 0.55, 2.0, 3.97, 1.6, 0), T.black); // 格栅
    for (let i = 0; i < 5; i++) add(g, box(0.02, 0.04, 1.9, 4.01, 1.4 + i * 0.1, 0), T.chrome);
    add(g, rbox(0.25, 0.3, 2.5, 0.05), T.black, 4.0, 1.0, 0); // 保险杠
    for (const s of [-1, 1]) {
      add(g, rbox(0.06, 0.18, 0.3, 0.02), T.light, 4.02, 1.25, s * 0.95);
      // 后视镜
      add(g, box(0.05, 0.4, 0.22, 3.75, 2.65, s * 1.55), T.black);
      add(g, box(0.4, 0.04, 0.04, 3.75, 2.9, s * 1.4), T.black);
      // 脚踏
      add(g, box(0.5, 0.05, 0.25, 3.3, 1.0, s * 1.22), T.chrome);
      add(g, box(0.5, 0.05, 0.25, 3.3, 0.7, s * 1.22), T.chrome);
      // 门缝、门把手
      add(g, box(0.02, 1.6, 0.01, 2.2, 2.1, s * 1.255), T.cabDark);
      add(g, box(0.16, 0.04, 0.03, 2.4, 2.1, s * 1.27), T.chrome);
    }
    // 空滤、排气
    add(g, cylY(0.15, 0.9, 12, 1.5, 1.3, 1.05), T.black);
    add(g, cylY(0.07, 1.6, 10, 1.45, 1.8, -1.1), T.chrome);

    // ── 车厢 ──
    const len = BED.x1 - BED.x0;
    const cx = (BED.x0 + BED.x1) / 2;
    add(g, box(len + 0.1, 0.12, BED.halfZ * 2 + 0.16, cx, BED.floorY - 0.06, 0), T.bed);
    add(g, box(len, 0.02, BED.halfZ * 2, cx, BED.floorY + 0.01, 0), T.bedIn);
    for (const s of [-1, 1]) {
      add(g, box(len + 0.1, BED.wallH, 0.08, cx, BED.floorY + BED.wallH / 2, s * (BED.halfZ + 0.04)), T.bed);
      // 厢板加强筋
      for (let i = 0; i < 6; i++) add(g, box(0.08, BED.wallH, 0.06, BED.x0 + 0.3 + i * (len - 0.6) / 5, BED.floorY + BED.wallH / 2, s * (BED.halfZ + 0.1)), T.bed);
      add(g, box(len + 0.1, 0.1, 0.12, cx, BED.floorY + BED.wallH, s * (BED.halfZ + 0.06)), T.bed);
    }
    // 前板 + 防护檐(伸到驾驶室顶上 —— 所以斗子更不能从驾驶室上方过)
    add(g, box(0.1, BED.wallH + 0.4, BED.halfZ * 2 + 0.16, BED.x1 + 0.05, BED.floorY + (BED.wallH + 0.4) / 2, 0), T.bed);
    add(g, box(0.5, 0.08, BED.halfZ * 2 + 0.16, BED.x1 + 0.3, BED.floorY + BED.wallH + 0.4, 0), T.bed);
    // 后门
    add(g, box(0.1, BED.wallH, BED.halfZ * 2 + 0.16, BED.x0 - 0.05, BED.floorY + BED.wallH / 2, 0), T.bed);
    // 举升油缸(车厢下)
    add(g, cylY(0.1, 0.5, 12, 0.7, 1.0, 0), T.chrome);
    // 尾灯、挡泥板
    for (const s of [-1, 1]) {
      add(g, box(0.05, 0.12, 0.3, BED.x0 - 0.12, 0.95, s * 0.95), T.tail);
      add(g, box(0.02, 0.5, 0.5, -2.6, 0.55, s * 1.05), T.black);
    }

    this.group.add(bake(g));

    // ── 车轮(会转)──
    this.wheels = [];
    const tire = cylZ(0.52, 0.34, 24);
    const rim = cylZ(0.3, 0.36, 16);
    for (const [x, dual] of [
      [3.1, false],
      [-1.3, true],
      [-2.65, true],
    ]) {
      for (const s of [-1, 1]) {
        const w = new THREE.Group();
        w.position.set(x, 0.52, s * (dual ? 0.92 : 1.02));
        const tm = new THREE.Mesh(tire, T.tire);
        tm.castShadow = true;
        w.add(tm);
        w.add(new THREE.Mesh(rim, T.rim));
        if (dual) {
          const t2 = new THREE.Mesh(tire, T.tire);
          t2.position.z = -s * 0.36;
          w.add(t2);
        }
        this.group.add(w);
        this.wheels.push(w);
      }
    }

    // ── 车厢里的土:小高度场 ──
    this.cells = new Float32Array((NX + 1) * (NZ + 1));
    const sg = new THREE.PlaneGeometry(len - 0.06, BED.halfZ * 2 - 0.06, NX, NZ);
    sg.rotateX(-Math.PI / 2);
    this.soilGeo = sg;
    this.soilMesh = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: 0x6e5436, roughness: 1, flatShading: true }));
    this.soilMesh.position.set(cx, BED.floorY, 0);
    this.soilMesh.castShadow = true;
    this.soilMesh.receiveShadow = true;
    this.soilMesh.visible = false;
    this.group.add(this.soilMesh);

    this.state = 'hidden';
    this.speed = 0;
    this.path = null;
    this.onEvent = null;
    this.load = 0;
    this.maxDrop = 0;
    this.group.visible = false;
    this.heading = 0;
    this._inv = new THREE.Matrix4();
  }

  // ── 行驶 ──────────────────────────────────────────────────────────────

  /** 设定装车位(车尾朝向挖掘机那一侧)。heading = 车头朝向(世界,绕 Y) */
  setSpot(x, z, heading) {
    this.spot = { x, z, heading };
  }

  _placeAt(x, z, heading) {
    this.group.position.set(x, 0, z);
    this.heading = heading;
    this.group.rotation.y = heading;
    this.group.updateMatrixWorld(true);
    this._inv.copy(this.group.matrixWorld).invert();
  }

  /** 直接停在装车位(不演进场) */
  parkAtSpot() {
    this.reset();
    const s = this.spot;
    this._placeAt(s.x, s.z, s.heading);
    this.group.visible = true;
    this.state = 'waiting';
  }

  /**
   * 装车位附近的路径点。away = 背离挖掘机的那一侧,进出场都从那边绕,免得扫到挖掘机和土堆。
   */
  _frame(avoid) {
    const s = this.spot;
    const f = new THREE.Vector2(Math.cos(s.heading), -Math.sin(s.heading));
    let side = new THREE.Vector2(-f.y, f.x);
    if (avoid) {
      const toEx = new THREE.Vector2(avoid.x - s.x, avoid.z - s.z);
      if (toEx.dot(side) > 0) side.negate();
    }
    return (a, b) => new THREE.Vector3(s.x + f.x * a + side.x * b, 0, s.z + f.y * a + side.y * b);
  }

  /** 从大门开进来,开过装车位、摆正,再倒车进位 */
  arrive(gate = { x: 49, z: 0 }, avoid = null) {
    this.reset();
    this.avoid = avoid;
    const P = this._frame(avoid);
    const pts = [
      new THREE.Vector3(gate.x + 8, 0, gate.z),
      new THREE.Vector3(gate.x - 4, 0, gate.z),
      P(24, 5),
      P(12, 5),
      P(10, 1.5),
      P(13, 0.2),
      P(15, 0),
    ];
    this.path = { curve: new THREE.CatmullRomCurve3(pts, false, 'centripetal'), t: 0, dir: 1 };
    this.revTarget = P(0, 0);
    this.group.visible = true;
    this.state = 'arriving';
    this.speed = 0;
    this._followCurve(0);
  }

  /** 开走 */
  leave(gate = { x: 49, z: 0 }) {
    if (this.state !== 'waiting') return;
    const P = this._frame(this.avoid);
    const pts = [P(0, 0), P(7, 0), P(13, 3), P(24, 5), new THREE.Vector3(gate.x - 4, 0, gate.z), new THREE.Vector3(gate.x + 10, 0, gate.z)];
    this.path = { curve: new THREE.CatmullRomCurve3(pts, false, 'centripetal'), t: 0, dir: 1 };
    this.state = 'leaving';
    this.speed = 0;
    this.emit('leaving');
  }

  emit(e, d) {
    if (this.onEvent) this.onEvent(e, d, this);
  }

  _followCurve(dt) {
    const c = this.path.curve;
    const L = c.getLength();
    this.path.t = clamp(this.path.t + (this.speed * dt) / L, 0, 1);
    const p = c.getPointAt(this.path.t);
    const tan = c.getTangentAt(this.path.t);
    this._placeAt(p.x, p.z, Math.atan2(-tan.z, tan.x));
    return this.path.t >= 1;
  }

  update(dt, terrain) {
    if (this.state === 'hidden') return;
    let v = 0;
    if (this.state === 'arriving' || this.state === 'leaving') {
      const remain = (1 - this.path.t) * this.path.curve.getLength();
      const vmax = this.state === 'leaving' ? 5 : 4;
      this.speed = Math.min(vmax, this.speed + dt * 1.8, Math.max(0.8, remain * 0.8));
      v = this.speed;
      if (this._followCurve(dt)) {
        if (this.state === 'arriving') {
          this.state = 'reversing';
          this.speed = 0;
          this.emit('reversing');
        } else {
          this.state = 'hidden';
          this.group.visible = false;
          this.emit('gone');
        }
      }
    } else if (this.state === 'reversing') {
      const p = this.group.position;
      const d = Math.hypot(p.x - this.revTarget.x, p.z - this.revTarget.z);
      this.speed = Math.min(1.6, this.speed + dt * 1.2, Math.max(0.15, d * 0.6));
      v = -this.speed;
      const s = this.spot;
      const step = Math.min(d, this.speed * dt);
      const dx = (this.revTarget.x - p.x) / Math.max(d, 1e-6);
      const dz = (this.revTarget.z - p.z) / Math.max(d, 1e-6);
      // 倒车时车头慢慢摆正到装车位朝向
      const h = lerp(this.heading, s.heading, Math.min(1, dt * 1.5));
      this._placeAt(p.x + dx * step, p.z + dz * step, h);
      if (d < 0.03) {
        this._placeAt(this.revTarget.x, this.revTarget.z, s.heading);
        this.state = 'waiting';
        this.emit('arrived');
      }
    }
    // 车轮转动 + 贴地(简单取车身中心高度)
    for (const w of this.wheels) w.rotation.z -= (v * dt) / 0.52;
    if (terrain) this.group.position.y = Math.max(0, terrain.heightAt(this.group.position.x, this.group.position.z));
    this.group.updateMatrixWorld(true);
    this._inv.copy(this.group.matrixWorld).invert();
  }

  get parked() {
    return this.state === 'waiting';
  }

  // ── 车厢里的土 ────────────────────────────────────────────────────────

  reset() {
    this.cells.fill(0);
    this.load = 0;
    this.maxDrop = 0;
    this.soilMesh.visible = false;
    this._refreshSoil();
  }

  _local(p) {
    return p.clone().applyMatrix4(this._inv);
  }

  /** 该点是否在车厢内腔正上方 */
  accepts(worldPoint) {
    if (!this.group.visible) return false;
    const p = this._local(worldPoint);
    return p.x > BED.x0 && p.x < BED.x1 && Math.abs(p.z) < BED.halfZ && p.y > BED.floorY - 0.2;
  }

  soilHeightLocal(lx, lz) {
    const fx = clamp(((lx - BED.x0) / (BED.x1 - BED.x0)) * NX, 0, NX);
    const fz = clamp(((lz + BED.halfZ) / (2 * BED.halfZ)) * NZ, 0, NZ);
    const i = Math.round(fx);
    const j = Math.round(fz);
    return this.cells[j * (NX + 1) + i];
  }

  /** 世界点正下方的"地面"高度(车厢地板 + 土) —— 给落土粒子用 */
  surfaceAt(worldPoint) {
    const p = this._local(worldPoint);
    return BED.floorY + this.soilHeightLocal(p.x, p.z) + this.group.position.y;
  }

  /**
   * 往车厢里加土。p 是落点(世界),dropH 是斗子离土面的高度。
   * 返回溢出到车外的体积(以及溢出位置),由调用方撒到地上。
   */
  addSoil(p, vol, dropH = 0) {
    const lp = this._local(p);
    this.maxDrop = Math.max(this.maxDrop, dropH);
    const cw = (BED.x1 - BED.x0) / NX;
    const cd = (2 * BED.halfZ) / NZ;
    const cellA = cw * cd;
    const R = 0.7;
    let wsum = 0;
    const idx = [];
    for (let j = 0; j <= NZ; j++) {
      for (let i = 0; i <= NX; i++) {
        const x = BED.x0 + i * cw;
        const z = -BED.halfZ + j * cd;
        const d = Math.hypot(x - lp.x, z - lp.z);
        if (d < R) {
          const w = 1 - d / R;
          idx.push([j * (NX + 1) + i, w]);
          wsum += w;
        }
      }
    }
    if (wsum <= 0) {
      const i = clamp(Math.round(((lp.x - BED.x0) / (BED.x1 - BED.x0)) * NX), 0, NX);
      const j = clamp(Math.round(((lp.z + BED.halfZ) / (2 * BED.halfZ)) * NZ), 0, NZ);
      idx.push([j * (NX + 1) + i, 1]);
      wsum = 1;
    }
    for (const [k, w] of idx) this.cells[k] += (vol * w) / wsum / cellA;
    const spilled = this._relax(cellA);
    this.load = this._volume(cellA);
    this._refreshSoil();
    this.emit('load', { vol, dropH });
    return spilled;
  }

  _volume(cellA) {
    let v = 0;
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) v += this.cells[j * (NX + 1) + i] * cellA;
    return v;
  }

  /** 休止角松弛;边缘格子高出厢板的部分溢出 */
  _relax(cellA) {
    const S = NX + 1;
    const cw = (BED.x1 - BED.x0) / NX;
    const maxDrop = 0.75 * cw;
    const out = [];
    for (let it = 0; it < 12; it++) {
      for (let j = 0; j <= NZ; j++) {
        for (let i = 0; i <= NX; i++) {
          const k = j * S + i;
          for (const [di, dj] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const ni = i + di;
            const nj = j + dj;
            if (ni < 0 || ni > NX || nj < 0 || nj > NZ) continue;
            const nk = nj * S + ni;
            const diff = this.cells[k] - this.cells[nk] - maxDrop;
            if (diff > 0) {
              this.cells[k] -= diff * 0.25;
              this.cells[nk] += diff * 0.25;
            }
          }
        }
      }
    }
    // 两侧和后门处超过厢板高度 + 一点堆尖的,撒出去
    const lim = BED.wallH + 0.15;
    for (let j = 0; j <= NZ; j++) {
      for (let i = 0; i <= NX; i++) {
        const edge = j === 0 || j === NZ || i === 0;
        if (!edge) continue;
        const k = j * S + i;
        if (this.cells[k] > lim) {
          const over = (this.cells[k] - lim) * cellA;
          this.cells[k] = lim;
          const lx = BED.x0 + i * cw + (i === 0 ? -0.5 : 0);
          const lz = -BED.halfZ + j * ((2 * BED.halfZ) / NZ) + (j === 0 ? -0.5 : j === NZ ? 0.5 : 0);
          out.push({ p: new THREE.Vector3(lx, 0, lz).applyMatrix4(this.group.matrixWorld), vol: over });
        }
      }
    }
    return out;
  }

  _refreshSoil() {
    const pos = this.soilGeo.attributes.position;
    // PlaneGeometry 顶点顺序:从 -Z 行到 +Z 行(旋转后),每行从 -X 到 +X
    for (let j = 0; j <= NZ; j++) {
      for (let i = 0; i <= NX; i++) {
        const k = j * (NX + 1) + i;
        pos.setY(k, Math.max(0.005, this.cells[k] - 0.02));
      }
    }
    pos.needsUpdate = true;
    this.soilGeo.computeVertexNormals();
    this.soilMesh.visible = this.load > 0.01;
  }

  /** 装载分布是否均匀(0~1):前后两半的体积比 */
  balance() {
    let front = 0;
    let rear = 0;
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        const v = this.cells[j * (NX + 1) + i];
        if (i < NX / 2) rear += v;
        else front += v;
      }
    }
    const t = front + rear;
    return t > 0 ? 1 - Math.abs(front - rear) / t : 1;
  }

  // ── 碰撞 ──────────────────────────────────────────────────────────────

  isOverCab(worldPoint) {
    if (!this.group.visible) return false;
    const p = this._local(worldPoint);
    return p.x > CAB.x0 - 0.3 && p.x < CAB.x1 + 0.3 && Math.abs(p.z) < CAB.halfZ + 0.3;
  }

  hit(worldPoint, part) {
    if (!this.group.visible) return null;
    const p = this._local(worldPoint);
    // 驾驶室
    if (p.x > CAB.x0 && p.x < CAB.x1 + 0.1 && Math.abs(p.z) < CAB.halfZ && p.y > CAB.y0 && p.y < CAB.y1 + 0.2) {
      this.lastHit = 'cab';
      return 'block';
    }
    // 厢板(侧板、前板、后门)
    const inX = p.x > BED.x0 - 0.12 && p.x < BED.x1 + 0.12;
    const wallTop = BED.floorY + BED.wallH + 0.06;
    if (inX && p.y > BED.floorY - 0.2 && p.y < wallTop) {
      const az = Math.abs(p.z);
      if (az > BED.halfZ - 0.02 && az < BED.halfZ + 0.16) {
        this.lastHit = 'wall';
        return 'block';
      }
      if (az < BED.halfZ + 0.1 && (Math.abs(p.x - BED.x0) < 0.1 || Math.abs(p.x - BED.x1) < 0.1)) {
        this.lastHit = 'wall';
        return 'block';
      }
    }
    // 车厢底板 / 土面
    if (p.x > BED.x0 && p.x < BED.x1 && Math.abs(p.z) < BED.halfZ) {
      if (p.y < BED.floorY + this.soilHeightLocal(p.x, p.z) - 0.05 && p.y > BED.floorY - 0.6) {
        this.lastHit = 'floor';
        return 'block';
      }
    }
    // 车架/车轮
    if (p.x > -4.4 && p.x < 4.1 && Math.abs(p.z) < 1.3 && p.y < BED.floorY - 0.1 && p.y > 0) {
      this.lastHit = 'chassis';
      return 'block';
    }
    return null;
  }
}

export { BED as TRUCK_BED };
