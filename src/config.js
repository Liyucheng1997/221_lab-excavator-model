/**
 * 整机尺寸与调校参数 —— 以 20 吨级液压反铲(CAT 320 / 小松 PC200 量级)为原型。
 *
 * 坐标约定(贯穿全工程):
 *   工作平面是二维的 (x, y):x = 车头朝向(前),y = 向上。
 *   Three.js 里整机朝 +X,回转绕 Y 轴,动臂/斗杆/铲斗各关节绕 Z 轴转。
 *   所以"在回转台局部坐标里的二维点"可以直接当成 Three.js 的 (x, y, 0)。
 *
 * 每个关节的角度都是相对上一节的,单位弧度,逆时针为正(即"抬起"为正)。
 */

export const DEG = Math.PI / 180;

// ── 底盘 / 行走装置 ────────────────────────────────────────────────────
export const UNDERCARRIAGE = {
  trackLength: 4.25, // 履带接地长度
  trackWidth: 0.6, // 单条履带板宽度
  gauge: 2.0, // 两条履带中心距
  trackHeight: 0.82, // 履带最高点离地
  idlerRadius: 0.41, // 前引导轮 / 后驱动轮半径
  frameWidth: 0.9, // 中间 X 形车架宽度
  swingBearingY: 0.86, // 回转支承所在高度
};

// ── 上部回转体 ──────────────────────────────────────────────────────────
export const UPPER = {
  deckY: 0.92, // 回转平台面高度
  deckLength: 4.3, // 平台前后长
  deckWidth: 2.75, // 平台左右宽
  tailRadius: 2.75, // 尾部回转半径
  counterweightX: -2.05, // 配重中心(在回转中心之后)
  cabX: 0.55, // 驾驶室中心 x
  // 挖掘机驾驶室在左侧。整机朝 +X、+Y 向上,按右手系 右 = 前 × 上 = +Z,所以左是 -Z。
  cabZ: -0.78,
  cabWidth: 1.02,
  cabLength: 1.85,
  cabHeight: 1.78,
};

// ── 工作装置:动臂 ──────────────────────────────────────────────────────
// 动臂局部系:根铰点在原点,弯折的"香蕉"形,臂端铰点在 tip。
export const BOOM = {
  foot: [1.15, 1.35], // 动臂根铰点(回转台局部系)
  knee: [2.9, 1.12], // 弯折处(局部系)
  tip: [5.68, 0.0], // 斗杆铰点(局部系)
  halfHeightRoot: 0.28,
  halfHeightKnee: 0.36,
  halfHeightTip: 0.24,
  width: 0.56,
  angleMin: -32 * DEG, // 动臂放到底
  angleMax: 48 * DEG, // 动臂抬到顶
  // 动臂油缸(两根并列):缸底铰在回转台前下方,活塞杆铰在动臂下缘
  cyl: {
    base: [1.35, 0.5], // 回转台局部系
    rod: [2.5, 0.62], // 动臂局部系(下缘)
    barrelR: 0.115,
    rodR: 0.07,
    pairZ: 0.42, // 两根缸左右各偏移这么多
  },
};

