/**
 * 装载机 Z 型反转六连杆标定(node tools/loader-linkage.mjs [--search])。
 *
 * 机构(前车架局部系,x 前 y 上):
 *   A  动臂根铰(车架)        B  铲斗铰点(动臂端)
 *   R  摇臂铰点(动臂上的横梁) Rt 摇臂上端 ← 转斗油缸杆端(缸底 C 在车架上)
 *   Rb 摇臂下端 → 连杆 → Pb 铲斗上的连杆耳
 * 转斗油缸伸 → 摇臂上端前推、下端后摆 → 连杆往回拉 → 铲斗上翻(收斗)。这就是"反转"。
 *
 * 状态量用两组油缸的长度(和真机一样:阀在中位时油缸长度不变,铲斗角由机构决定),
 * 动臂角 α 由举升缸长度反解,铲斗角 β 由六连杆正解。
 * 判据:地面收斗 ≥ 45°、最高位卸料 ≥ 45°、举升过程中铲斗姿态基本保持、各处传动角 > 30°、
 * 油缸行程比 ≤ 1.75(单级缸做得出来)。
 */
import { LOADER_LINKAGE as P0, solveLoader, loaderLiftAngle, loaderTiltLength } from '../src/vehicles/loader-kin.js';

const DEG = 180 / Math.PI;

/** α 固定时,转斗缸能扫出的铲斗角范围(取最长的单调有解段) */
function betaRange(P, a) {
  let best = null;
  let run = null;
  for (let L = 0.6; L <= 3.4; L += 0.01) {
    const s = solveLoader(P, a, L);
    if (s && run && s.beta > run.hi) {
      run.hi = s.beta;
      run.L1 = L;
    } else {
      if (run && (!best || run.hi - run.lo > best.hi - best.lo)) best = run;
      run = s ? { lo: s.beta, hi: s.beta, L0: L, L1: L } : null;
    }
  }
  if (run && (!best || run.hi - run.lo > best.hi - best.lo)) best = run;
  return best;
}

function evaluate(P, verbose = false) {
  const aMin = P.alphaMin;
  const aMax = P.alphaMax;
  const lift = (a) => Math.hypot(P.A[0] + rotx(P.E, a) - P.D[0], P.A[1] + roty(P.E, a) - P.D[1]);
  const Lmin = lift(aMin);
  const Lmax = lift(aMax);
  const g = betaRange(P, aMin);
  const t = betaRange(P, aMax);
  if (!g || !t) return { score: -1e6 };
  // 地面要能收到 +46°、卸到 -20°;最高位要能卸到 -48°、收到 +20°
  let pen = 0;
  pen += Math.max(0, 46 / DEG - g.hi) * DEG * 20 + Math.max(0, g.lo + 25 / DEG) * DEG * 20;
  pen += Math.max(0, t.lo + 48 / DEG) * DEG * 20 + Math.max(0, 15 / DEG - t.hi) * DEG * 20;
  if (pen > 300) return { score: -pen - 5000, why: 'range' };
  const tMax = loaderTiltLength(P, aMin, Math.min(46 / DEG, g.hi - 0.005));
  const tMin = loaderTiltLength(P, aMax, Math.max(-48 / DEG, t.lo + 0.005));
  if (!tMax || !tMin || tMax <= tMin) return { score: -5000, why: 'tilt range' };
  let minTrans = 180;
  let worst = '';
  let fails = 0;
  let nonMono = 0;
  const rows = [];
  for (let i = 0; i <= 12; i++) {
    const a = aMin + ((aMax - aMin) * i) / 12;
    let prevB = null;
    let bLo = 1e9;
    let bHi = -1e9;
    for (let j = 0; j <= 40; j++) {
      const Lt = tMin + ((tMax - tMin) * j) / 40;
      const s = solveLoader(P, a, Lt);
      if (!s) {
        fails++;
        continue;
      }
      if (prevB !== null && s.beta <= prevB) nonMono++;
      prevB = s.beta;
      bLo = Math.min(bLo, s.beta);
      bHi = Math.max(bHi, s.beta);
      for (const [k, v] of Object.entries(s.trans)) {
        if (v < minTrans) {
          minTrans = v;
          worst = `${k} @a=${(a * DEG).toFixed(0)} b=${(s.beta * DEG).toFixed(0)}`;
        }
      }
    }
    rows.push([a, bLo, bHi]);
  }
  const carry = loaderTiltLength(P, aMin, 40 / DEG);
  const top = carry && solveLoader(P, aMax, carry);
  const drift = top ? (top.beta - 40 / DEG) * DEG : 90;
  const strokeRatioL = Lmax / Lmin;
  const strokeRatioT = tMax / tMin;
  let score = -pen + Math.min(minTrans, 50) * 3 - Math.max(0, Math.abs(drift - 5) - 3) * 2 - fails * 30 - nonMono * 30;
  score -= Math.max(0, strokeRatioL - 1.72) * 600 + Math.max(0, strokeRatioT - 1.72) * 600;
  score -= Math.max(0, 0.95 - tMin) * 300 + Math.max(0, 0.95 - Lmin) * 300;
  if (verbose) {
    console.log(`举升缸 ${Lmin.toFixed(3)} → ${Lmax.toFixed(3)} m  行程比 ${strokeRatioL.toFixed(2)}`);
    console.log(`转斗缸 ${tMin.toFixed(3)} → ${tMax.toFixed(3)} m  行程比 ${strokeRatioT.toFixed(2)}`);
    console.log(`最小传动角 ${minTrans.toFixed(1)}°  (${worst})   无解 ${fails}  非单调 ${nonMono}`);
    console.log(`地面收斗 40° 举到顶:铲斗角漂移 ${drift.toFixed(1)}°`);
    for (const [a, lo, hi] of rows) {
      const B = [P.A[0] + Math.cos(a) * P.La, P.A[1] + Math.sin(a) * P.La];
      console.log(`  α ${(a * DEG).toFixed(1).padStart(6)}°  铰点高 ${B[1].toFixed(2)} m  铲斗角 ${(lo * DEG).toFixed(0)}° ~ ${(hi * DEG).toFixed(0)}°`);
    }
  }
  return { score, tMin, tMax, Lmin, Lmax };
}
const rotx = ([x, y], a) => x * Math.cos(a) - y * Math.sin(a);
const roty = ([x, y], a) => x * Math.sin(a) + y * Math.cos(a);

