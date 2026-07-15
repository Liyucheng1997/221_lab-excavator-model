/**
 * 场景搭建:天空、光照、自卸车、各类标志物。
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { UPPER } from './config.js';

export function createScene(mats, renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fc4dd);
  scene.fog = new THREE.Fog(0x9fc4dd, 60, 190);

  // 环境贴图。这个不是可选项:金属度高的材质靠反射环境才有颜色,
  // 没有 environment 的话镀铬活塞杆、斗齿、履带全都会渲染成一团黑。
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();

  // 半球光给天光和地面反射光,方向光当太阳并投影
  const hemi = new THREE.HemisphereLight(0xbcd8ee, 0x6b5a42, 0.5);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2dc, 1.7);
  sun.position.set(28, 40, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const d = 22;
  sun.shadow.camera.left = -d;
  sun.shadow.camera.right = d;
  sun.shadow.camera.top = d;
  sun.shadow.camera.bottom = -d;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 110;
  sun.shadow.bias = -0.0012;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(sun.target);

  return { scene, sun };
}

/** 自卸车:装车任务的目标。车斗是个有明确边界的容器,土进去会堆起来。 */
export class DumpTruck {
  constructor(mats) {
    this.group = new THREE.Group();
    this.capacity = 6.0; // m³
    this.load = 0;

    const M = mats;
    const cabMat = new THREE.MeshStandardMaterial({ color: 0x2f6fb5, roughness: 0.5, metalness: 0.3 });
    const bedMat = new THREE.MeshStandardMaterial({ color: 0x35393f, roughness: 0.75, metalness: 0.5 });

    // 车架
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.3, 2.5), M.steelDark);
    chassis.position.y = 1.0;
    chassis.castShadow = true;
    this.group.add(chassis);

    // 驾驶室(车头朝 +X)
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.5, 2.4), cabMat);
    cab.position.set(2.6, 1.95, 0);
    cab.castShadow = true;
    this.group.add(cab);
    const wind = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, 2.1), M.glass);
    wind.position.set(3.44, 2.25, 0);
    this.group.add(wind);

    // 车斗:底 + 四壁。内腔尺寸就是判"土有没有进车"的依据。
    this.bed = { x: -1.1, z: 0, halfX: 2.3, halfZ: 1.15, floorY: 1.2, topY: 2.5 };
    const B = this.bed;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(B.halfX * 2, 0.14, B.halfZ * 2), bedMat);
    floor.position.set(B.x, B.floorY, B.z);
    floor.receiveShadow = true;
    this.group.add(floor);
    const wallH = B.topY - B.floorY;
    for (const [dx, dz, sx, sz] of [
      [B.halfX, 0, 0.12, B.halfZ * 2],
      [-B.halfX, 0, 0.12, B.halfZ * 2],
      [0, B.halfZ, B.halfX * 2, 0.12],
      [0, -B.halfZ, B.halfX * 2, 0.12],
    ]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(sx, wallH, sz), bedMat);
      w.position.set(B.x + dx, B.floorY + wallH / 2, B.z + dz);
      w.castShadow = true;
      this.group.add(w);
    }

    // 车斗里的土,随装载量长高
    this.soil = new THREE.Mesh(
      new THREE.BoxGeometry(B.halfX * 1.9, 1, B.halfZ * 1.9),
      M.soil
    );
    this.soil.position.set(B.x, B.floorY, B.z);
    this.soil.visible = false;
    this.group.add(this.soil);

    // 轮子
    const wheelGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.42, 18);
    wheelGeo.rotateX(Math.PI / 2);
    for (const x of [2.5, -1.4, -2.5]) {
      for (const z of [-1.25, 1.25]) {
        const w = new THREE.Mesh(wheelGeo, M.rubber);
        w.position.set(x, 0.62, z);
        w.castShadow = true;
        this.group.add(w);
      }
    }
  }

  setPosition(x, z, rotY) {
    this.group.position.set(x, 0, z);
    this.group.rotation.y = rotY;
  }

  /** 世界坐标点是否落在车斗内腔上方 */
  accepts(worldPoint) {
    const p = this.group.worldToLocal(worldPoint.clone());
    const B = this.bed;
    return (
      Math.abs(p.x - B.x) < B.halfX &&
      Math.abs(p.z - B.z) < B.halfZ &&
      p.y > B.floorY &&
      p.y < B.floorY + 6
    );
  }

  add(volume) {
    this.load = Math.min(this.capacity, this.load + volume);
    const B = this.bed;
    const h = (this.load / this.capacity) * (B.topY - B.floorY + 0.45);
    this.soil.visible = h > 0.02;
    this.soil.scale.y = Math.max(0.02, h);
    this.soil.position.y = B.floorY + h / 2 + 0.07;
  }

  reset() {
    this.load = 0;
    this.soil.visible = false;
  }
}

/** 地面上的目标圈 */
export function makeMarker(color, radius = 1.2) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.82, radius, 40),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
  );
  ring.rotation.x = -Math.PI / 2;
  g.add(ring);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.12, radius * 0.12, 6, 10, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: THREE.DoubleSide })
  );
  beam.position.y = 3;
  g.add(beam);
  return g;
}

/** 沟槽放线:两排边桩 + 拉的线 */
export function makeTrenchGuide(cx, cz, halfX, halfZ, color = 0xffdd33) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color });
  const lineMat = new THREE.LineBasicMaterial({ color });
  const stakeGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.1, 6);
  const pts = [];
  for (const sz of [-1, 1]) {
    for (let i = 0; i <= 6; i++) {
      const x = cx - halfX + (2 * halfX * i) / 6;
      const z = cz + sz * halfZ;
      const s = new THREE.Mesh(stakeGeo, mat);
      s.position.set(x, 0.55, z);
      g.add(s);
    }
    pts.push(
      new THREE.Vector3(cx - halfX, 1.05, cz + sz * halfZ),
      new THREE.Vector3(cx + halfX, 1.05, cz + sz * halfZ)
    );
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  g.add(new THREE.LineSegments(geo, lineMat));
  return g;
}

/** 路锥 */
export function makeCone() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.ConeGeometry(0.26, 0.72, 14),
    new THREE.MeshStandardMaterial({ color: 0xff5a1f, roughness: 0.8 })
  );
  body.position.y = 0.36;
  body.castShadow = true;
  g.add(body);
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.05, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.9 })
  );
  base.position.y = 0.025;
  g.add(base);
  return g;
}
