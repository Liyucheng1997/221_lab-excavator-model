/**
 * 整机尺寸与调校参数 —— 以 20 吨级液压反铲(CAT 320 / 小松 PC200-8 量级)为原型。
 *
 * 坐标约定(贯穿全工程):
 *   工作平面是二维的 (x, y):x = 车头朝向(前),y = 向上。
 *   Three.js 里整机朝 +X,回转绕 Y 轴,动臂/斗杆/铲斗各关节绕 Z 轴转。
 *   按右手系 右 = 前 × 上 = +Z,所以驾驶室(在左侧)的 z 是负的。
 *   回转平台局部系的原点在"回转中心正下方的地面",所以 y 就是离地高度。
 *
 * 每个关节的角度都是相对上一节的,单位弧度,逆时针为正(即"抬起"为正)。
 *
 * 工作装置几何由 tools/linkage-check.mjs 复核:
 *   地面最大挖掘半径 ≈ 10.1 m   最大挖掘深度 ≈ 6.4 m   最大卸载高度 ≈ 7.0 m
 *   动臂缸行程比 0.76、斗杆缸 0.76、铲斗缸 0.62,全程单调无死点
 */

export const DEG = Math.PI / 180;

// ── 行走装置 ────────────────────────────────────────────────────────────
// 驱动轮在后(-X)、引导轮在前(+X)。"前进"定义为朝引导轮方向走 —— 真机也是这么定义的,
// 所以上车转过 180° 之后,推行走杆的方向就和你眼里的"前"反了。
export const UNDERCARRIAGE = {
  gauge: 2.2, // 两条履带中心距
  shoeWidth: 0.6, // 履带板宽
  pitch: 0.19, // 履带节距
  tumbler: 3.46, // 驱动轮—引导轮中心距
  sprocket: { x: -1.73, y: 0.56, r: 0.37, teeth: 21 },
  idler: { x: 1.73, y: 0.53, r: 0.35 },
  lowerRollers: 7, // 支重轮
  lowerRollerSpan: 2.62, // 前后两个支重轮中心距
  rollerY: 0.27,
  rollerR: 0.135, // 到链节中心线的半径
  carrierRollers: [0.62, -0.62], // 托链轮 x
  carrierY: 0.82,
  carrierR: 0.1,
  linkOffset: 0.135, // 链节中心线离地(= 履带板接地面到链节销中心)
  trackOverallLength: 4.45,
  swingBearingY: 1.0,
};

// ── 上部回转体 ──────────────────────────────────────────────────────────
export const UPPER = {
  bottomY: 1.06, // 回转平台底面
  deckY: 1.24, // 平台上表面(驾驶室地板)
  width: 2.71,
  tailRadius: 2.75, // 尾部回转半径(配重外缘)
  noseX: 1.62, // 平台前缘
  hoodTopY: 2.36,
  cwBottomY: 1.09, // 配重离地间隙 1.09 m
  cab: {
    x: 0.44, // 驾驶室中心
    z: -0.87,
    length: 1.8,
    width: 0.98,
    height: 1.78, // 驾驶室顶离地 ≈ 3.02 m
  },
};

// ── 工作装置:动臂 ──────────────────────────────────────────────────────
// 动臂局部系:根铰点在原点,弯折的"香蕉"形,臂端铰点在 tip。
export const BOOM = {
  foot: [0.6, 2.05], // 动臂根铰点(回转台局部系)
  knee: [2.95, 1.15], // 弯折处(局部系)
  tip: [5.7, 0.0], // 斗杆铰点(局部系)—— 动臂长 5.7 m
  halfHeightRoot: 0.3,
  halfHeightKnee: 0.42,
  halfHeightTip: 0.25,
  width: 0.56,
  noseWidth: 0.44, // 臂头收窄,好让斗杆根部的叉板夹住它
  angleMin: -45 * DEG, // 动臂放到底
  angleMax: 59 * DEG, // 动臂抬到顶
  // 动臂油缸(两根,夹在动臂两侧):缸底铰在回转平台前端,活塞杆铰在动臂下缘
  cyl: {
    base: [1.4, 1.16], // 回转台局部系
    rod: [3.5, 0.49], // 动臂局部系
    barrelR: 0.11,
    rodR: 0.065,
    pairZ: 0.42,
  },
};

