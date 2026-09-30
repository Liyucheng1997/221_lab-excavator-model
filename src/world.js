/**
 * 场景搭建:天空、光照、工地环境,以及各类道具(路锥、标杆、放线、警示旗、地下管线、工人)。
 *
 * 道具都实现同一个碰撞接口 hit(p, part, machine) → null | 'block' | 'knock',
 * 挂到 machine.obstacles 里就能被铲斗/配重/底盘撞到。
 */
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { add, bake, box, rbox, cylY, tube } from './model/geo.js';

export function createScene(renderer) {
  const scene = new THREE.Scene();

  // 天空:物理天空 + 由它生成的环境贴图 —— 金属件、镀铬活塞杆、玻璃全靠它有反射
  const sky = new Sky();
  sky.scale.setScalar(4000);
  const u = sky.material.uniforms;
  u.turbidity.value = 6;
  u.rayleigh.value = 1.6;
  u.mieCoefficient.value = 0.006;
  u.mieDirectionalG.value = 0.8;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(48), THREE.MathUtils.degToRad(130));
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(1000);
  Object.assign(envSky.material.uniforms, THREE.UniformsUtils.clone(sky.material.uniforms));
  envSky.material.uniforms.sunPosition.value.copy(sunDir);
  envScene.add(envSky);
  // 地面反光:环境贴图下半球给点土色,不然金属件下沿会反射出一片天蓝
  const envGround = new THREE.Mesh(
    new THREE.SphereGeometry(500, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x6e5c46, side: THREE.BackSide })
  );
  envScene.add(envGround);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.75;
  pmrem.dispose();

  scene.fog = new THREE.Fog(0xc9d6de, 90, 420);

  const hemi = new THREE.HemisphereLight(0xcfe3f2, 0x6b5a42, 0.45);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
  sun.position.copy(sunDir).multiplyScalar(60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const d = 26;
  Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 160 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);

  return { scene, sun, sunDir };
}

// ── 工地环境(静态,合并成少数几个 Mesh) ──────────────────────────────

