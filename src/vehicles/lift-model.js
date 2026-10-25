/**
 * 电动剪叉式高空作业平台(平台高度 10 m 级,吉尼 GS-3246 / 鼎力 JCPT1012 量级)。品牌"锐工 RG10S"是虚构的。
 *
 * 剪叉机构的几何(侧视,x 前 y 上):五层剪叉臂,每层是"外臂框 + 内臂框"两片交叉,中间销轴铰住。
 *   固定端都在 x0(车尾一侧),另一端在滑道里滚动,所以平台升降时不会前后窜:
 *     第 i 层:臂框 A 从 (x0, y_i) 到 (x0 + L·cosθ, y_{i+1});臂框 B 从 (x0 + L·cosθ, y_i) 到 (x0, y_{i+1})
 *   外臂框:偶数层是 A、奇数层是 B(上下层的外臂首尾相接);内臂框反过来。
 *   每片臂框 = 左右两根矩形管 + 两端横管,是一个刚体 —— 所以整个剪叉只有 10 个运动件。
 * 举升缸:三级伸缩缸,缸底在底盘前部,杆端顶在第二层内臂的中间横梁上。
 */
import * as THREE from 'three';
import { add, bake, box, rbox, cylY, cylZ, extrude, extrudePlan, shapeFrom, tube, rod, bolts, unitCylX } from '../model/geo.js';
import { decalTexture } from '../model/materials.js';
import { wheelSet, buildStandingOperator, beacon, decal, handrail } from './parts.js';

export const LIFT = {
  wheelbase: 1.85,
  track: 1.0,
  wheelR: 0.19,
  wheelW: 0.13,
  levels: 5,
  armL: 2.1,
  x0: -0.95, // 剪叉固定端
  yb: 0.62, // 底层铰点高
  thetaMin: 0.058, // 收拢
  thetaMax: 1.03, // 举到顶:平台底板 ≈ 10 m
  deckOff: 0.17, // 顶层铰点 → 平台底板上表面
  platL: 2.26,
  platW: 1.12,
  extMax: 0.9, // 延伸平台
  railH: 1.1,
  outerZ: 0.47,
  innerZ: 0.36,
};
const LF = LIFT;

/** θ → 平台底板离地高度(车身水平时) */
export function deckHeight(theta) {
  return LF.yb + LF.levels * LF.armL * Math.sin(theta) + LF.deckOff;
}
export function thetaForDeck(h) {
  return Math.asin(Math.max(0, Math.min(1, (h - LF.yb - LF.deckOff) / (LF.levels * LF.armL))));
}

function liftMaterials(M) {
  const decalMat = (tex) => new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  return {
    model: decalMat(decalTexture('RG10S', { color: '#151515' })),
    brand: decalMat(decalTexture([{ text: '锐工', font: 'bold 96px "Microsoft YaHei", sans-serif' }], { color: '#151515' })),
    rated: decalMat(decalTexture(['额定载荷 320 kg', '限乘 2 人'], { color: '#151515', w: 512, h: 160, font: 'bold 56px "Microsoft YaHei", sans-serif', bg: '#f4f4ec' })),
    noEnter: decalMat(decalTexture([{ text: '⚠ 剪叉区域 严禁进入', font: 'bold 54px "Microsoft YaHei", sans-serif' }], { color: '#151515', bg: '#f2c200' })),
    deck: new THREE.MeshStandardMaterial({ color: 0x8c9096, map: M.tread.map, roughness: 0.55, metalness: 0.7 }),
    chassis: new THREE.MeshStandardMaterial({ color: 0x2f3236, map: M.black.map, roughness: 0.6, metalness: 0.25 }),
    ledG: new THREE.MeshStandardMaterial({ color: 0x1a3d1a, emissive: 0x000000, roughness: 0.3 }),
    ledR: new THREE.MeshStandardMaterial({ color: 0x3d1a1a, emissive: 0x000000, roughness: 0.3 }),
    grey: new THREE.MeshStandardMaterial({ color: 0x75797f, roughness: 0.5, metalness: 0.3 }),
  };
}