// ── 工作装置:斗杆 ──────────────────────────────────────────────────────
// 斗杆局部系:根铰点在原点,沿 +X 伸向铲斗铰点。
export const ARM = {
  tip: [2.9, 0.0], // 铲斗铰点(局部系)—— 斗杆长 2.9 m
  width: 0.44,
  angleMin: -158 * DEG, // 斗杆完全收回
  angleMax: -26 * DEG, // 斗杆完全伸出
  // 斗杆油缸:缸底铰在动臂上缘,活塞杆铰在斗杆后上方的凸耳
  cyl: {
    base: [2.932, 1.643], // 动臂局部系
    rod: [-0.868, 0.454], // 斗杆局部系
    barrelR: 0.125,
    rodR: 0.075,
    pairZ: 0,
  },
};

// ── 工作装置:铲斗 + 四连杆 ─────────────────────────────────────────────
// 真机的铲斗不是油缸直推的,而是经过"摇臂(power link)+ 连杆(idler link)"的四连杆机构放大转角。
// 机构四个铰点:
//   Ph  摇臂在斗杆上的铰点  (斗杆局部系)
//   P2  铲斗铰点            (= ARM.tip)
//   H   三者汇合的浮动铰点  (油缸杆端 + 摇臂 + 连杆)
//   Pb  连杆在铲斗上的铰点  (铲斗局部系)
// 斗体外形在"设计系"里画。设计系 = 斗子的"中位姿态":斗杆竖直向下时,斗齿朝正下方,
//   x 朝外(背离机身)、y 朝上;铰点在原点。此时斗口朝向机身(-x),背板背向机身(+x),
//   连杆耳在铰点的背板一侧。
// 这个朝向关系不能画反:真实反铲斗的斗口在"斗齿指向"的顺时针一侧 —— 收斗到底、斗齿指向机身时,
//   斗口朝天,土才兜得住。画成镜像的话,满收斗时斗口朝地,一提土就撒光。
// 设计系整体转 bodyRot 得到"铲斗局部系"(连杆耳必须在局部系 (0, 0.376),由四连杆标定锁死)。
const BUCKET_DESIGN = {
  // 侧面外轮廓:顶板前缘 → 顶板 → 背板 → 斗跟 → 斗底 → 刃口
  outer: [
    [-0.34, -0.1],
    [0.3, -0.1],
    [0.44, -0.16],
    [0.5, -0.35],
    [0.52, -0.55],
    [0.49, -0.75],
    [0.4, -0.92],
    [0.28, -1.08],
    [0.17, -1.24],
    [0.1, -1.36],
  ],
  // 内轮廓(回程),与外轮廓构成钢板厚度
  inner: [
    [0.07, -1.32],
    [0.13, -1.21],
    [0.24, -1.06],
    [0.35, -0.9],
    [0.44, -0.74],
    [0.47, -0.55],
    [0.45, -0.37],
    [0.4, -0.21],
    [0.29, -0.13],
    [-0.34, -0.13],
  ],
  tip: [0.01, -1.54], // 斗齿尖
  edge: [0.1, -1.36], // 刃口(齿座焊在这)
  lugDir: 10 * DEG, // 连杆耳在耳板上的方位角(自铰点量起)—— 在背板一侧、略高于铰点
  lugR: 0.376, // …到铰点的距离,必须等于机构标定出的 linkLug 长度
};

// 机构要求连杆耳在局部系里指向 +Y(90°),而它在设计系里指向 lugDir,于是斗体安装角被唯一确定
const BUCKET_BODY_ROT = Math.PI / 2 - BUCKET_DESIGN.lugDir; // = 80°
const rot2 = ([x, y], a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];

// 斗口法线:斗口是"顶板前缘 → 刃口"这条线,斗腔在它的背板一侧,所以法线取顺时针那一侧(朝外)
const _m0 = BUCKET_DESIGN.inner[BUCKET_DESIGN.inner.length - 1];
const _m1 = BUCKET_DESIGN.inner[0];
const BUCKET_MOUTH_NORMAL = Math.atan2(-(_m1[0] - _m0[0]), _m1[1] - _m0[1]) + BUCKET_BODY_ROT;

