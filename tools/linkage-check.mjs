/**
 * 连杆标定脚本:  npm run linkage
 *
 * 挖掘机"像不像"的关键在于油缸行程是否合理。这个脚本把三根油缸在整个工作行程里的
 * 长度扫一遍,检查两件事:
 *   1) 单调 —— 油缸伸长必须始终对应关节朝同一方向走,否则手柄推到一半会自己反向。
 *   2) 行程比 —— 真实液压缸的行程约为收缩长度的 0.4~0.7 倍,太小就看不出在动。
 * 铲斗四连杆还要额外确认没有走到机构死点。
 */
import { BOOM, ARM, BUCKET, DEG } from '../src/config.js';
import {
  cylinderLength,
  solveBucketLinkage,
  scanBucketRange,
  fromArray,
  dist,
} from '../src/linkage.js';

const fmt = (v, n = 3) => v.toFixed(n).padStart(7);
const deg = (r) => (r / DEG).toFixed(1).padStart(6);

function report(name, lo, hi, fn) {
  const N = 400;
  let min = Infinity;
  let max = -Infinity;
  let prev = null;
  let sign = 0;
  let monotonic = true;
  for (let i = 0; i <= N; i++) {
    const a = lo + ((hi - lo) * i) / N;
    const L = fn(a);
    if (!Number.isFinite(L)) {
      console.log(`  ${name}: 在 ${deg(a)}° 无解!`);
      return;
    }
    min = Math.min(min, L);
    max = Math.max(max, L);
    if (prev !== null) {
      const s = Math.sign(L - prev);
      if (s !== 0) {
        if (sign === 0) sign = s;
        else if (s !== sign) monotonic = false;
      }
    }
    prev = L;
  }
  const stroke = max - min;
  const ratio = stroke / min;
  console.log(
    `  ${name.padEnd(10)} 角度 ${deg(lo)}° → ${deg(hi)}°   ` +
      `缸长 ${fmt(min)} → ${fmt(max)} m   行程 ${fmt(stroke)} m   ` +
      `行程比 ${fmt(ratio, 2)}   ${monotonic ? '单调 ✓' : '**非单调 ✗**'}` +
      `   ${ratio > 0.35 && ratio < 0.85 ? '' : '(行程比偏离真机 0.4~0.7)'}`
  );
}

console.log('\n=== 油缸行程标定 ===\n');

report('动臂油缸', BOOM.angleMin, BOOM.angleMax, (a) =>
  cylinderLength(fromArray(BOOM.cyl.base), fromArray(BOOM.foot), fromArray(BOOM.cyl.rod), a)
);

report('斗杆油缸', ARM.angleMin, ARM.angleMax, (a) =>
  cylinderLength(fromArray(ARM.cyl.base), fromArray(BOOM.tip), fromArray(ARM.cyl.rod), a)
);

const bucketCfg = { ...BUCKET, armTip: ARM.tip };

console.log('\n=== 铲斗四连杆扫描 ===\n');
const range = scanBucketRange(bucketCfg, -200 * DEG, 200 * DEG, 4000);
if (!range) {
  console.log('  找不到可用区间 —— 机构参数不合理。');
} else {
  console.log(
    `  机构可用且单调区间: ${deg(range.min)}° → ${deg(range.max)}°  ` +
      `(跨度 ${((range.max - range.min) / DEG).toFixed(1)}°)`
  );
  console.log(
    `  对应油缸长度: ${fmt(range.strokeMin)} → ${fmt(range.strokeMax)} m  ` +
      `行程 ${fmt(range.strokeMax - range.strokeMin)} m  ` +
      `行程比 ${fmt((range.strokeMax - range.strokeMin) / range.strokeMin, 2)}`
  );
  console.log(
    `  config.js 当前设定: ${deg(BUCKET.angleMin)}° → ${deg(BUCKET.angleMax)}°  ` +
      (BUCKET.angleMin >= range.min && BUCKET.angleMax <= range.max
        ? '✓ 在可用区间内'
        : '✗ **超出可用区间,会卡死**')
  );

  console.log('\n  几个姿态下的机构细节:');
  for (const a of [BUCKET.angleMin, (BUCKET.angleMin + BUCKET.angleMax) / 2, BUCKET.angleMax]) {
    const s = solveBucketLinkage(bucketCfg, a);
    if (!s) {
      console.log(`    ${deg(a)}°  无解`);
      continue;
    }
    const tipWorld = { x: s.P2.x, y: s.P2.y };
    console.log(
      `    斗角 ${deg(a)}°  H=(${fmt(s.H.x)},${fmt(s.H.y)})  ` +
        `缸长 ${fmt(s.cylLength)}  摇臂实长 ${fmt(dist(s.Ph, s.H))}  连杆实长 ${fmt(dist(s.H, s.Pb))}`
    );
  }
}

// 工作范围:最大挖掘半径与深度
console.log('\n=== 工作范围 ===\n');
{
  let maxReach = 0;
  let maxDepth = 0;
  let maxHeight = 0;
  const step = 2 * DEG;
  for (let b = BOOM.angleMin; b <= BOOM.angleMax; b += step) {
    for (let m = ARM.angleMin; m <= ARM.angleMax; m += step) {
      for (let k = BUCKET.angleMin; k <= BUCKET.angleMax; k += step) {
        const cb = Math.cos(b);
        const sb = Math.sin(b);
        const armPivot = {
          x: BOOM.foot[0] + BOOM.tip[0] * cb - BOOM.tip[1] * sb,
          y: BOOM.foot[1] + BOOM.tip[0] * sb + BOOM.tip[1] * cb,
        };
        const ta = b + m;
        const bucketPin = {
          x: armPivot.x + ARM.tip[0] * Math.cos(ta) - ARM.tip[1] * Math.sin(ta),
          y: armPivot.y + ARM.tip[0] * Math.sin(ta) + ARM.tip[1] * Math.cos(ta),
        };
        const tk = ta + k;
        const tip = {
          x: bucketPin.x + BUCKET.tip[0] * Math.cos(tk) - BUCKET.tip[1] * Math.sin(tk),
          y: bucketPin.y + BUCKET.tip[0] * Math.sin(tk) + BUCKET.tip[1] * Math.cos(tk),
        };
        maxReach = Math.max(maxReach, tip.x);
        maxDepth = Math.min(maxDepth, tip.y);
        maxHeight = Math.max(maxHeight, tip.y);
      }
    }
  }
  console.log(`  最大挖掘半径 ${fmt(maxReach)} m   (真机 20t 级约 9.9~10.2)`);
  console.log(`  最大挖掘深度 ${fmt(-maxDepth)} m   (真机约 6.5~6.7)`);
  console.log(`  最大挖掘高度 ${fmt(maxHeight)} m   (真机约 9.5~10)`);
}
console.log('');
