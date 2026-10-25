/**
 * 装载机工作装置运动学:Z 型反转六连杆(国产 ZL50 / 柳工 856 / 徐工 LW500 都是这一套)。
 *
 * 全部在前车架局部系的 (x=前, y=上) 平面里算,原点在铰接中心正下方的地面。
 *   A  动臂根铰(前车架塔架上)      B  铲斗铰点(动臂前端)
 *   E  举升缸杆端(动臂下缘)        D  举升缸缸底(前车架)
 *   R  摇臂铰点(动臂中部的横梁上)  Rt 摇臂上端 ← 转斗缸杆端,缸底 C 在车架上
 *   Rb 摇臂下端 → 连杆 → Pb 铲斗背板上的连杆耳
 *
 * 转斗缸伸出 → 摇臂上端前推、下端后摆 → 连杆往回拉 → 铲斗上翻(收斗)。这就是"反转"六连杆。
 * 好处是收斗用的是油缸大腔,铲掘力大;而且举升时铲斗姿态基本保持,满斗举起来不会洒。
 *
 * 状态量就是两组油缸的长度 —— 阀在中位时油缸长度不变,铲斗角由机构决定(这就是 Z 型杆的"自动放平"特性)。
 * 参数由 tools/loader-linkage.mjs 标定:地面收斗 46°、最高位卸料 48°、各处传动角 > 30°。
 */
import { circleIntersect, angleFromCylinder, fromArray, xform, dist } from '../linkage.js';

export const LOADER_LINKAGE = {
  A: [1.0, 2.1],
  La: 2.95,
  alphaMin: -0.5653, // 铲斗平放在地上:铰点高 0.52 m
  alphaMax: 0.745, // 动臂举到顶:铰点高 4.1 m
  D: [2.156, 0.603], // 举升缸缸底(前车架,前桥上方)
  E: [0.75, -0.17], // 举升缸杆端(动臂局部系)
  R: [1.804, 0.445], // 摇臂铰点(动臂局部系:动臂中部上方的横梁)
  C: [1.542, 1.798], // 转斗缸缸底(前车架塔架前沿,比动臂根铰低)
  r1: 0.918, // 摇臂上臂(接转斗缸)
  r2: 0.75, // 摇臂下臂(接连杆)
  gamma: 2.547, // 上臂 → 下臂的夹角
  Ll: 0.949, // 连杆
  lug: [-0.1, 0.5], // 连杆耳(铲斗设计系,铰点为原点)
  br1: 1,
  br2: 0,
  // 油缸行程(由标定脚本算出):举升缸 1.132~1.943 m,转斗缸 1.092~1.640 m
  liftMin: 1.132,
  liftMax: 1.943,
  tiltMin: 1.092,
  tiltMax: 1.64,
};

const ang = (v) => Math.atan2(v.y, v.x);
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
/** 两线夹角折成 0~90°(90 = 传力最好) */
function trans(u, v) {
  const c = Math.abs((u.x * v.x + u.y * v.y) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y)));
  return (Math.acos(Math.min(1, c)) * 180) / Math.PI;
}

export function armPoints(P, alpha) {
  const A = fromArray(P.A);
  return {
    A,
    B: xform(A, alpha, { x: P.La, y: 0 }),
    R: xform(A, alpha, fromArray(P.R)),
    E: xform(A, alpha, fromArray(P.E)),
  };
}

/** 正解:动臂角 α + 转斗缸长度 → 铲斗角 β 与全部铰点 */
export function solveLoader(P, alpha, Lt) {
  const { A, B, R, E } = armPoints(P, alpha);
  const C = fromArray(P.C);
  const s1 = circleIntersect(R, P.r1, C, Lt);
  if (!s1) return null;
  const Rt = s1[P.br1];
  const phi = ang(sub(Rt, R));
  const Rb = { x: R.x + P.r2 * Math.cos(phi + P.gamma), y: R.y + P.r2 * Math.sin(phi + P.gamma) };
  const lugR = Math.hypot(P.lug[0], P.lug[1]);
  const s2 = circleIntersect(Rb, P.Ll, B, lugR);
  if (!s2) return null;
  const Pb = s2[P.br2];
  let beta = ang(sub(Pb, B)) - Math.atan2(P.lug[1], P.lug[0]);
  beta = Math.atan2(Math.sin(beta), Math.cos(beta));
  return {
    A,
    B,
    R,
    E,
    C,
    Rt,
    Rb,
    Pb,
    phi,
    beta,
    D: fromArray(P.D),
    trans: {
      rocker: trans(sub(Rt, C), sub(Rt, R)),
      link: trans(sub(Pb, Rb), sub(Pb, B)),
      linkRocker: trans(sub(Pb, Rb), sub(Rb, R)),
    },
  };
}

/** 反解:动臂角 + 想要的铲斗角 → 转斗缸长度(用来定行程端点、初始姿态) */
export function loaderTiltLength(P, alpha, beta, iters = 60) {
  // 正解在行程内单调,二分最稳
  let lo = 0.6;
  let hi = 3.2;
  const f = (L) => {
    const s = solveLoader(P, alpha, L);
    return s ? s.beta - beta : NaN;
  };
  // 先粗扫找到有解且变号的区间
  let prev = null;
  let found = null;
  for (let L = lo; L <= hi; L += 0.01) {
    const v = f(L);
    if (Number.isNaN(v)) {
      prev = null;
      continue;
    }
    if (prev && Math.sign(prev.v) !== Math.sign(v)) {
      found = [prev.L, L];
      break;
    }
    prev = { L, v };
  }
  if (!found) return null;
  [lo, hi] = found;
  const sLo = Math.sign(f(lo));
  for (let i = 0; i < iters; i++) {
    const m = (lo + hi) / 2;
    if (Math.sign(f(m)) === sLo) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/** 举升缸长度 → 动臂角 */
export function loaderLiftAngle(P, L) {
  return angleFromCylinder(fromArray(P.D), fromArray(P.A), fromArray(P.E), L);
}

export function loaderLiftLength(P, alpha) {
  const { E } = armPoints(P, alpha);
  return dist(E, fromArray(P.D));
}