export const BUCKET = {
  capacity: 1.0, // m³ 堆装斗容
  width: 1.2,
  design: BUCKET_DESIGN,
  bodyRot: BUCKET_BODY_ROT,
  mouthNormal: BUCKET_MOUTH_NORMAL,
  spillCos: 0.2, // 斗口法线的竖直分量掉到这个值以下,土就开始往外撒
  tip: rot2(BUCKET_DESIGN.tip, BUCKET_BODY_ROT), // 斗齿尖(局部系)
  edge: rot2(BUCKET_DESIGN.edge, BUCKET_BODY_ROT),
  linkLug: [0.0, BUCKET_DESIGN.lugR],
  teeth: 5,
  linkage: {
    Ph: [2.673, 0.261],
    L1: 0.55, // 摇臂长 Ph→H
    L2: 0.55, // 连杆长 H→Pb
    cylBase: [0.356, 0.472],
    branch: 0, // 四连杆装配支 —— 另一支会让"伸缸=卸料",是反的
    barrelR: 0.11,
    rodR: 0.065,
  },
  // 收斗是 bucketAngle **减小**(斗齿顺时针从朝下转到朝后上)
  angleMin: -135.2 * DEG, // 完全收斗
  angleMax: 33.7 * DEG, // 完全卸料
};

// 把设计系里的点转到铲斗局部系
export function bucketLocal(p) {
  return rot2(p, BUCKET_BODY_ROT);
}

// ── 液压 / 动力特性 ────────────────────────────────────────────────────
// 手柄 → 先导压力 → 主阀开度 → 流量 → 油缸速度。速度按真机循环时间反推:
//   动臂举升 ≈ 3.0 s、下降 ≈ 2.4 s;斗杆收 ≈ 3.0 s、放 ≈ 2.6 s;铲斗收 ≈ 2.4 s、卸 ≈ 1.9 s
export const HYDRAULICS = {
  cyl: {
    boom: { up: 0.6, down: 0.75 }, // m/s  (up = 伸缸 = 动臂升)
    arm: { up: 0.68, down: 0.6 }, //      (up = 斗杆角增大 = 斗杆外摆)
    bucket: { up: 0.58, down: 0.46 }, //   (up = 卸料,down = 收斗)
  },
  // 两台主泵的总流量,以"一个动作满速"为 1。三个动作一起全推就分不够了 —— 复合动作会变慢,真机也是。
  pumpCapacity: 2.1,
  swingSpeed: 1.2, // rad/s 最大回转速度(≈ 11.5 rpm)
  swingAccel: 0.95, // rad/s² —— 上车十几吨,起停都得"荡"一下
  swingBrake: 1.25,
  trackSpeedLo: 0.83, // m/s  龟速档 3.0 km/h
  trackSpeedHi: 1.53, //      兔速档 5.5 km/h
  trackAccel: 1.2,
  spoolRate: 5.0, // 先导阀开启速率(每秒行程)
  deadzone: 0.1,
};

export const ENGINE = {
  idleRpm: 1000,
  maxRpm: 2000,
  autoDecelRpm: 1400, // 自动怠速
  autoDecelDelay: 4, // 秒:手柄回中这么久就降速
  throttleSteps: 10, // 油门旋钮 1~10 档
  crankTime: 1.1, // 起动机要带多久才着车
  modes: {
    P: { name: 'P 重载', flow: 1.0 },
    E: { name: 'E 经济', flow: 0.85 },
    L: { name: 'L 精细', flow: 0.55 },
  },
};

// 整机质量分布(kg,重心位置在各自局部系里)—— 算倾翻稳定性用
export const MASS = {
  lower: { m: 7200, x: 0, y: 0.45 },
  upper: { m: 5400, x: -0.35, y: 1.65 },
  counterweight: { m: 3800, x: -2.25, y: 1.75 },
  boom: { m: 1550 },
  arm: { m: 820 },
  bucket: { m: 780 },
  soilDensity: 1800, // kg/m³ 松散湿土
};

// ── 地形 ────────────────────────────────────────────────────────────────
export const TERRAIN = {
  size: 100, // 场地边长(米)
  segments: 400, // 网格分辨率 → 每格 0.25 m
  maxDigDepth: 7.0,
  soilRepose: 0.72, // 休止角 tan 值(约 36°),堆土会自然塌方
};

export const CAMERA = {
  fov: 60,
  near: 0.05,
  far: 1200,
};
