/**
 * 工作装置的二维运动学。全部在 (x=前, y=上) 平面里算。
 *
 * 之所以要认真做这块:挖掘机看起来"像不像"几乎全在油缸和铲斗四连杆上。
 * 油缸必须真的伸缩、真的跟着两端铰点转;铲斗必须由摇臂+连杆推动,而不是凭空绕铰点转。
 */

export const v2 = (x, y) => ({ x, y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s });
export const len = (a) => Math.hypot(a.x, a.y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const dir = (a) => Math.atan2(a.y, a.x);
export const fromArray = ([x, y]) => ({ x, y });

/** 绕原点旋转 θ(逆时针为正) */
export function rot(p, theta) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** 把局部点变换到父系:origin + R(theta) * p */
export function xform(origin, theta, p) {
  return add(origin, rot(p, theta));
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/**
 * 两圆交点。返回两个解 [左解, 右解],按 A→B 方向的左右手区分;不相交返回 null。
 * 这是四连杆位置分析的全部数学。
 */
export function circleIntersect(A, rA, B, rB) {
  const d = dist(A, B);
  if (d > rA + rB || d < Math.abs(rA - rB) || d === 0) return null;
  const a = (rA * rA - rB * rB + d * d) / (2 * d);
  const hSq = rA * rA - a * a;
  const h = Math.sqrt(Math.max(0, hSq));
  const u = scale(sub(B, A), 1 / d);
  const perp = { x: -u.y, y: u.x }; // A→B 的左手法向
  const mid = add(A, scale(u, a));
  return [add(mid, scale(perp, h)), sub(mid, scale(perp, h))];
}

/**
 * 简单油缸:缸底铰点固定在父系的 base,活塞杆铰点固定在绕 pivot 转的子件上。
 * 给定关节角,返回两个铰点在父系里的位置和油缸长度。
 *
 *   base   —— 父系里的固定铰点
 *   pivot  —— 关节铰点在父系里的位置
 *   rodLocal —— 活塞杆铰点在子件局部系里的位置
 *   theta  —— 子件相对父系的转角
 */
export function cylinderEnds(base, pivot, rodLocal, theta) {
  const rod = xform(pivot, theta, rodLocal);
  return { base, rod, length: dist(base, rod) };
}

/**
 * 上面那个的反解:给定油缸长度求关节角。
 *
 * 令 D = pivot - base,d = |D|,ψ = dir(D);r = |rodLocal|,δ = dir(rodLocal)。
 * 则  L² = d² + r² + 2·r·d·cos(θ + δ − ψ)
 * 取 θ = ψ − δ − acos(k) 这一支,使 θ 随 L 单调递增。
 */
export function angleFromCylinder(base, pivot, rodLocal, length) {
  const D = sub(pivot, base);
  const d = len(D);
  const r = len(rodLocal);
  const psi = dir(D);
  const delta = dir(rodLocal);
  const k = clamp((length * length - d * d - r * r) / (2 * r * d), -1, 1);
  return psi - delta - Math.acos(k);
}

/** 上面那个的配套:给定关节角求油缸长度(与 cylinderEnds 一致,只是省掉中间量) */
export function cylinderLength(base, pivot, rodLocal, theta) {
  return dist(base, xform(pivot, theta, rodLocal));
}

/**
 * 铲斗四连杆位置分析。全部在**斗杆局部系**里算。
 *
 *   Ph  摇臂在斗杆上的固定铰点
 *   P2  铲斗铰点(= 斗杆末端)
 *   H   浮动铰点:油缸杆端 = 摇臂端 = 连杆端
 *   Pb  连杆在铲斗上的铰点(随铲斗转)
 *
 * 已知 bucketAngle → Pb 已知 → H = circle(Ph, L1) ∩ circle(Pb, L2)。
 *
 * 两个交点对应四连杆的两种装配支(open / crossed)。这不是可以随便挑的:
 * 两支的**转向相反** —— 一支是"伸缸=收斗"(真机),另一支是"伸缸=卸料"(错的)。
 * 装配支由 cfg.linkage.branch 指定,数值由 tools/linkage-solve.mjs 标定。
 */
export function solveBucketLinkage(cfg, bucketAngle) {
  const Ph = fromArray(cfg.linkage.Ph);
  const P2 = fromArray(cfg.armTip);
  const Pb = xform(P2, bucketAngle, fromArray(cfg.linkLug));
  const sol = circleIntersect(Ph, cfg.linkage.L1, Pb, cfg.linkage.L2);
  if (!sol) return null;
  const H = sol[cfg.linkage.branch ?? 0];
  const cylBase = fromArray(cfg.linkage.cylBase);
  return { Ph, P2, Pb, H, cylBase, cylLength: dist(cylBase, H) };
}

/**
 * 扫描铲斗角,找出机构真正能走通、而且油缸长度单调的那一段。
 * 真机的行程终点是油缸行程限位,不是机构死点 —— 所以这里主动把死点排除在外。
 * 返回 { min, max, strokeMin, strokeMax } 或 null。
 */
export function scanBucketRange(cfg, lo, hi, steps = 2000) {
  const samples = [];
  for (let i = 0; i <= steps; i++) {
    const a = lerp(lo, hi, i / steps);
    const s = solveBucketLinkage(cfg, a);
    samples.push(s ? { a, L: s.cylLength } : null);
  }
  // 找最长的一段:既有解、油缸长度又严格单调
  let best = null;
  let runStart = -1;
  let sign = 0;
  for (let i = 0; i < samples.length; i++) {
    const cur = samples[i];
    const prev = i > 0 ? samples[i - 1] : null;
    let broken = !cur;
    if (cur && prev) {
      const d = cur.L - prev.L;
      const s = Math.sign(d);
      if (s !== 0) {
        if (sign === 0) sign = s;
        else if (s !== sign) broken = true;
      }
    }
    if (broken || !cur) {
      if (runStart >= 0) {
        const run = { i0: runStart, i1: i - 1, sign };
        if (!best || run.i1 - run.i0 > best.i1 - best.i0) best = run;
      }
      runStart = cur ? i : -1;
      sign = 0;
    } else if (runStart < 0) {
      runStart = i;
      sign = 0;
    }
  }
  if (runStart >= 0) {
    const run = { i0: runStart, i1: samples.length - 1, sign };
    if (!best || run.i1 - run.i0 > best.i1 - best.i0) best = run;
  }
  if (!best || best.i1 <= best.i0) return null;
  const A = samples[best.i0];
  const B = samples[best.i1];
  return {
    min: Math.min(A.a, B.a),
    max: Math.max(A.a, B.a),
    strokeMin: Math.min(A.L, B.L),
    strokeMax: Math.max(A.L, B.L),
  };
}
