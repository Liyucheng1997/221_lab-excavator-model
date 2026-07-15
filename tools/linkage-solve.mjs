/**
 * 铲斗四连杆参数搜索:  node tools/linkage-solve.mjs
 *
 * 手推代数很容易掉进"死点"陷阱 —— 摇臂扫过某个方向时油缸长度出现极值,
 * 铲斗就会在手柄推到一半时自己反向。这里直接在设计空间里随机搜索 + 局部精修,
 * 目标是:转角范围尽量大、油缸长度严格单调、行程比落在真机的 0.42~0.70。
 *
 * 搜出来的结果手工填回 src/config.js 的 BUCKET.linkage。
 */
import { scanBucketRange, solveBucketLinkage } from '../src/linkage.js';

const DEG = Math.PI / 180;
const rnd = (lo, hi) => lo + Math.random() * (hi - lo);

// 真机铲斗从完全收斗到完全卸料约 175~185°,这里锁死工作窗口宽度,不让搜索靠"转角超大"刷分。
const WINDOW = 175 * DEG;

// 设计变量边界(斗杆局部系;斗杆自 (0,0) 伸到 (2.9,0))
const BOUNDS = {
  phX: [1.7, 2.78], // 摇臂铰点必须落在斗杆上、且在铲斗铰点之后
  phY: [0.25, 0.85], // 摇臂铰点要真的凸出在斗杆上缘之上
  L1: [0.3, 0.9], // 摇臂
  L2: [0.35, 1.0], // 连杆
  lug: [0.3, 0.65], // 铲斗上连杆铰点到斗铰点的距离
  baseX: [0.15, 1.2], // 油缸缸底在斗杆上缘靠后
  baseY: [0.3, 0.85],
};

// 斗杆是个锥形箱梁:根部半高 0.30,末端 0.19。摇臂端 H 必须始终在这个外形之上。
const armHalfHeight = (x) => 0.3 + (0.19 - 0.3) * Math.min(1, Math.max(0, x / 2.9));

const reject = {};
const no = (why) => {
  reject[why] = (reject[why] || 0) + 1;
  return null;
};

function build(p) {
  return {
    tip: [1.52, -0.3],
    linkLug: [0, p.lug],
    armTip: [2.9, 0],
    linkage: {
      Ph: [p.phX, p.phY],
      L1: p.L1,
      L2: p.L2,
      cylBase: [p.baseX, p.baseY],
      branch: p.branch,
    },
  };
}

function evaluate(p) {
  const cfg = build(p);
  const run = scanBucketRange(cfg, -200 * DEG, 200 * DEG, 1200);
  if (!run) return no('机构无解');
  if (run.max - run.min < WINDOW) return no('单调区间装不下 175° 窗口');

  // 在单调区间里挑出行程最大的那个 175° 子窗口 —— 这才是真正会用到的行程
  const N = 240;
  const step = (run.max - run.min) / N;
  const Ls = [];
  for (let i = 0; i <= N; i++) {
    const a = run.min + step * i;
    const s = solveBucketLinkage(cfg, a);
    if (!s) return no('窗口内无解');
    Ls.push({ a, L: s.cylLength, H: s.H });
  }
  const wSteps = Math.round(WINDOW / step);
  let win = null;
  for (let i = 0; i + wSteps < Ls.length; i++) {
    const j = i + wSteps;
    const d = Math.abs(Ls[j].L - Ls[i].L);
    if (!win || d > win.d) win = { i, j, d };
  }
  if (!win) return no('取不到窗口');

  // 硬约束:真机是"伸缸 = 收斗"(重活走全缸径,靠伸出发力)。
  //
  // 注意别把转向想反了 —— 斗齿从"朝下"(-90°)收到"朝后上"(+120°)走的是**顺时针**的 150° 近路,
  // 不是逆时针的 210°(铲斗总行程才 175°,根本转不过去)。所以:
  //     收斗 = 顺时针 = bucketAngle 减小 = 油缸伸长
  // 即油缸长度必须随 bucketAngle 单调**递减**。反的那个装配支直接淘汰。
  if (Ls[win.j].L >= Ls[win.i].L) return no('转向反了(伸缸变成卸料)');

  const slice = Ls.slice(win.i, win.j + 1);
  const lo = Math.min(Ls[win.i].L, Ls[win.j].L);
  const stroke = win.d;
  const ratio = stroke / lo;

  // 摇臂端 H 到斗杆外形的最小间隙(<0 就是穿模了)
  let clearance = Infinity;
  for (const s of slice) clearance = Math.min(clearance, s.H.y - armHalfHeight(s.H.x));
  const minHy = Math.min(...slice.map((s) => s.H.y));

  // 窗口宽度和转向都已锁死。剩下的指标改成软约束加权,保证总能给出一个最优解来看,
  // 而不是被硬门槛全部拒掉、什么信息都拿不到。
  const miss = (v, lo2, hi2) => (v < lo2 ? lo2 - v : v > hi2 ? v - hi2 : 0);
  const score =
    -miss(ratio, 0.45, 0.68) * 300 - // 行程比要像真缸
    miss(lo, 1.2, 1.9) * 60 - // 收缩长度要像真缸
    miss(clearance, 0.06, 99) * 400 - // 摇臂不能蹭到斗杆
    Math.abs(p.L1 - 0.55) * 12 - // 连杆尺寸别太离谱
    Math.abs(p.L2 - 0.55) * 12;
  return {
    score,
    span: WINDOW,
    ratio,
    stroke,
    minHy,
    clearance,
    r: { min: Ls[win.i].a, max: Ls[win.j].a, strokeMin: lo, strokeMax: lo + stroke },
  };
}