// ── 工作装置:斗杆 ──────────────────────────────────────────────────────
// 斗杆局部系:根铰点在原点,沿 +X 伸向铲斗铰点。
export const ARM = {
  tip: [2.9, 0.0], // 铲斗铰点(局部系)
  halfHeightRoot: 0.3,
  halfHeightTip: 0.19,
  width: 0.4,
  humpBack: [-0.7, 0.62], // 后上方那个凸耳(挂斗杆油缸)
  angleMin: -152 * DEG, // 斗杆完全收回(贴向机身)
  angleMax: -32 * DEG, // 斗杆完全伸出
  // 斗杆油缸:缸底铰在动臂上缘,活塞杆铰在斗杆后上凸耳
  cyl: {
    base: [3.05, 1.45], // 动臂局部系(上缘)
    rod: [-0.7, 0.62], // 斗杆局部系(= humpBack)
    barrelR: 0.13,
    rodR: 0.08,
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
// 具体数值由 tools/linkage-check.mjs 扫描标定,保证在工作行程内单调且不卡死。
// 斗体外形在"设计系"里画:斗口朝 +Y、斗底朝 +X、铰点在原点(即斗子平放、口朝上的姿态)。
// 设计系再整体转 bodyRot 得到"铲斗局部系" —— 局部系的定义被机构锁死了(斗耳必须在 (0, 0.376)),
// 所以 bodyRot 不是随便挑的:它由"斗耳在设计系里的方位角"唯一确定,见下面推导。
const BUCKET_DESIGN = {
  // 侧面外轮廓:背板顶 → 背板 → 斗跟 → 斗底 → 斗齿根
  outer: [
    [-0.3, 0.3],
    [-0.36, 0.05],
    [-0.3, -0.28],
    [-0.1, -0.52],
    [0.3, -0.66],
    [0.8, -0.66],
    [1.44, -0.49],
  ],
  // 侧面内轮廓(回程),与外轮廓构成约 90mm 的钢板厚度
  inner: [
    [1.4, -0.4],
    [0.8, -0.55],
    [0.3, -0.55],
    [-0.05, -0.42],
    [-0.21, -0.22],
    [-0.26, 0.05],
    [-0.21, 0.3],
  ],
  tip: [1.44, -0.49], // 斗齿尖(设计系)
  lugDir: 121.4 * DEG, // 连杆铰点在背板上的方位角(自斗铰点量起)
  lugR: 0.376, // …到斗铰点的距离,必须等于机构标定出的 linkLug 长度
};

// 机构要求 linkLug 在局部系里指向 +Y(90°),而它在设计系里指向 lugDir,
// 于是斗体安装角被唯一确定:
const BUCKET_BODY_ROT = Math.PI / 2 - BUCKET_DESIGN.lugDir; // ≈ -31.4°
const rot2 = ([x, y], a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];

// 斗口法线:斗口是"背板顶 → 齿尖"这条线,法线朝斗腔外。
// 土会不会撒出来,判的就是这条法线还朝不朝上 —— 和真机一个道理,不是拍脑袋定个角度阈值。
const _m0 = BUCKET_DESIGN.inner[BUCKET_DESIGN.inner.length - 1]; // 背板顶(内侧)
const _m1 = BUCKET_DESIGN.inner[0]; // 齿尖(内侧)
const BUCKET_MOUTH_NORMAL = Math.atan2(_m1[0] - _m0[0], -(_m1[1] - _m0[1])) + BUCKET_BODY_ROT;

export const BUCKET = {
  capacity: 1.0, // m³ 斗容
  width: 1.32,
  design: BUCKET_DESIGN,
  bodyRot: BUCKET_BODY_ROT,
  mouthNormal: BUCKET_MOUTH_NORMAL, // 斗口法线在铲斗局部系里的方位角
  spillCos: 0.28, // 法线的竖直分量掉到这个值以下,土就开始往外撒
  // 铲斗局部系:铰点在原点,斗耳指向 +Y
  tip: rot2(BUCKET_DESIGN.tip, BUCKET_BODY_ROT), // 斗齿尖(局部系)
  linkLug: [0.0, BUCKET_DESIGN.lugR], // 连杆铰点 Pb(局部系)
  teeth: 5,
  linkage: {
    Ph: [2.673, 0.261], // 摇臂在斗杆上的铰点(斗杆局部系)
    L1: 0.55, // 摇臂长 Ph→H
    L2: 0.55, // 连杆长 H→Pb
    cylBase: [0.356, 0.472], // 铲斗油缸缸底铰(斗杆局部系,斗杆上缘靠后)
    branch: 0, // 四连杆装配支 —— 另一支会让"伸缸=卸料",是反的
    barrelR: 0.115,
    rodR: 0.07,
  },
  // 工作转角范围 —— 由 tools/linkage-solve.mjs 搜索标定,满足:
  //   · 175° 行程(真机 175~185°)
  //   · 油缸 1.78 → 2.87 m,行程比 0.62(真机 0.4~0.7)
  //   · 全程单调、不碰死点;摇臂始终在斗杆背面之上
  //   · 伸缸 = 收斗 —— 挖掘的重活走全缸径,和真机一致
  // 两端各留 3° 余量,避免贴到机构死点。
  //
  // 注意:收斗是 bucketAngle **减小**(斗齿顺时针从朝下转到朝后上,近路只有 150°)。
  angleMin: -135.2 * DEG, // 完全收斗
  angleMax: 33.7 * DEG, // 完全卸料
};

// ── 液压 / 动力特性 ────────────────────────────────────────────────────
// 真机的手柄控制的是流量(= 油缸速度),不是角度。这里对每个关节给出"油缸速度"上限,
// 再按当前几何换算成角速度 —— 所以你会感觉到:动臂快到顶时变慢、斗杆在某些角度特别有劲。
export const HYDRAULICS = {
  boomCylSpeed: 0.5, // m/s 活塞速度
  armCylSpeed: 0.62,
  bucketCylSpeed: 0.5,
  swingSpeed: 0.62, // rad/s 最大回转角速度
  swingAccel: 1.1, // rad/s² —— 上车几吨重,起停都得"荡"一下
  swingBrake: 1.5,
  trackSpeed: 1.35, // m/s 单侧履带最大线速度
  trackAccel: 1.6,
  // 手柄→流量的响应(先导阀不是瞬间开的)
  spoolRate: 4.5, // 每秒手柄行程变化上限
  deadzone: 0.08,
};

export const ENGINE = {
  idleRpm: 900,
  maxRpm: 2000,
  throttleSteps: 10, // 真机油门是 1~10 档旋钮
  defaultThrottle: 7,
};

// ── 地形 ────────────────────────────────────────────────────────────────
export const TERRAIN = {
  size: 90, // 场地边长(米)
  segments: 220, // 网格分辨率 → 每格约 0.41m
  digRate: 1.6, // m/s 每秒能切下去的深度
  maxDigDepth: 7.0,
  soilRepose: 0.72, // 休止角 tan 值(约 36°),堆土会自然塌方
};

export const CAMERA = {
  fov: 55,
  near: 0.1,
  far: 800,
};