/** 三级伸缩油缸:缸筒 + 两级套筒 + 镀铬活塞杆,长度 L 时各级平均分摊伸出量 */
class TeleCylinder {
  constructor(M) {
    this.holder = new THREE.Group();
    this.Lmin = 1.0;
    const g = new THREE.Group();
    add(g, unitCylX(0.075, 20), M.barrel).scale.x = 0.88;
    add(g, cylZ(0.06, 0.16, 16), M.steelDark);
    add(g, unitCylX(0.088, 20), M.steelDark, 0.8, 0, 0).scale.x = 0.08;
    add(g, box(0.08, 0.05, 0.06, 0.15, 0.085, 0), M.steel); // 油口
    this.holder.add(bake(g));
    this.s1 = new THREE.Mesh(unitCylX(0.06, 18), M.rod);
    this.s1.scale.x = 0.86;
    this.s2 = new THREE.Mesh(unitCylX(0.047, 16), M.rod);
    this.s2.scale.x = 0.86;
    this.rod = new THREE.Mesh(unitCylX(0.034, 14), M.rod);
    this.rod.scale.x = 0.86;
    for (const m of [this.s1, this.s2, this.rod]) {
      m.castShadow = true;
      this.holder.add(m);
    }
    this.eye = new THREE.Group();
    add(this.eye, cylZ(0.055, 0.12, 16), M.steelDark);
    this.holder.add(this.eye);
    this._d = new THREE.Vector3();
    this._x = new THREE.Vector3(1, 0, 0);
  }
  update(p0, p1) {
    this.holder.position.copy(p0);
    this._d.subVectors(p1, p0);
    const L = this._d.length();
    this.holder.quaternion.setFromUnitVectors(this._x, this._d.divideScalar(L || 1));
    const e = Math.max(0, L - this.Lmin);
    // 每级伸出 e/3,彼此叠着套在一起
    this.s1.position.x = e / 3 + 0.04;
    this.s2.position.x = (2 * e) / 3 + 0.07;
    this.rod.position.x = e + 0.1;
    this.rod.scale.x = Math.max(0.05, Math.min(0.86, L - this.rod.position.x - 0.02));
    this.eye.position.x = L;
  }
}

export class LiftModel {
  constructor(M) {
    this.M = M;
    this.D = liftMaterials(M);
    this.root = new THREE.Group();
    this._buildChassis();
    this._buildScissor();
    this._buildPlatform();
    this.theta = LF.thetaMin;
    this._beaconT = 0;
    this._v = new THREE.Vector3();
    this._w = new THREE.Vector3();
  }