function sample() {
  return {
    phX: rnd(...BOUNDS.phX),
    phY: rnd(...BOUNDS.phY),
    L1: rnd(...BOUNDS.L1),
    L2: rnd(...BOUNDS.L2),
    lug: rnd(...BOUNDS.lug),
    baseX: rnd(...BOUNDS.baseX),
    baseY: rnd(...BOUNDS.baseY),
    branch: Math.random() < 0.5 ? 0 : 1, // 四连杆的两种装配支
  };
}

function perturb(p, s) {
  const q = { ...p };
  for (const k of Object.keys(BOUNDS)) {
    const [lo, hi] = BOUNDS[k];
    q[k] = Math.min(hi, Math.max(lo, p[k] + (Math.random() - 0.5) * (hi - lo) * s));
  }
  q.branch = p.branch; // 装配支是离散的,精修时不动
  return q;
}

let best = null;
let bestP = null;
for (let i = 0; i < 60000; i++) {
  const p = sample();
  const e = evaluate(p);
  if (e && (!best || e.score > best.score)) {
    best = e;
    bestP = p;
  }
}
if (!bestP) {
  console.log('随机阶段没找到可行解。各约束淘汰计数:');
  for (const [k, v] of Object.entries(reject).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(6)}  ${k}`);
  }
  process.exit(1);
}
// 局部精修
for (let round = 0; round < 6; round++) {
  const s = 0.3 / (round + 1);
  for (let i = 0; i < 8000; i++) {
    const p = perturb(bestP, s);
    const e = evaluate(p);
    if (e && e.score > best.score) {
      best = e;
      bestP = p;
    }
  }
}

const f = (v) => Number(v.toFixed(3));
console.log('\n=== 搜索结果 ===\n');
console.log(`  铲斗转角范围  ${(best.r.min / DEG).toFixed(1)}° → ${(best.r.max / DEG).toFixed(1)}°  (跨度 ${(best.span / DEG).toFixed(1)}°)`);
console.log(`  油缸  ${best.r.strokeMin.toFixed(3)} → ${best.r.strokeMax.toFixed(3)} m   行程 ${best.stroke.toFixed(3)} m   行程比 ${best.ratio.toFixed(2)}`);
console.log(`  摇臂端 H 最低点 y = ${best.minHy.toFixed(3)},到斗杆外形的间隙 = ${best.clearance.toFixed(3)} m`);
console.log(`  转向: 伸缸 = 收斗 ✓(真机的重活走全缸径,靠伸出发力)`);
console.log('\n粘回 src/config.js:\n');
console.log(`  linkLug: [0.0, ${f(bestP.lug)}],`);
console.log(`  linkage: {`);
console.log(`    Ph: [${f(bestP.phX)}, ${f(bestP.phY)}],`);
console.log(`    L1: ${f(bestP.L1)},`);
console.log(`    L2: ${f(bestP.L2)},`);
console.log(`    cylBase: [${f(bestP.baseX)}, ${f(bestP.baseY)}],`);
console.log(`    branch: ${bestP.branch},`);
console.log(`  },`);
console.log(`  angleMin: ${((best.r.min / DEG) + 3).toFixed(1)} * DEG,   // 留 3° 余量,避免贴死点`);
console.log(`  angleMax: ${((best.r.max / DEG) - 3).toFixed(1)} * DEG,`);
console.log('');