if (process.argv.includes('--search')) {
  const jitter = (v, s) => v + (Math.random() - 0.5) * s;
  const cl = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  // 只在"看起来像真机"的范围里搜:缸底在前车架上、摇臂在动臂中部上方、杆件尺寸合理
  const mutate = (b, k) => ({
    ...b,
    C: [cl(jitter(b.C[0], 0.5 * k), 1.1, 1.9), cl(jitter(b.C[1], 0.5 * k), 1.2, 2.0)],
    R: [cl(jitter(b.R[0], 0.5 * k), 1.5, 2.3), cl(jitter(b.R[1], 0.4 * k), 0.3, 1.05)],
    r1: cl(jitter(b.r1, 0.3 * k), 0.55, 1.1),
    r2: cl(jitter(b.r2, 0.3 * k), 0.4, 0.75),
    gamma: cl(jitter(b.gamma, 0.6 * k), 2.4, 3.6),
    Ll: cl(jitter(b.Ll, 0.3 * k), 0.45, 1.0),
    lug: [cl(jitter(b.lug[0], 0.2 * k), -0.15, 0.15), cl(jitter(b.lug[1], 0.2 * k), 0.5, 0.9)],
    E: [cl(jitter(b.E[0], 0.3 * k), 0.75, 1.5), cl(jitter(b.E[1], 0.15 * k), -0.45, -0.12)],
    D: [cl(jitter(b.D[0], 0.3 * k), 1.3, 2.2), cl(jitter(b.D[1], 0.3 * k), 0.6, 1.2)],
  });
  let gBest = null;
  let gS = -Infinity;
  for (let restart = 0; restart < 6; restart++) {
    let best = restart ? mutate(P0, 1.5) : { ...P0 };
    let bestS = evaluate(best).score;
    const N = 20000;
    for (let it = 0; it < N; it++) {
      const k = 0.05 + 0.95 * (1 - it / N);
      const P = mutate(best, k);
      const s = evaluate(P).score;
      if (s > bestS) {
        best = P;
        bestS = s;
      }
    }
    console.log(`restart ${restart}: ${bestS.toFixed(1)}`);
    if (bestS > gS) {
      gS = bestS;
      gBest = best;
    }
  }
  const r = (v) => Math.round(v * 1000) / 1000;
  console.log(JSON.stringify(gBest, (k, v) => (typeof v === 'number' ? r(v) : v)));
  evaluate(gBest, true);
} else {
  evaluate(P0, true);
}