  // ── 底盘 ──────────────────────────────────────────────────────────────
  _buildChassis() {
    const M = this.M;
    const D = this.D;
    const g = new THREE.Group();
    const hb = LF.wheelbase / 2;
    // 主车架:深槽形,四角让出轮罩
    const plan = [
      [-1.2, -0.42],
      [-1.2, 0.42],
      [-1.1, 0.585],
      [-hb - 0.24, 0.585],
      [-hb - 0.24, 0.44],
      [-hb + 0.24, 0.44],
      [-hb + 0.24, 0.585],
      [hb - 0.24, 0.585],
      [hb - 0.24, 0.44],
      [hb + 0.24, 0.44],
      [hb + 0.24, 0.585],
      [1.1, 0.585],
      [1.2, 0.42],
      [1.2, -0.42],
      [1.1, -0.585],
      [hb + 0.24, -0.585],
      [hb + 0.24, -0.44],
      [hb - 0.24, -0.44],
      [hb - 0.24, -0.585],
      [-hb + 0.24, -0.585],
      [-hb + 0.24, -0.44],
      [-hb - 0.24, -0.44],
      [-hb - 0.24, -0.585],
      [-1.1, -0.585],
    ];
    add(g, extrudePlan(plan, 0.12, 0.4, 0.025), M.body);
    // 顶面盖板 + 两条滑道(槽钢)
    add(g, box(2.3, 0.02, 0.8, 0, 0.53, 0), D.chassis);
    for (const s of [-1, 1]) {
      add(g, box(2.15, 0.08, 0.025, 0.08, 0.57, s * 0.42), M.steelDark);
      add(g, box(2.15, 0.012, 0.07, 0.08, 0.61, s * 0.4), M.steelDark);
      add(g, box(2.15, 0.012, 0.07, 0.08, 0.53, s * 0.4), M.steelDark);
      // 固定端铰座
      add(g, box(0.16, 0.2, 0.03, LF.x0, 0.6, s * (LF.outerZ + 0.04)), M.body);
      add(g, cylZ(0.035, 0.1, 12, LF.x0, LF.yb, s * (LF.outerZ + 0.03)), M.pin);
    }
    // 电池托盘(两侧可旋出):百叶 + 门闩
    for (const s of [-1, 1]) {
      add(g, rbox(1.0, 0.3, 0.05, 0.015), D.chassis, 0.0, 0.3, s * 0.6);
      const pl = add(g, new THREE.PlaneGeometry(0.62, 0.16), M.louver, -0.12, 0.31, s * 0.627);
      pl.rotation.y = s > 0 ? 0 : Math.PI;
      add(g, rbox(0.06, 0.06, 0.02, 0.008), M.black, 0.38, 0.32, s * 0.63);
      decal(g, D.brand, 0.32, 0.08, 0.3, 0.42, s * 0.628, s > 0 ? 0 : Math.PI);
      decal(g, D.model, 0.4, 0.1, -0.5, 0.42, s * 0.628, s > 0 ? 0 : Math.PI);
    }
    // 防坑洞保护板的铰轴(板本身单独做,要动)
    for (const s of [-1, 1]) add(g, rod([-0.5, 0.16, s * 0.6], [0.5, 0.16, s * 0.6], 0.018), M.pin);
    // 地面控制箱(右后):钥匙开关、急停、上/下按钮
    add(g, rbox(0.3, 0.22, 0.06, 0.02), M.plasticLight, -0.85, 0.32, 0.61);
    add(g, cylZ(0.03, 0.03, 16, -0.94, 0.36, 0.645), M.plasticRed);
    add(g, cylZ(0.015, 0.02, 10, -0.82, 0.37, 0.645), M.chrome);
    for (const x of [-0.78, -0.72]) add(g, box(0.035, 0.035, 0.015, x, 0.28, 0.645), M.black);
    // 前后保险杠 + 系紧/吊装孔
    for (const sx of [-1, 1]) {
      add(g, rbox(0.08, 0.12, 1.05, 0.02), M.black, sx * 1.22, 0.22, 0);
      for (const s of [-1, 1]) add(g, extrude(shapeFrom([[0, 0], [0.08, 0], [0.08, 0.12], [0, 0.12]]), 0.02, 0.004), M.steelDark, sx * 1.18 - 0.04, 0.42, s * 0.5);
    }
    // 充电插座 + 下降报警器 + 倾斜传感器盒
    add(g, rbox(0.08, 0.08, 0.04, 0.01), M.black, -1.21, 0.38, -0.3);
    add(g, cylZ(0.03, 0.03, 12), M.plasticLight, -1.24, 0.38, -0.3, 0, Math.PI / 2, 0);
    add(g, rbox(0.1, 0.06, 0.08, 0.01), M.black, 0.9, 0.56, 0.0);
    add(g, rbox(0.08, 0.05, 0.08, 0.01), M.plasticLight, -0.4, 0.56, -0.15);
    // 前桥:转向油缸 + 拉杆;后轮:行走马达
    add(g, cylZ(0.04, 0.8, 12, hb, LF.wheelR, 0), M.steelDark);
    add(g, rod([hb - 0.12, LF.wheelR + 0.04, -0.3], [hb - 0.12, LF.wheelR + 0.04, 0.3], 0.025), M.barrel);
    add(g, rod([hb - 0.12, LF.wheelR + 0.04, 0.3], [hb - 0.12, LF.wheelR + 0.04, 0.38], 0.014), M.rod);
    for (const s of [-1, 1]) add(g, cylZ(0.08, 0.1, 16, -hb, LF.wheelR, s * 0.36), M.steelDark);
    this.root.add(bake(g));

    // 举升缸缸底支座
    this.cylBase = new THREE.Vector3(1.15, 0.42, 0);

    // 防坑洞保护板(举升后放下,贴地护住底盘两侧)
    this.guards = [-1, 1].map((s) => {
      const pg = new THREE.Group();
      pg.position.set(0, 0.16, s * 0.6);
      const gg = new THREE.Group();
      add(gg, box(1.0, 0.12, 0.02, 0, -0.06, 0), M.steelDark);
      decal(gg, M.decalHazard, 0.9, 0.06, 0, -0.06, s * 0.012, s > 0 ? 0 : Math.PI);
      pg.add(bake(gg));
      this.root.add(pg);
      pg.userData.s = s;
      return pg;
    });

    // 车轮:实心不留痕轮胎;前轮能转向
    const mk = wheelSet(M, {
      R: LF.wheelR,
      W: LF.wheelW,
      rimR: 0.115,
      pattern: 'solid',
      hubR: 0.05,
      hubOut: 0,
      nuts: 5,
      style: 'lift',
      tireMat: D.grey,
      rimMat: M.body,
    });
    this.wheels = [];
    this.steerPivots = [];
    for (const [x, front] of [
      [hb, true],
      [-hb, false],
    ]) {
      for (const s of [-1, 1]) {
        const w = mk(s);
        if (front) {
          const piv = new THREE.Group();
          piv.position.set(x, LF.wheelR, s * LF.track / 2);
          piv.add(w);
          this.root.add(piv);
          this.steerPivots.push(piv);
        } else {
          w.position.set(x, LF.wheelR, s * LF.track / 2);
          this.root.add(w);
        }
        this.wheels.push(w);
      }
    }
    this.beacon = beacon(this.root, M, -1.05, 0.55, 0.45);
  }