function containerTexture(color, text) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, 512, 256);
  // 波纹板
  for (let x = 0; x < 512; x += 16) {
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(x, 0, 6, 256);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(x + 8, 0, 3, 256);
  }
  if (text) {
    g.fillStyle = '#fff';
    g.font = 'bold 44px "Microsoft YaHei", sans-serif';
    g.textAlign = 'center';
    g.fillText(text, 256, 140);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function fenceTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#e9eef2';
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#1f5fae';
  g.fillRect(0, 0, 512, 22);
  g.fillRect(0, 106, 512, 22);
  g.fillStyle = '#1f5fae';
  g.font = 'bold 40px "Microsoft YaHei", sans-serif';
  g.textAlign = 'center';
  g.fillText('安全生产  文明施工', 256, 78);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function grassTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#7d7a55';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4000; i++) {
    const v = Math.random();
    g.fillStyle = v < 0.5 ? `rgba(90,110,55,${0.3 + Math.random() * 0.4})` : `rgba(140,125,90,${0.2 + Math.random() * 0.3})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1 + Math.random() * 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(300, 300);
  return t;
}

export function buildSite(scene, M, terrainSize) {
  const g = new THREE.Group();
  const half = terrainSize / 2;

  // 场外的地面(比可挖区大得多)
  const outer = new THREE.Mesh(
    new THREE.RingGeometry(half * 0.98, 1500, 64, 1),
    new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 })
  );
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.02;
  outer.receiveShadow = true;
  scene.add(outer);
  // 可挖区四角外补一圈(环的内圆和方形场地之间)
  const cornerMat = new THREE.MeshStandardMaterial({ color: 0x8c7a5e, roughness: 1 });
  const corner = new THREE.Mesh(new THREE.PlaneGeometry(terrainSize * 1.5, terrainSize * 1.5), cornerMat);
  corner.rotation.x = -Math.PI / 2;
  corner.position.y = -0.06;
  scene.add(corner);

  // 围挡:蓝白彩钢板,绕场一圈
  const fenceMat = new THREE.MeshStandardMaterial({ map: fenceTexture(), roughness: 0.6, metalness: 0.2 });
  const fr = half - 3;
  const panel = 4;
  for (const [ax, az, len, rot] of [
    [0, -fr, fr * 2, 0],
    [0, fr, fr * 2, Math.PI],
    [-fr, 0, fr * 2, Math.PI / 2],
    [fr, 0, fr * 2, -Math.PI / 2],
  ]) {
    const n = Math.floor(len / panel);
    for (let i = 0; i < n; i++) {
      const t = -len / 2 + (i + 0.5) * panel;
      // 留一个大门(+X 侧)给自卸车进出
      if (rot === -Math.PI / 2 && Math.abs(t) < 5) continue;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(panel - 0.05, 2.2), fenceMat);
      const x = ax + (rot === 0 || rot === Math.PI ? t : 0);
      const z = az + (rot === 0 || rot === Math.PI ? 0 : t);
      m.position.set(x, 1.1, z);
      m.rotation.y = rot;
      m.material.side = THREE.DoubleSide;
      g.add(m);
      add(g, box(0.08, 2.4, 0.08, x + (rot === 0 || rot === Math.PI ? panel / 2 : 0), 1.2, z + (rot === 0 || rot === Math.PI ? 0 : panel / 2)), M.steel);
    }
  }

  // 板房(项目部)×3,彩钢集装箱
  const blue = new THREE.MeshStandardMaterial({ map: containerTexture('#2f6db3', ''), roughness: 0.55, metalness: 0.3 });
  const white = new THREE.MeshStandardMaterial({ map: containerTexture('#dfe4e8', '项目部'), roughness: 0.55, metalness: 0.2 });
  for (let i = 0; i < 3; i++) {
    const x = -half + 14;
    const z = -half + 8 + i * 3.2;
    const m = add(g, box(6, 2.7, 2.6), i === 1 ? white : blue, x, 1.35, z);
    m.castShadow = true;
    add(g, box(6.1, 0.1, 2.7, x, 2.75, z), M.steel);
    for (let w = -1; w <= 1; w += 2) add(g, box(1.1, 0.8, 0.04, x + w * 1.6, 1.6, z + 1.31), M.glassDark);
  }
  // 材料堆:钢管、砂石、水泥管
  for (let i = 0; i < 12; i++) {
    const row = Math.floor(i / 5);
    const col = i % 5;
    const p = add(g, cylY(0.12, 6, 12), M.pipe, 0, 0, 0);
    p.rotation.z = Math.PI / 2;
    p.position.set(half - 16 + 3, 0.12 + row * 0.22, -half + 10 + col * 0.25 + row * 0.12);
  }
  const concrete = new THREE.MeshStandardMaterial({ color: 0xa8a39a, roughness: 0.9 });
  for (let i = 0; i < 4; i++) {
    const m = add(g, new THREE.CylinderGeometry(0.6, 0.6, 2, 20, 1, true), concrete, 0, 0, 0);
    m.material.side = THREE.DoubleSide;
    m.rotation.x = Math.PI / 2;
    m.position.set(-half + 12 + i * 1.3, 0.6, half - 12);
  }
  const gravel = new THREE.MeshStandardMaterial({ color: 0x8f8a82, roughness: 1, flatShading: true });
  const pile = new THREE.ConeGeometry(4, 2.2, 18, 3);
  const pp = pile.attributes.position;
  for (let i = 0; i < pp.count; i++) {
    const y = pp.getY(i);
    if (y < 1.05) pp.setXYZ(i, pp.getX(i) * (0.9 + Math.random() * 0.2), y, pp.getZ(i) * (0.9 + Math.random() * 0.2));
  }
  pile.computeVertexNormals();
  add(g, pile, gravel, half - 12, 1.1, half - 12);

  // 树:场外一圈
  const trunk = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1 });
  const leaf = new THREE.MeshStandardMaterial({ color: 0x4d6b35, roughness: 1, flatShading: true });
  const rnd = mulberry(7);
  for (let i = 0; i < 90; i++) {
    const a = rnd() * Math.PI * 2;
    const r = half + 8 + rnd() * 60;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const s = 0.7 + rnd() * 0.9;
    add(g, cylY(0.18 * s, 2.4 * s, 6, x, 0, z), trunk);
    const crown = new THREE.IcosahedronGeometry(1.8 * s, 0);
    add(g, crown, leaf, x, 3.4 * s, z);
  }
  // 远山
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x7c8a78, roughness: 1, flatShading: true });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rnd() * 0.2;
    const r = 520 + rnd() * 200;
    const h = new THREE.ConeGeometry(120 + rnd() * 80, 60 + rnd() * 70, 7);
    add(g, h, hillMat, Math.cos(a) * r, 25, Math.sin(a) * r).castShadow = false;
  }
  // 照明灯塔
  for (const [x, z] of [
    [-half + 6, half - 6],
    [half - 6, -half + 6],
  ]) {
    add(g, cylY(0.12, 9, 8, x, 0, z), M.steel);
    add(g, box(1.4, 0.5, 0.3, x, 9.2, z), M.black);
  }

  const baked = bake(g);
  baked.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  scene.add(baked);
  return baked;
}

function mulberry(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 道具 ───────────────────────────────────────────────────────────────

const coneMat = new THREE.MeshStandardMaterial({ color: 0xff5a1f, roughness: 0.7 });
const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.9 });

/** 可被撞倒的东西的基类:被撞后播放倒地动画 */
class Knockable {
  constructor(group, radius, height) {
    this.group = group;
    this.radius = radius;
    this.height = height;
    this.down = false;
    this.fall = 0;
    this.fallDir = new THREE.Vector3(1, 0, 0);
    this.name = '标志物';
  }
  hit(p, part, machine) {
    if (this.down) return null;
    const dx = p.x - this.group.position.x;
    const dz = p.z - this.group.position.z;
    const y = p.y - this.group.position.y;
    if (dx * dx + dz * dz < this.radius * this.radius && y > -0.3 && y < this.height) {
      this.down = true;
      this.fallDir.set(-dx, 0, -dz).normalize();
      if (!Number.isFinite(this.fallDir.x)) this.fallDir.set(1, 0, 0);
      return 'knock';
    }
    return null;
  }
  update(dt) {
    if (this.down && this.fall < 1) {
      this.fall = Math.min(1, this.fall + dt * 3);
      const axis = new THREE.Vector3(this.fallDir.z, 0, -this.fallDir.x);
      this.group.quaternion.setFromAxisAngle(axis, -this.fall * Math.PI * 0.48);
    }
  }
  reset() {
    this.down = false;
    this.fall = 0;
    this.group.quaternion.identity();
  }
}

export class Cone extends Knockable {
  constructor() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.7, 16), coneMat);
    body.position.y = 0.37;
    body.castShadow = true;
    g.add(body);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.14, 0.12, 16), whiteMat);
    band.position.y = 0.42;
    g.add(band);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.04, 0.44), darkMat);
    base.position.y = 0.02;
    g.add(base);
    super(g, 0.35, 0.8);
    this.name = '路锥';
  }
}

/** 考试用的标杆:杆顶放一个球,斗齿要"碰到球"而不能把杆撞倒 */
export class BallPole extends Knockable {
  constructor(height = 1.6) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, height, 10), new THREE.MeshStandardMaterial({ color: 0xd9281f, roughness: 0.5 }));
    pole.position.y = height / 2;
    pole.castShadow = true;
    g.add(pole);
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, height / 8, 10), whiteMat);
      s.position.y = (height / 4) * i + height / 8;
      g.add(s);
    }
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.1, 16), darkMat);
    base.position.y = 0.05;
    g.add(base);
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xffd21a, roughness: 0.35, emissive: 0x000000 });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 18, 12), ballMat);
    ball.position.y = height + 0.1;
    ball.castShadow = true;
    g.add(ball);
    super(g, 0.2, height);
    this.ball = ball;
    this.ballMat = ballMat;
    this.touched = false;
    this.poleHeight = height;
    this.name = '标杆';
  }
  /** 斗齿碰到球(球顶附近 0.25 m 内)算"点到";碰到杆身算撞杆 */
  hit(p, part, machine) {
    if (this.down) return null;
    const bp = this.ball.getWorldPosition(new THREE.Vector3());
    if (!this.touched && p.distanceTo(bp) < 0.28) {
      this.touched = true;
      this.ballMat.color.set(0x35d66b);
      this.ballMat.emissive.set(0x0b4d1f);
      return null;
    }
    const dx = p.x - this.group.position.x;
    const dz = p.z - this.group.position.z;
    const y = p.y - this.group.position.y;
    if (dx * dx + dz * dz < 0.18 * 0.18 && y > 0 && y < this.poleHeight - 0.05) {
      this.down = true;
      this.fallDir.set(-dx, 0, -dz).normalize();
      if (!Number.isFinite(this.fallDir.x)) this.fallDir.set(1, 0, 0);
      return 'knock';
    }
    return null;
  }
  reset() {
    super.reset();
    this.touched = false;
    this.ballMat.color.set(0xffd21a);
    this.ballMat.emissive.set(0x000000);
  }
}

/** 地面目标圈 */
export function makeMarker(color, radius = 1.2, beam = true) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.84, radius, 48),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 2;
  g.add(ring);
  if (beam) {
    const b = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.08, radius * 0.08, 5, 10, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
    );
    b.position.y = 2.5;
    g.add(b);
  }
  g.userData.setColor = (c) => g.traverse((o) => o.material && o.material.color.set(c));
  return g;
}

/** 放线:两排木桩 + 白灰线(沿任意方向) */
export function makeLayout(terrain, cx, cz, halfL, halfW, rot = 0, color = 0xf4f4f4) {
  const g = new THREE.Group();
  const stakeMat = new THREE.MeshStandardMaterial({ color: 0xc89b5c, roughness: 0.9 });
  const flagMat = new THREE.MeshStandardMaterial({ color: 0xff3b2f, roughness: 0.6, side: THREE.DoubleSide });
  const lineMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false });
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const toW = (u, v) => [cx + u * c + v * s, cz - u * s + v * c];
  for (const sv of [-1, 1]) {
    for (let i = 0; i <= 4; i++) {
      const u = -halfL + (2 * halfL * i) / 4;
      const [x, z] = toW(u, sv * (halfW + 0.35));
      const y = terrain.heightAt(x, z);
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 0.05), stakeMat);
      st.position.set(x, y + 0.4, z);
      st.castShadow = true;
      g.add(st);
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.1), flagMat);
      f.position.set(x + 0.08, y + 0.8, z);
      g.add(f);
    }
    // 地面白灰线:贴地的一串小段
    const N = Math.ceil(halfL * 4);
    for (let i = 0; i < N; i++) {
      const u0 = -halfL + (2 * halfL * i) / N;
      const u1 = -halfL + (2 * halfL * (i + 1)) / N;
      const [x0, z0] = toW(u0, sv * halfW);
      const [x1, z1] = toW(u1, sv * halfW);
      const seg = new THREE.Mesh(new THREE.PlaneGeometry(Math.hypot(x1 - x0, z1 - z0), 0.08), lineMat);
      seg.rotation.x = -Math.PI / 2;
      seg.rotation.z = Math.atan2(-(z1 - z0), x1 - x0);
      seg.position.set((x0 + x1) / 2, terrain.heightAt((x0 + x1) / 2, (z0 + z1) / 2) + 0.03, (z0 + z1) / 2);
      g.add(seg);
    }
  }
  return g;
}

/** 平整区域的高程桩:四角 + 中间,桩顶的红色刻度就是设计标高 */
export function makeGradeStakes(cx, cz, half, y, terrain) {
  const g = new THREE.Group();
  const stakeMat = new THREE.MeshStandardMaterial({ color: 0xd8b27a, roughness: 0.9 });
  const markMat = new THREE.MeshStandardMaterial({ color: 0xe0231b, roughness: 0.5 });
  for (const [dx, dz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ]) {
    const x = cx + dx * (half + 0.4);
    const z = cz + dz * (half + 0.4);
    const gy = terrain.heightAt(x, z);
    const top = Math.max(gy + 0.5, y + 0.3);
    const h = top - (gy - 0.2);
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.06, h, 0.06), stakeMat);
    st.position.set(x, gy - 0.2 + h / 2, z);
    st.castShadow = true;
    g.add(st);
    const mk = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.08), markMat);
    mk.position.set(x, y, z);
    g.add(mk);
  }
  // 设计标高面(半透明)
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(half * 2, half * 2),
    new THREE.MeshBasicMaterial({ color: 0x44ffcc, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide })
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(cx, y + 0.005, cz);
  plane.renderOrder = 3;
  g.add(plane);
  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(half * 2, half * 2)),
    new THREE.LineBasicMaterial({ color: 0x44ffcc })
  );
  edge.rotation.x = -Math.PI / 2;
  edge.position.set(cx, y + 0.01, cz);
  g.add(edge);
  return g;
}

/** 地下燃气管 + 地面警示桩。管子埋在土里,挖开了才看得见。 */
export class BuriedPipe {
  constructor(terrain, x0, z0, x1, z1, depth) {
    this.a = new THREE.Vector3(x0, 0, z0);
    this.b = new THREE.Vector3(x1, 0, z1);
    this.depth = depth;
    this.group = new THREE.Group();
    const len = Math.hypot(x1 - x0, z1 - z0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xf2c21b, roughness: 0.5 });
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, len, 14), mat);
    pipe.rotation.z = Math.PI / 2;
    const holder = new THREE.Group();
    holder.add(pipe);
    holder.position.set((x0 + x1) / 2, terrain.heightAt((x0 + x1) / 2, (z0 + z1) / 2) - depth, (z0 + z1) / 2);
    holder.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    this.group.add(holder);
    this.y = holder.position.y;
    // 地面警示桩
    const postMat = new THREE.MeshStandardMaterial({ color: 0xf2c21b, roughness: 0.6 });
    const signTex = (() => {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = '#f2c21b';
      g.fillRect(0, 0, 256, 128);
      g.fillStyle = '#c21';
      g.font = 'bold 40px "Microsoft YaHei", sans-serif';
      g.textAlign = 'center';
      g.fillText('地下燃气管道', 128, 52);
      g.fillStyle = '#111';
      g.font = 'bold 26px "Microsoft YaHei", sans-serif';
      g.fillText('严禁机械开挖', 128, 100);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    // 地面上的黄色喷漆线:物探定位出的管线走向
    const paint = new THREE.MeshBasicMaterial({ color: 0xffd21a, transparent: true, opacity: 0.9, depthWrite: false });
    for (let i = 0; i < 24; i += 2) {
      const t0 = i / 24;
      const t1 = (i + 1) / 24;
      const ax = x0 + (x1 - x0) * t0;
      const az = z0 + (z1 - z0) * t0;
      const bx = x0 + (x1 - x0) * t1;
      const bz = z0 + (z1 - z0) * t1;
      const seg = new THREE.Mesh(new THREE.PlaneGeometry(Math.hypot(bx - ax, bz - az), 0.1), paint);
      seg.rotation.x = -Math.PI / 2;
      seg.rotation.z = Math.atan2(-(bz - az), bx - ax);
      seg.position.set((ax + bx) / 2, terrain.heightAt((ax + bx) / 2, (az + bz) / 2) + 0.03, (az + bz) / 2);
      this.group.add(seg);
    }
    for (const t of [-0.16, 0.16]) {
      const x = (x0 + x1) / 2 + ((x1 - x0) * t);
      const z = (z0 + z1) / 2 + ((z1 - z0) * t);
      const gy = terrain.heightAt(x, z);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 8), postMat);
      post.position.set(x, gy + 0.6, z);
      this.group.add(post);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.3), new THREE.MeshStandardMaterial({ map: signTex, side: THREE.DoubleSide }));
      sign.position.set(x, gy + 1.05, z);
      sign.rotation.y = holder.rotation.y + Math.PI / 2;
      this.group.add(sign);
    }
    this.struck = false;
  }
  /** 点到管轴线的距离 */
  distance(p) {
    const ab = this.b.clone().sub(this.a);
    const ap = new THREE.Vector3(p.x - this.a.x, 0, p.z - this.a.z);
    const t = Math.max(0, Math.min(1, ap.dot(ab) / ab.lengthSq()));
    const q = this.a.clone().addScaledVector(ab, t);
    const dh = Math.hypot(p.x - q.x, p.z - q.z);
    const dv = p.y - this.y;
    return Math.hypot(dh, dv);
  }
  hit(p) {
    if (this.struck) return null;
    if (this.distance(p) < 0.2) {
      this.struck = true;
      return 'block';
    }
    return null;
  }
}

/** 地面工人:沿路径来回走。进了回转半径必须停机。 */
export class Worker {
  constructor(path, speed = 1.1) {
    this.path = path.map(([x, z]) => new THREE.Vector3(x, 0, z));
    this.speed = speed;
    this.s = 0;
    this.dir = 1;
    this.group = new THREE.Group();
    const vest = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.7 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x2c3a52, roughness: 0.9 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc89878, roughness: 0.8 });
    const helmet = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    this.legs = [];
    for (const s of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(0, 0.9, s * 0.1);
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.72, 4, 8), cloth);
      m.position.y = -0.45;
      m.castShadow = true;
      leg.add(m);
      this.group.add(leg);
      this.legs.push(leg);
    }
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.42, 4, 10), vest);
    torso.position.y = 1.2;
    torso.castShadow = true;
    this.group.add(torso);
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.5, 4, 8), cloth);
      arm.position.set(0, 1.18, s * 0.24);
      this.group.add(arm);
    }
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), skin);
    head.position.y = 1.63;
    this.group.add(head);
    const hat = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), helmet);
    hat.position.y = 1.66;
    this.group.add(hat);
    this.phase = 0;
    this.paused = 0;
    this.name = '地面人员';
    this.active = true;
  }
  get position() {
    return this.group.position;
  }
  update(dt, terrain) {
    if (!this.active) return;
    const P = this.path;
    if (this.paused > 0) {
      this.paused -= dt;
    } else {
      const seg = Math.floor(this.s);
      const a = P[Math.min(seg, P.length - 1)];
      const b = P[Math.min(seg + 1, P.length - 1)];
      const L = Math.max(0.01, a.distanceTo(b));
      this.s += (this.dir * this.speed * dt) / L;
      if (this.s >= P.length - 1) {
        this.s = P.length - 1 - 1e-3;
        this.dir = -1;
        this.paused = 3;
      } else if (this.s <= 0) {
        this.s = 0;
        this.dir = 1;
        this.paused = 3;
      }
      this.phase += dt * this.speed * 5;
    }
    const seg = Math.min(Math.floor(this.s), P.length - 2);
    const t = this.s - seg;
    const p = P[seg].clone().lerp(P[seg + 1], t);
    p.y = terrain.heightAt(p.x, p.z);
    this.group.position.copy(p);
    const d = P[seg + 1].clone().sub(P[seg]).multiplyScalar(this.dir);
    this.group.rotation.y = Math.atan2(-d.z, d.x);
    const swing = this.paused > 0 ? 0 : Math.sin(this.phase) * 0.5;
    this.legs[0].rotation.z = swing;
    this.legs[1].rotation.z = -swing;
  }
  hit(p) {
    if (!this.active) return null;
    const q = this.group.position;
    if (Math.hypot(p.x - q.x, p.z - q.z) < 0.45 && p.y - q.y < 1.9) return 'block';
    return null;
  }
}