  // ── 剪叉 ──────────────────────────────────────────────────────────────
  /** 一片臂框:左右两根矩形管 + 两端横管 + 三处销轴,沿局部 +x 从 0 到 L */
  _armFrame(z, opts = {}) {
    const M = this.M;
    const L = LF.armL;
    const g = new THREE.Group();
    for (const s of [-1, 1]) {
      add(g, rbox(L + 0.1, 0.11, 0.05, 0.02), M.body, L / 2, 0, s * z);
      // 加强板 + 三处凸台
      add(g, box(L * 0.5, 0.06, 0.012, L / 2, 0, s * (z + 0.03)), M.bodyDark);
      for (const x of [0, L / 2, L]) {
        add(g, cylZ(0.055, 0.075, 16, x, 0, s * z), M.bodyDark);
        add(g, cylZ(0.03, 0.1, 12, x, 0, s * (z + 0.02)), M.pin);
      }
    }
    // 两端横管(把左右两根连成刚体)
    for (const x of opts.tubes || [0.12, L - 0.12]) add(g, cylZ(0.035, z * 2, 12, x, 0, 0), M.steelDark);
    if (opts.centerTube) add(g, cylZ(0.05, z * 2 - 0.02, 14, L / 2, -0.07, 0), M.steelDark);
    if (opts.rollerAt != null) {
      for (const s of [-1, 1]) add(g, cylZ(0.04, 0.04, 14, opts.rollerAt, 0, s * (z + 0.05)), M.black);
    }
    if (opts.decal) decal(g, this.D.noEnter, 0.9, 0.08, L / 2, 0, (z + 0.026) * 1, 0);
    return bake(g);
  }

  _buildScissor() {
    this.frames = [];
    for (let i = 0; i < LF.levels; i++) {
      const outerA = i % 2 === 0;
      for (const which of ['outer', 'inner']) {
        const isA = which === 'outer' ? outerA : !outerA;
        const z = which === 'outer' ? LF.outerZ : LF.innerZ;
        const opts = {};
        // 滚轮:底层内臂的下端(在底盘滑道里)、顶层外臂的上端(在平台滑道里)
        if (i === 0 && which === 'inner') opts.rollerAt = 0;
        if (i === LF.levels - 1 && which === 'outer') opts.rollerAt = LF.armL;
        if (i === 1 && which === 'inner') opts.centerTube = true;
        if (which === 'outer' && i === 0) opts.decal = true;
        const piv = new THREE.Group();
        piv.add(this._armFrame(z, opts));
        this.root.add(piv);
        this.frames.push({ piv, level: i, isA, which });
      }
    }
    this.cyl = new TeleCylinder(this.M);
    this.root.add(this.cyl.holder);
    this._p0 = new THREE.Vector3();
    this._p1 = new THREE.Vector3();
  }

  // ── 平台 ──────────────────────────────────────────────────────────────
  _buildPlatform() {
    const M = this.M;
    const D = this.D;
    const plat = new THREE.Group();
    this.root.add(plat);
    const g = new THREE.Group();
    const Lp = LF.platL;
    const hw = LF.platW / 2;
    const x0 = -Lp / 2;
    const x1 = Lp / 2;
    // 平台框架(下面两条滑道 + 周边槽钢)+ 花纹钢板底板
    add(g, box(Lp, 0.12, LF.platW, 0, -0.07, 0), M.body);
    add(g, box(Lp - 0.04, 0.012, LF.platW - 0.04, 0, -0.005, 0), D.deck);
    for (const s of [-1, 1]) add(g, box(2.15, 0.06, 0.08, 0.08, -0.16, s * 0.4), M.steelDark);
    // 踢脚板(15 cm)
    for (const s of [-1, 1]) add(g, box(Lp, 0.15, 0.02, 0, 0.075, s * (hw - 0.01)), M.body);
    add(g, box(0.02, 0.15, LF.platW, x0 + 0.01, 0.075, 0), M.body);
    // 护栏:立柱 + 上横杆(1.1 m)+ 中横杆
    const H = LF.railH;
    const posts = [x0 + 0.03, x0 + 0.75, x0 + 1.45, x1 - 0.03];
    for (const s of [-1, 1]) {
      for (const x of posts) add(g, box(0.04, H, 0.04, x, H / 2, s * (hw - 0.02)), M.body);
      add(g, box(Lp, 0.045, 0.045, 0, H, s * (hw - 0.02)), M.body);
      add(g, box(Lp, 0.035, 0.035, 0, H * 0.53, s * (hw - 0.02)), M.body);
    }
    // 后栏(入口处是门)
    for (const z of [-hw + 0.02, -0.3, 0.3, hw - 0.02]) add(g, box(0.04, H, 0.04, x0 + 0.02, H / 2, z), M.body);
    for (const s of [-1, 1]) {
      add(g, box(0.045, 0.045, hw - 0.3, x0 + 0.02, H, s * ((hw + 0.3) / 2)), M.body);
      add(g, box(0.035, 0.035, hw - 0.3, x0 + 0.02, H * 0.53, s * ((hw + 0.3) / 2)), M.body);
    }
    // 吊点 / 安全带挂点
    for (const s of [-1, 1]) add(g, new THREE.TorusGeometry(0.035, 0.01, 6, 14), M.chrome).position.set(0.0, 0.14, s * (hw - 0.04));
    // 铭牌 + 警示
    decal(g, D.rated, 0.36, 0.12, 0.3, 0.075, hw + 0.002, 0);
    decal(g, M.decalHazard, 0.6, 0.06, -0.6, 0.075, hw + 0.002, 0);
    decal(g, M.decalHazard, 0.6, 0.06, -0.6, 0.075, -hw - 0.002, Math.PI);
    // 平台控制盒:挂在左侧护栏上,前倾,带手柄、使能开关、举升/行走选择、急停
    const cb = new THREE.Group();
    cb.position.set(0.15, H - 0.02, -hw + 0.2);
    add(cb, rbox(0.2, 0.12, 0.34, 0.03), M.plasticLight, 0, 0, 0);
    add(cb, rbox(0.21, 0.02, 0.35, 0.01), M.black, 0, 0.06, 0);
    add(cb, cylY(0.03, 0.03, 16, 0.02, 0.07, -0.12), M.plasticRed); // 急停
    add(cb, box(0.04, 0.012, 0.03, -0.04, 0.072, -0.03), M.black); // 选择开关
    add(cb, box(0.04, 0.012, 0.025, 0.04, 0.072, 0.0), M.chrome); // 喇叭
    for (const s2 of [-1, 1]) add(cb, rod([0, -0.04, s2 * 0.12], [-0.02, -0.12, s2 * 0.18], 0.012), M.black); // 挂钩
    g.add(cb);
    plat.add(bake(g));

    // 会动 / 会亮的件
    const leds = [];
    for (const [z, mat] of [
      [-0.05, D.ledG],
      [0.0, D.ledR],
    ]) {
      const l = new THREE.Mesh(cylY(0.008, 0.01, 8), mat);
      l.position.set(0.15 + 0.05, H + 0.055, -hw + 0.2 + z);
      plat.add(l);
      leds.push(l);
    }
    const js = new THREE.Group();
    js.position.set(0.19, H + 0.045, -hw + 0.32);
    const jsS = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.08, 8), M.chrome);
    jsS.position.y = 0.04;
    js.add(jsS);
    const jsG = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.06, 4, 10), M.plastic);
    jsG.position.y = 0.11;
    js.add(jsG);
    plat.add(js);
    this.joystick = js;

    // 入口门:两扇,弹簧自闭;开的时候往里转
    this.gates = [-1, 1].map((s) => {
      const gp = new THREE.Group();
      gp.position.set(x0 + 0.02, 0, s * 0.3);
      const gg = new THREE.Group();
      add(gg, box(0.03, 0.03, 0.29, 0, H, -s * 0.15), M.body);
      add(gg, box(0.03, 0.03, 0.29, 0, H * 0.53, -s * 0.15), M.body);
      add(gg, box(0.03, H - 0.1, 0.03, 0, H / 2 + 0.05, -s * 0.29), M.body);
      gp.add(bake(gg));
      plat.add(gp);
      gp.userData.s = s;
      return gp;
    });

    // 延伸平台:搭在主平台前半截上面,往前抽出 0~0.9 m
    const ext = new THREE.Group();
    const eg = new THREE.Group();
    const eL = 1.3;
    const ex0 = x1 - eL + 0.05;
    add(eg, box(eL, 0.05, LF.platW - 0.12, ex0 + eL / 2, 0.03, 0), M.body);
    add(eg, box(eL - 0.02, 0.01, LF.platW - 0.16, ex0 + eL / 2, 0.06, 0), D.deck);
    for (const s of [-1, 1]) {
      const z = s * (hw - 0.08);
      for (const x of [ex0 + 0.5, x1 + 0.02]) add(eg, box(0.035, H, 0.035, x, H / 2 + 0.03, z), M.body);
      add(eg, box(eL - 0.45, 0.04, 0.04, ex0 + 0.25 + eL / 2, H + 0.04, z), M.body);
      add(eg, box(eL - 0.45, 0.03, 0.03, ex0 + 0.25 + eL / 2, H * 0.53 + 0.03, z), M.body);
      add(eg, box(eL - 0.45, 0.14, 0.015, ex0 + 0.25 + eL / 2, 0.12, z), M.body);
    }
    add(eg, box(0.04, 0.04, LF.platW - 0.16, x1 + 0.02, H + 0.04, 0), M.body);
    add(eg, box(0.03, 0.03, LF.platW - 0.16, x1 + 0.02, H * 0.53 + 0.03, 0), M.body);
    add(eg, box(0.015, 0.14, LF.platW - 0.16, x1 + 0.02, 0.12, 0), M.body);
    // 推拉手柄 + 锁销踏板
    add(eg, tube([[x1 - 0.05, H - 0.1, -0.2], [x1 - 0.12, H - 0.05, -0.15], [x1 - 0.12, H - 0.05, 0.15], [x1 - 0.05, H - 0.1, 0.2]], 0.014, 16, 6), M.black);
    add(eg, box(0.1, 0.02, 0.12, x1 - 0.1, 0.075, 0.3), M.plasticRed);
    ext.add(bake(eg));
    plat.add(ext);
    this.ext = ext;

    this.operator = buildStandingOperator(M);
    this.operator.position.set(-0.25, 0.0, -0.33);
    plat.add(this.operator);
    this.eye = new THREE.Object3D();
    this.eye.position.set(-0.22, 1.68, -0.3);
    plat.add(this.eye);
    this.plat = plat;
    this.leds = leds;
  }

  // ════════════════════════════════════════════════════════════════════
  /** p: { theta, ext, steer, gate(0 关 ~ 1 开), guards(0 收 ~ 1 放) } */
  setPose(p) {
    const th = p.theta;
    this.theta = th;
    const L = LF.armL;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const Lc = L * c;
    const h = L * s;
    for (const f of this.frames) {
      const y = LF.yb + f.level * h;
      if (f.isA) {
        f.piv.position.set(LF.x0, y, 0);
        f.piv.rotation.z = th;
      } else {
        f.piv.position.set(LF.x0 + Lc, y, 0);
        f.piv.rotation.z = Math.PI - th;
      }
    }
    const yTop = LF.yb + LF.levels * h;
    this.plat.position.set(0, yTop + LF.deckOff, 0);
    this.ext.position.x = p.ext || 0;
    // 举升缸:缸底在底盘,杆端在第二层内臂中间横梁下
    this._p0.copy(this.cylBase);
    this._p1.set(LF.x0 + Lc / 2, LF.yb + 1.5 * h - 0.07, 0);
    this.cyl.update(this._p0, this._p1);
    for (const sp of this.steerPivots) sp.rotation.y = p.steer || 0;
    for (const gp of this.gates) gp.rotation.y = -gp.userData.s * (p.gate || 0) * 1.4;
    for (const pg of this.guards) pg.rotation.x = pg.userData.s * (1 - (p.guards || 0)) * 1.3;
    this.plat.updateMatrixWorld(true);
  }

  roll(front, rear) {
    for (let i = 0; i < this.wheels.length; i++) this.wheels[i].rotation.z -= (i < 2 ? front : rear) / LF.wheelR;
  }

  setControls(c) {
    this.joystick.rotation.z = -c.stick * 0.35;
    this.joystick.rotation.x = c.steer * 0.3;
  }

  updateFx(dt, s) {
    const M = this.M;
    const D = this.D;
    if (s.power && s.moving) {
      this._beaconT += dt;
      this.beacon.refl.rotation.y = this._beaconT * 7;
      const k = 0.5 + 0.5 * Math.sin(this._beaconT * 14);
      M.beacon.emissive.setRGB(k, 0.45 * k, 0);
    } else M.beacon.emissive.setRGB(s.power ? 0.15 : 0, s.power ? 0.06 : 0, 0);
    D.ledG.emissive.setRGB(0, s.power && !s.estop ? 0.9 : 0, 0);
    D.ledR.emissive.setRGB(s.alarm && Math.sin(performance.now() / 120) > 0 ? 1 : 0, 0, 0);
  }

  getEye(pos, quat) {
    this.eye.getWorldPosition(pos);
    this.plat.getWorldQuaternion(quat);
    return pos;
  }
  setOperatorVisible(v) {
    this.operator.visible = v;
  }
  exhaustWorld() {
    return null; // 电动的,没有排气
  }
  /** 平台前沿护栏顶(世界)—— 俯视相机看这里 */
  getTipWorld(t = new THREE.Vector3()) {
    t.set(LF.platL / 2 + (this.ext?.position.x || 0), 0.0, 0);
    return this.plat.localToWorld(t);
  }
}
