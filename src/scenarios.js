/**
 * 关卡内容。
 *
 * 驾校课程按真人学挖机的顺序排:
 *   绕机检查 → 启动熄火 → 认识手柄 → 复合动作(点位)→ 行走 → 挖掘 → 挖沟 → 装车 → 平整 → 坡道
 * 考证模拟对照挖掘机操作证实操考核的项目,百分制扣分。
 * 工地任务是综合作业,有地面人员、地下管线、排队的自卸车。
 */
import * as THREE from 'three';
import { BOOM, ARM, BUCKET, UPPER, DEG } from './config.js';
import { clamp } from './linkage.js';

const K = (k) => `<kbd>${k}</kbd>`;
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** 当前手法下某个动作对应的键 */
function key(g, fn, dir) {
  return K(g.input.keyFor(fn, dir));
}

// ═══════════════════════════════════════════════════════════════════════
//  驾校课程
// ═══════════════════════════════════════════════════════════════════════

// ── 第 1 课 绕机检查 ────────────────────────────────────────────────────
const CHECKS = [
  {
    id: 'oil',
    name: '发动机机油',
    at: (g) => g.ex.swing.localToWorld(new THREE.Vector3(-1.1, UPPER.hoodTopY + 0.05, 0.35)),
    ok: '拔出机油尺擦干净再插回去,油位在 L 和 H 两道刻线之间,颜色是透明的琥珀色。',
    bad: '油位低于 L 刻线,而且油是黑的、有点稀。',
    fix: '应补充到 H 与 L 之间,并记录;油黑发稀要报告换油。',
  },
  {
    id: 'coolant',
    name: '冷却液',
    at: (g) => g.ex.swing.localToWorld(new THREE.Vector3(-1.5, UPPER.hoodTopY + 0.05, -0.8)),
    ok: '副水箱液位在 FULL 和 LOW 之间。(冷车检查 —— 热车时绝对不能拧开散热器盖!)',
    bad: '副水箱几乎见底,地上有一滩绿色的水渍。',
    fix: '有渗漏!必须找出漏点,修好后再加冷却液,不能带病作业。',
  },
  {
    id: 'hyd',
    name: '液压油位',
    at: (g) => g.ex.swing.localToWorld(g.ex.upper.hydGauge.clone()),
    ok: '按规定姿态(斗杆收回、铲斗落地)观察,油位在观察窗中线附近。',
    bad: '观察窗里的油液发白、有乳化的泡沫。',
    fix: '液压油进水乳化了,要报修换油,继续用会损坏液压泵。',
  },
  {
    id: 'fuel',
    name: '燃油',
    at: (g) => g.ex.swing.localToWorld(g.ex.upper.fuelGauge.clone()),
    ok: '燃油够用。每天收工后加满,可以减少油箱里的冷凝水。油水分离器里没有积水。',
    bad: '油水分离器的杯子里有一层水。',
    fix: '拧开放水阀把水放掉,否则水进油路会损坏喷油系统。',
  },
  {
    id: 'track',
    name: '履带张紧度',
    at: (g) => g.ex.chassis.localToWorld(new THREE.Vector3(0, 1.0, 1.4)),
    ok: '托链轮之间履带下垂量大约 2~3 厘米,正常。',
    bad: '上方履带松垮下垂得很厉害,快碰到履带架了。',
    fix: '太松会脱链。从张紧油缸的黄油嘴打黄油,调到下垂 2~3 cm。',
  },
  {
    id: 'teeth',
    name: '斗齿与销轴',
    at: (g) => g.ex.getTipWorld(new THREE.Vector3()),
    ok: '斗齿齐全,卡销都在,销轴处有新鲜黄油。',
    bad: '中间那颗斗齿的卡销掉了一半,齿尖一晃就动。',
    fix: '斗齿随时可能掉进土里、甚至被车拉走砸坏破碎机。必须换卡销后再干活。',
  },
  {
    id: 'cyl',
    name: '油缸与管路',
    at: (g) => g.ex.swing.localToWorld(new THREE.Vector3(1.9, 2.3, 0.45)),
    ok: '活塞杆光亮,没有划痕和漏油,软管没有鼓包、磨破。',
    bad: '动臂油缸活塞杆上有一圈油泥,地上有滴油。',
    fix: '油封漏油,要报修。漏得多了油缸会下沉 —— 这就是"掉臂"。',
  },
  {
    id: 'around',
    name: '周围环境与后视镜',
    at: (g) => g.ex.swing.localToWorld(new THREE.Vector3(1.38, UPPER.hoodTopY + 0.72, UPPER.width / 2 + 0.08)),
    ok: '后视镜干净、角度正确;机器周围和底下没有人、没有障碍物,作业区地面没有松软塌陷。',
    bad: '有个工人坐在履带旁边的阴凉里休息。',
    fix: '上车之前绕机一圈,确认所有人离开回转半径。这是绕机检查最重要的一项!',
  },
];

const walkaround = {
  id: 'walkaround',
  kind: 'lesson',
  title: '第 1 课 · 绕机检查',
  subtitle: '上车之前先绕机器走一圈',
  brief:
    '每天第一次开机前都要做"绕机检查"。这一课发动机是熄火的,你在机器外面。点击机器上闪烁的检查点,看完情况后判断"正常"还是"需要处理"。其中有几项是有问题的。',
  goals: ['完成 8 项检查', '正确找出所有异常'],
  setup(g) {
    g.m.stopEngineNow();
    g.m.parkPose();
    g.m.coolant = 25;
    g.rig.setMode('orbit');
    // 随机 3 项有问题
    const idx = CHECKS.map((_, i) => i).sort(() => Math.random() - 0.5).slice(0, 3);
    g.custom.faults = new Set(idx.map((i) => CHECKS[i].id));
    g.custom.done = new Map();
    for (const c of CHECKS) {
      g.ui.hotspots.add({
        id: c.id,
        label: c.name,
        at: () => c.at(g),
        onClick: () => {
          const fault = g.custom.faults.has(c.id);
          g.ui.inspect({
            title: c.name,
            text: fault ? c.bad : c.ok,
            options: [
              { label: '✓ 正常', value: 'ok' },
              { label: '⚠ 需要处理', value: 'bad' },
            ],
            onPick: (v) => {
              const right = (v === 'bad') === fault;
              g.custom.done.set(c.id, right);
              g.ui.hotspots.mark(c.id, right ? 'ok' : 'wrong');
              if (right) {
                g.sound.ding();
                g.ui.hud.toast(`✓ ${c.name}:判断正确`, 'good', fault ? c.fix : '');
                g.say(fault ? c.fix : '正确。');
              } else {
                g.addPenalty('inspect', 10, `${c.name}:判断错误`, fault ? c.fix : '其实这一项是正常的。' + c.ok);
              }
            },
          });
        },
      });
    }
  },
  steps: [
    {
      text: '点击机器上的检查点,逐项检查。可以拖动鼠标绕着机器看,滚轮缩放。',
      check: (g) => {
        const n = g.custom.done.size;
        return { done: n >= CHECKS.length, progress: n / CHECKS.length, hint: `已检查 ${n} / ${CHECKS.length}` };
      },
    },
  ],
  rules: { noHorn: 0 },
  score(g, res) {
    const right = [...g.custom.done.values()].filter(Boolean).length;
    res.lines.push(['判断正确', `${right} / ${CHECKS.length}`]);
    return res;
  },
};

// ── 第 2 课 启动与熄火 ──────────────────────────────────────────────────
const startStop = {
  id: 'startstop',
  kind: 'lesson',
  title: '第 2 课 · 启动与熄火',
  subtitle: '钥匙、锁杆、油门、预热、冷机熄火',
  brief:
    '真机启动有固定的顺序,每一步都有它的道理。这一课按考证要求的规范流程来:确认锁杆 → 油门低位 → 钥匙 ON 自检 → 鸣笛 → 起动 → 预热 → 解锁作业;熄火时:落斗 → 降油门 → 怠速冷却 → 锁杆 → 钥匙 OFF。',
  goals: ['按规范顺序启动', '按规范顺序熄火'],
  setup(g) {
    g.m.stopEngineNow();
    g.m.setLock(false); // 上一个人没锁 —— 故意的
    g.m.setThrottle(6);
    g.m.coolant = 22;
    g.m.parkPose();
    g.rig.setMode('cab');
  },
  steps: [
    {
      text: `你坐进驾驶室,发现<b>先导安全锁杆是放下的</b>(解锁状态)。先把它抬起锁定:按 ${K('Q')}。`,
      voice: '坐进驾驶室后,先看左手边的先导安全锁杆。现在它是放下的,这很危险,按 Q 把它抬起锁定。',
      check: (g) => g.m.locked,
    },
    {
      text: `把油门旋钮调到低速位(1~2 档):按 ${K('-')} 键。现在是 ${'<span data-live="throttle"></span>'} 档。`,
      voice: '把油门旋钮调到低速位,一到二档。',
      check: (g) => ({ done: g.m.throttle <= 2, hint: `油门 ${g.m.throttle} 档` }),
    },
    {
      text: `钥匙打到 <b>ON</b>:按一下 ${K('E')}。仪表会自检,等自检画面结束。`,
      voice: '按一下 E,钥匙打到 ON 档,等仪表自检结束。',
      check: (g) => g.m.key === 'on' && !g.m.selfTest,
    },
    {
      text: `起动前按一声喇叭 ${K('空格')},提醒周围的人。`,
      voice: '起动之前,按喇叭提醒周围的人。',
      enter: (g, st) => (st.h0 = g.m.lastHorn),
      check: (g, dt, st) => g.m.lastHorn > st.h0,
    },
    {
      text: `<b>按住</b> ${K('E')} 打到 START,听到发动机着车后<b>立刻松手</b>。单次起动别超过 10 秒。`,
      voice: '按住 E 打到 START 档,着车后立刻松手。',
      check: (g) => g.m.running && g.m.key !== 'start',
    },
    {
      text: '<b>怠速预热</b>:保持低油门,让发动机运转,看仪表上的水温升起来(约 15 秒)。冷车别急着干重活。',
      voice: '保持低油门怠速预热,看着水温表升起来。',
      check: (g, dt, st) => {
        const ok = g.m.running && g.m.throttle <= 3;
        st.warm = (st.warm || 0) + (ok ? dt : 0);
        return { done: st.warm > 15 && g.m.coolant > 45, progress: Math.min(1, st.warm / 15), hint: `水温 ${g.m.coolant.toFixed(0)}°C` };
      },
    },
    {
      text: `预热好了。把油门调到作业档(6~8 档):按 ${K('+')}。`,
      check: (g) => ({ done: g.m.throttle >= 6, hint: `油门 ${g.m.throttle} 档` }),
    },
    {
      text: `放下安全锁杆(解锁):按 ${K('Q')}。放下之后手柄才接通液压。`,
      check: (g) => !g.m.locked,
    },
    {
      text: (g) => `试一下:慢慢把动臂抬起来一点(${key(g, 'boom', 0)})。`,
      enter: (g, st) => (st.b0 = g.m.pose.boom),
      check: (g, dt, st) => g.m.pose.boom - st.b0 > 0.12,
    },
    {
      text: (g) => `现在练熄火。先把铲斗<b>平放到地面</b>上(${key(g, 'boom', 1)} 降动臂)。停机时工作装置不能悬在半空。`,
      voice: '现在练熄火。第一步,把铲斗放到地面上。',
      check: (g, dt, st) => ({ done: g.hold(st, 'h', g.bucketAbove < 0.12, 0.8, dt), hint: `铲斗离地 ${Math.max(0, g.bucketAbove).toFixed(2)} m` }),
    },
    {
      text: `油门调回最低(1 档):按 ${K('-')}。`,
      check: (g) => ({ done: g.m.throttle === 1, hint: `油门 ${g.m.throttle} 档` }),
    },
    {
      text: '<b>怠速运转 5 秒</b>,让涡轮增压器降温。(真机上是 3~5 分钟)',
      voice: '怠速运转一会儿,让涡轮增压器冷却。',
      check: (g, dt, st) => {
        st.idle = g.m.rpm < 1150 ? (st.idle || 0) + dt : 0;
        return { done: st.idle > 5, progress: Math.min(1, st.idle / 5) };
      },
    },
    {
      text: `抬起安全锁杆锁定:按 ${K('Q')}。`,
      check: (g) => g.m.locked,
    },
    {
      text: `钥匙拧到 OFF 熄火:按 ${K('E')}。`,
      check: (g) => g.m.key === 'off',
    },
  ],
  rules: { noHorn: 0, reliefHold: 0 },
};

// ── 第 3 课 认识手柄 ────────────────────────────────────────────────────
const joints = (g) => ({ b: g.m.pose.boom, a: g.m.pose.arm, k: g.m.pose.bucket });
const controls = {
  id: 'controls',
  kind: 'lesson',
  title: '第 3 课 · 认识手柄',
  subtitle: '四个基本动作:动臂、斗杆、铲斗、回转',
  brief:
    '挖掘机只有四个基本动作,分给左右两根先导手柄。国内绝大多数机器是 ISO 手法:左手前后管斗杆、左右管回转;右手前后管动臂、左右管铲斗。记住一个直觉:手柄推离身体,工作装置就往外、往下走。手柄控制的是流量(速度),不是位置 —— 推得越多动得越快,松手就停。',
  goals: ['分别把每个动作做到头', '学会听"憋缸"的声音'],
  setup(g) {
    g.rig.setMode('cab');
  },
  steps: [
    { text: `放下安全锁杆解锁:${K('Q')}。`, check: (g) => !g.m.locked },
    {
      text: (g) => `<b>动臂上升</b>:${key(g, 'boom', 0)}(右手柄往后拉)。一直抬到最高。`,
      check: (g) => g.m.pose.boom > BOOM.angleMax - 0.03,
    },
    {
      text: '到顶了还一直按着,会听到"吱——"的尖叫,那是<b>溢流阀</b>在泄压(憋缸)。听到就要松手。现在松开手柄。',
      voice: '到顶以后还一直推着手柄,会听到溢流阀的尖叫,这叫憋缸。听到就要松手。',
      check: (g, dt, st) => g.hold(st, 'h', Math.abs(g.cmds.boom) < 0.05, 1, dt),
    },
    {
      text: (g) => `<b>动臂下降</b>:${key(g, 'boom', 1)}(右手柄往前推)。放到斗齿离地 1 米以内。`,
      check: (g) => ({ done: g.tipAbove < 1, hint: `斗齿离地 ${g.tipAbove.toFixed(2)} m` }),
    },
    {
      text: (g) => `<b>斗杆伸出</b>:${key(g, 'arm', 1)}(左手柄往前推)。伸到最远。`,
      check: (g) => g.m.pose.arm > ARM.angleMax - 0.04,
    },
    {
      text: (g) => `<b>斗杆收回</b>:${key(g, 'arm', 0)}(左手柄往后拉)。收到最近。注意别让铲斗碰到履带和驾驶室 —— 必要时抬一下动臂。`,
      check: (g) => g.m.pose.arm < ARM.angleMin + 0.1,
    },
    {
      text: (g) => `<b>收斗</b>(挖掘):${key(g, 'bucket', 0)}(右手柄往左)。收到底。`,
      check: (g) => g.m.pose.bucket < BUCKET.angleMin + 0.05,
    },
    {
      text: (g) => `<b>卸料</b>(张斗):${key(g, 'bucket', 1)}(右手柄往右)。张到底。`,
      check: (g) => g.m.pose.bucket > BUCKET.angleMax - 0.05,
    },
    {
      text: `<b>向左回转</b> 90°:${K('A')}(左手柄往左)。上车有十几吨重,起步和停下都会"荡"一下 —— <b>提前松手</b>,让它滑到位。`,
      voice: '向左回转九十度。上车很重,要提前松手,让它自己滑到位。',
      check: (g) => ({ done: g.swingDeg() < -80 && g.swingDeg() > -100 && g.stopped(), hint: `回转角 ${Math.abs(g.swingDeg()).toFixed(0)}° ${g.swingDeg() < 0 ? '左' : '右'}(目标 左 90°±10°,停稳)` }),
    },
    {
      text: `<b>向右回转</b>回到正前方:${K('D')}。停在 ±5° 以内。`,
      check: (g) => ({ done: Math.abs(g.swingDeg()) < 5 && g.stopped(), hint: `回转角 ${g.swingDeg().toFixed(0)}°` }),
    },
    {
      text: `最后试试<b>微操</b>:按住 ${K('Shift')} 再按方向键,手柄最多只推三分之一。精细对位、平地时就这么用。(有游戏手柄的话,摇杆本身就能半推。)按住 Shift 抬一下动臂。`,
      enter: (g, st) => (st.b0 = g.m.pose.boom),
      check: (g, dt, st) => g.input._shift && g.m.pose.boom - st.b0 > 0.05,
    },
  ],
  rules: { noHorn: 0, reliefHold: 0 },
};

// ── 第 4 课 斗齿点位 ────────────────────────────────────────────────────
const touch = {
  id: 'touch',
  kind: 'lesson',
  title: '第 4 课 · 斗齿点位(复合动作)',
  subtitle: '让斗齿尖精确地碰到目标',
  brief:
    '用斗齿尖依次碰一下标杆顶上的黄球(碰到会变绿),但不能把杆子撞倒。这一课练的是"复合动作":两只手同时推,让斗齿走直线、走到你想去的地方。真正的效率全在复合动作里。',
  goals: ['碰到 4 个球', '不撞倒标杆'],
  setup(g) {
    g.rig.setMode('cab');
    g.m.setLock(false);
    g.custom.poles = [
      g.pole(7.5, 0, 1.2),
      g.pole(6.0, -3.5, 1.8),
      g.pole(8.5, 3.0, 0.8),
      g.pole(5.0, 4.5, 2.2),
    ];
  },
  steps: [
    {
      text: '依次碰 4 个黄球。技巧:先用<b>回转</b>对准方向,再用<b>斗杆</b>控制远近、<b>动臂</b>控制高低。接近时换 Shift 微操。看不清远近就按 Tab 打开侧视小窗。',
      voice: '用斗齿尖依次碰四个黄球。先回转对准方向,斗杆控制远近,动臂控制高低。',
      check: (g) => {
        const n = g.custom.poles.filter((p) => p.touched).length;
        const down = g.custom.poles.filter((p) => p.down).length;
        return { done: n + down >= 4 && n > 0, progress: n / 4, hint: `已碰到 ${n} / 4${down ? `,撞倒 ${down}` : ''}` };
      },
    },
  ],
  rules: { noHorn: 0 },
  score(g, res) {
    const n = g.custom.poles.filter((p) => p.touched).length;
    res.lines.push(['碰到的球', `${n} / 4`], ['用时', fmt(g.time)]);
    if (g.time > 180) res.score -= Math.min(15, Math.floor((g.time - 180) / 20));
    return res;
  },
};

// ── 第 5 课 行走 ────────────────────────────────────────────────────────
const travel = {
  id: 'travel',
  kind: 'lesson',
  title: '第 5 课 · 行走与转向',
  subtitle: '左右履带分开控制;驱动轮在哪边决定"前"是哪边',
  brief:
    '行走由两根行走操纵杆(带踏板)分别控制左右履带:R/F 是左履带前进/后退,T/G 是右履带。两根同推 = 直行;只推一根 = 绕另一条履带转;一推一拉 = 原地转。最关键的一点:推杆的"前"是朝引导轮的方向(驱动轮在后)。上车转了 180° 以后,推杆前进,车会朝你背后走!',
  goals: ['直行、单边转向、原地转向', '体会上车反向后的操纵'],
  layout: { flat: 0.8, clear: [0, 0, 30] },
  setup(g) {
    g.rig.setMode('cab');
    g.custom.line = g.marker(0x44dd66, 2.4, 16, 0);
    for (const z of [-2.6, 2.6]) for (const x of [4, 8, 12]) g.cone(x, z);
  },
  steps: [
    {
      text: (g) => `解锁 ${K('Q')},把工作装置收拢:斗杆收回、铲斗收起,铲斗离地 0.3~1 米。行走时重心越低越稳。`,
      check: (g) => ({ done: !g.m.locked && g.bucketAbove > 0.2 && g.bucketAbove < 1.1 && g.m.pose.arm < -1.8, hint: `铲斗离地 ${g.bucketAbove.toFixed(2)} m` }),
    },
    {
      text: `<b>先鸣笛</b> ${K('空格')},再同时按住 ${K('R')} ${K('T')} 两根行走杆直行,开到前方绿圈。别碰两边的路锥。`,
      voice: '先按喇叭,再同时推两根行走杆,直行到前方绿圈。',
      check: (g) => ({ done: g.m.position.x > 15, hint: `还有 ${Math.max(0, 16 - g.m.position.x).toFixed(1)} m` }),
    },
    { text: '松开行走杆,停车。', check: (g, dt, st) => g.hold(st, 'h', !g.m.travelling, 0.8, dt) },
    {
      text: `<b>单边转向</b>:只推右履带 ${K('T')},车会绕着左履带向左转。转 90°。`,
      enter: (g, st) => (st.h0 = g.headingDeg()),
      check: (g, dt, st) => ({ done: g.headingDeg() - st.h0 > 80, hint: `已转 ${(g.headingDeg() - st.h0).toFixed(0)}°` }),
    },
    {
      text: `<b>原地转向</b>:左履带后退 ${K('F')} + 右履带前进 ${K('T')},车绕中心原地转。再向左转 90°。原地转最省地方,但对地面破坏大。`,
      enter: (g, st) => (st.h0 = g.headingDeg()),
      check: (g, dt, st) => {
        if (g.m.trackVel[0] < -0.1 && g.m.trackVel[1] > 0.1) st.spin = true;
        return { done: st.spin && g.headingDeg() - st.h0 > 80 && !g.m.travelling, hint: `已转 ${(g.headingDeg() - st.h0).toFixed(0)}°` };
      },
    },
    {
      text: `把<b>上车回转 180°</b>(${K('A')} 或 ${K('D')}),让驾驶室朝向车尾。注意看,驱动轮(带齿的大轮子)现在在你前面了。`,
      check: (g) => ({ done: Math.abs(g.swingDeg()) > 165 && g.stopped(), hint: `回转角 ${Math.abs(g.swingDeg()).toFixed(0)}°` }),
    },
    {
      text: `现在同时推 ${K('R')} ${K('T')} 走 3 米,看看车往哪边走。`,
      voice: '现在推行走杆前进,看看车往哪边走。',
      enter: (g, st) => (st.p0 = g.m.position.clone()),
      check: (g, dt, st) => ({ done: g.m.position.distanceTo(st.p0) > 3, hint: '推杆"前进",车却朝你背后走 —— 真机上老手行走前一定先低头看一眼驱动轮在哪边。' }),
    },
    {
      text: '停车,把上车转回正前方(±15° 内)。',
      check: (g) => !g.m.travelling && Math.abs(g.swingDeg()) < 15 && g.stopped(),
    },
    {
      text: `按 ${K('V')} 切到<b>兔子档</b>(高速),开到蓝圈停下,再切回乌龟档。兔子档只在平地长距离转场用;工作面、坡道、过障碍一律乌龟档。`,
      enter: (g) => (g.custom.goal = g.marker(0x3399ff, 2.2, -2, 12)),
      check: (g) => {
        const d = Math.hypot(g.m.position.x + 2, g.m.position.z - 12);
        return { done: d < 2.2 && !g.m.travelling && !g.m.travelHi, hint: `距离目标 ${d.toFixed(1)} m${g.m.travelHi ? '(兔子档)' : ''}` };
      },
    },
  ],
};

// ── 第 6 课 挖掘 ────────────────────────────────────────────────────────
const DUMP6 = { x: 2, z: 8.5, r: 2.5 };
const dig = {
  id: 'dig',
  kind: 'lesson',
  title: '第 6 课 · 挖一斗土',
  subtitle: '插入 → 拖拉 → 收斗 → 提升 → 回转 → 卸料',
  brief:
    '一个标准挖掘循环:斗杆伸出、铲斗张开 → 动臂下放、斗齿以约 45° 插入土中 → 收斗杆的同时逐渐收斗,让斗齿沿弧线削土 → 装满后收斗兜住、提升动臂 → 回转到卸土点 → 张斗卸料。光把斗子按在土里是装不满的,斗齿得"走起来"削土。',
  goals: ['挖 3 斗,每斗 80% 以上', '卸在指定区域'],
  layout: { flat: 0.6, features: [{ type: 'pile', x: 7.5, z: 0, r: 4.5, h: 1.8 }] },
  setup(g) {
    g.rig.setMode('cab');
    g.m.setLock(false);
    g.custom.zone = g.marker(0xffbb22, DUMP6.r, DUMP6.x, DUMP6.z);
    g.custom.count = 0;
  },
  steps: [
    {
      text: (g) => `斗杆伸出(${key(g, 'arm', 1)})、铲斗张开(${key(g, 'bucket', 1)}),把斗齿对准前方的土堆。`,
      check: (g) => g.m.pose.arm > -1.3 && g.m.pose.bucket > -0.7,
    },
    {
      text: (g) => `放下动臂(${key(g, 'boom', 1)}),让斗齿扎进土里 10~20 cm。`,
      check: (g) => ({ done: g.m.tipDepth > 0.1, hint: `斗齿入土 ${Math.max(0, g.m.tipDepth).toFixed(2)} m` }),
    },
    {
      text: (g) => `<b>同时</b>收斗杆(${key(g, 'arm', 0)})和收斗(${key(g, 'bucket', 0)}),斗齿沿弧线往回削。插得太深会憋住,太浅刮不到土。装到 80% 以上。`,
      voice: '同时收斗杆和收铲斗,让斗齿沿着弧线往回削土。',
      check: (g) => ({ done: g.m.bucketLoad >= 0.8 * BUCKET.capacity, progress: g.m.bucketLoad / BUCKET.capacity / 0.8, hint: `斗内 ${(g.m.bucketLoad * 100).toFixed(0)}%` }),
    },
    {
      text: (g) => `装满了!<b>收斗兜住</b>,再抬动臂(${key(g, 'boom', 0)})把斗子提出来,离地 1.5 米以上。`,
      check: (g) => ({ done: g.tipAbove > 1.5 && g.m.bucketLoad > 0.6, hint: g.m.spilling ? '斗口朝下了,土在往外撒!收斗!' : `离地 ${g.tipAbove.toFixed(1)} m` }),
    },
    {
      text: `回转到右侧的<b>黄色圈</b>上方,张斗卸土。回转要提前松手。`,
      enter: (g, st) => (st.v0 = g.groundVolume((x, z) => Math.hypot(x - DUMP6.x, z - DUMP6.z) < DUMP6.r)),
      check: (g, dt, st) => {
        const v = g.groundVolume((x, z) => Math.hypot(x - DUMP6.x, z - DUMP6.z) < DUMP6.r) - st.v0;
        if (g.m.bucketLoad < 0.08 && v > 0.5) {
          g.custom.count++;
          return true;
        }
        return { hint: `卸进黄圈 ${v.toFixed(2)} m³` };
      },
    },
    {
      text: '再挖两斗,每斗都要装到 80% 以上、卸进黄圈。',
      enter: (g, st) => {
        st.v0 = g.groundVolume((x, z) => Math.hypot(x - DUMP6.x, z - DUMP6.z) < DUMP6.r);
        st.n = 0;
        st.full = false;
      },
      check: (g, dt, st) => {
        if (g.m.bucketLoad >= 0.8) st.full = true;
        const v = g.groundVolume((x, z) => Math.hypot(x - DUMP6.x, z - DUMP6.z) < DUMP6.r);
        if (st.full && g.m.bucketLoad < 0.08 && v - st.v0 > 0.5) {
          st.n++;
          st.full = false;
          st.v0 = v;
          g.sound.ding();
        }
        if (!st.full && g.m.bucketLoad < 0.08 && v - st.v0 > 0.3) st.v0 = v; // 没装满就倒了,不算
        return { done: st.n >= 2, progress: st.n / 2, hint: `已完成 ${st.n} / 2 斗` };
      },
    },
  ],
  score(g, res) {
    res.lines.push(['用时', fmt(g.time)], ['3 斗循环平均', `${(g.time / 3).toFixed(0)} 秒/斗`]);
    return res;
  },
};

// ── 第 7 课 挖沟 ────────────────────────────────────────────────────────
const TR = { cx: 7.5, cz: 0, hl: 3, hw: 0.5, depth: 1.2 };
const trench = {
  id: 'trench',
  kind: 'lesson',
  title: '第 7 课 · 挖沟',
  subtitle: '按放线挖到设计深度,沟底平、沟壁直',
  brief:
    '沿地上的白灰线挖一条宽约 1 m、深 1.2 m 的沟。要点:一层一层往下挖;沟底要平,靠"斗杆往回收的同时动臂慢慢往下压"走出直线;挖出来的土堆在<b>左侧</b>,离沟边至少 1 米 —— 太近了土的重量会把沟壁压塌。',
  goals: ['平均深度 1.2 m', '沟底起伏 ±10 cm', '弃土离沟边 ≥ 1 m'],
  layout: { flat: 0.9, clear: [0, 0, 20] },
  setup(g) {
    g.rig.setMode('cab');
    g.m.setLock(false);
    g.layout(TR.cx, TR.cz, TR.hl, TR.hw);
    g.custom.spoilZone = g.marker(0xffbb22, 2.4, 5.5, -4.5, false);
  },
  update(g) {
    // 弃土太靠近沟边
    const near = g.groundVolume((x, z) => Math.abs(x - TR.cx) < TR.hl + 1 && Math.abs(z - TR.cz) < TR.hw + 1 && Math.abs(z - TR.cz) > TR.hw * 0.8);
    if (near > 0.6 * ((g.custom.nearWarn || 0) + 1)) {
      g.custom.nearWarn = (g.custom.nearWarn || 0) + 1;
      g.addPenalty('spoilNear', 5, '弃土堆在沟边', '挖出来的土至少离沟边 1 m,否则沟壁受压会塌方 —— 沟里有人时这是致命的。');
    }
  },
  steps: [
    {
      text: '先挖第一层,把整条沟挖下去 30 cm。从远端开始,往自己这边一斗一斗拉过来。土卸到左边黄圈。',
      voice: '先挖第一层,深三十厘米。从远端开始往回挖,土卸到左边的黄圈。',
      check: (g) => {
        const d = g.regionDepth(TR.cx, TR.cz, TR.hl, TR.hw * 0.8);
        return { done: d.avg > 0.3, progress: d.avg / 0.3, hint: `平均深度 ${d.avg.toFixed(2)} m` };
      },
    },
    {
      text: '继续一层一层往下挖,挖到 1.2 m。可以按 C 切到侧视或俯视检查。',
      check: (g) => {
        const d = g.regionDepth(TR.cx, TR.cz, TR.hl, TR.hw * 0.8);
        return { done: d.avg > 1.12, progress: d.avg / 1.2, hint: `平均深度 ${d.avg.toFixed(2)} / 1.2 m` };
      },
    },
    {
      text: (g) => `修沟底:把高的地方刮平,沟底起伏控制在 ±10 cm。斗底放平,${key(g, 'arm', 0)} 收斗杆的同时动臂配合微调(按住 Shift)。`,
      check: (g) => {
        const d = g.regionDepth(TR.cx, TR.cz, TR.hl - 0.3, TR.hw * 0.7);
        return { done: d.sd < 0.1 && d.avg > 1.1 && d.avg < 1.4, progress: clamp(1 - (d.sd - 0.1) / 0.3, 0, 1), hint: `平均 ${d.avg.toFixed(2)} m,起伏 ±${(d.sd * 100).toFixed(0)} cm` };
      },
    },
  ],
  score(g, res) {
    const d = g.regionDepth(TR.cx, TR.cz, TR.hl - 0.3, TR.hw * 0.7);
    res.lines.push(['平均深度', `${d.avg.toFixed(2)} m`], ['沟底起伏', `±${(d.sd * 100).toFixed(0)} cm`], ['用时', fmt(g.time)]);
    if (d.avg > 1.45) res.score -= 10; // 超挖
    return res;
  },
};

// ── 第 8 课 装车 ────────────────────────────────────────────────────────
// 车厢一头朝着挖掘面、车头朝后 —— 回转装车时斗子先到车厢,不会经过驾驶室
const TRUCK8 = { x: 1.0, z: -8, h: Math.PI };
const loading = {
  id: 'loading',
  kind: 'lesson',
  title: '第 8 课 · 装车',
  subtitle: '回转定位、低位卸料、均匀装载',
  brief:
    '从前方土堆挖土装进左侧的自卸车(车厢朝着你、车头朝后)。规矩:① 斗子绝不从驾驶室上方过 ② 先把动臂举过厢板再回转 ③ 斗子贴近车厢再张斗,别从高处砸 ④ 先装车厢前部、再装后部,装得均匀 ⑤ 装完按一声喇叭通知司机开走。',
  goals: ['装到 6 m³', '不撞车、不过车头、撒料少'],
  layout: { flat: 0.7, features: [{ type: 'pile', x: 7.5, z: 0, r: 5, h: 2.2 }] },
  setup(g) {
    g.rig.setMode('cab');
    g.m.setLock(false);
    g.truckArrive(TRUCK8.x, TRUCK8.z, TRUCK8.h);
  },
  steps: [
    {
      text: '自卸车正在进场。听到倒车喇叭"嘀——嘀——"了吗?等它停稳。趁这时间先挖好一斗。',
      check: (g) => g.truck.parked,
    },
    {
      text: '装车:挖土 → 提动臂过厢板 → 向左回转 → 斗子贴近车厢 → 张斗。装到 6 m³。先装前部(靠驾驶室那头),再装后部。',
      voice: '开始装车。先装车厢前部,再装后部。斗子不要从驾驶室上方经过。',
      check: (g) => ({ done: g.truck.load >= 6, progress: g.truck.load / 6, hint: `车厢 ${g.truck.load.toFixed(1)} / 6 m³,撒在外面 ${g.stats.truckSpill.toFixed(2)} m³` }),
    },
    {
      text: `装好了。按一声喇叭 ${K('空格')},通知司机开走。`,
      check: (g) => g.truck.state === 'leaving' || g.truck.state === 'hidden',
    },
  ],
  onEvent(g, e) {
    if (e === 'horn' && g.truck.parked && g.truck.load > 3) g.truck.leave();
  },
  score(g, res) {
    const bal = g.truck.balance();
    res.lines.push(['装载量', `${g.truck.load.toFixed(1)} m³`], ['前后均匀度', `${(bal * 100).toFixed(0)}%`], ['撒料', `${g.stats.truckSpill.toFixed(2)} m³`], ['用时', fmt(g.time)]);
    if (bal < 0.7) res.score -= 5;
    return res;
  },
};

// ── 第 9 课 平整 ────────────────────────────────────────────────────────
const GR = { x: 8, z: 0, half: 2.5 };
const grading = {
  id: 'grading',
  kind: 'lesson',
  title: '第 9 课 · 平整场地',
  subtitle: '挖机手的基本功:斗底当刮板',
  brief:
    '把青色方框里的地刮平到设计标高(高程桩上的红色刻度)。先"粗平"削掉土包,再"精平"。平地是拉出来的:铲斗放平、斗底贴地,斗杆往回收的同时动臂配合上下微调,让斗刃走一条水平线。这一课建议把油门调小、按住 Shift 微操。',
  goals: ['粗平:最高点不高出 15 cm', '精平:起伏 ±5 cm(均方根)'],
  layout: {
    flat: 0.95,
    features: [
      { type: 'mound', x: 7.2, z: -1.2, r: 1.6, h: 0.5 },
      { type: 'mound', x: 9.2, z: 1.2, r: 1.4, h: 0.4 },
      { type: 'mound', x: 8.5, z: -1.6, r: 1.0, h: 0.3 },
      { type: 'pit', x: 7, z: 1.4, hx: 0.5, hz: 0.5, depth: 0.25 },
    ],
  },
  setup(g) {
    g.rig.setMode('cab');
    g.m.setLock(false);
    g.m.setThrottle(5);
    const b = g.terrain.baseRegion(GR.x, GR.z, GR.half, GR.half);
    g.custom.y = b.reduce((s, v) => s + v, 0) / b.length;
    g.gradeStakes(GR.x, GR.z, GR.half, g.custom.y);
    g.designY = g.custom.y;
  },
  steps: [
    {
      text: '粗平:先把几个土包削下来,削下的土往低处推或者挖走卸到旁边。',
      check: (g) => {
        const r = g.regionRms(GR.x, GR.z, GR.half, GR.half, g.custom.y);
        return { done: r.hi < 0.15, progress: clamp(1 - (r.hi - 0.15) / 0.4, 0, 1), hint: `最高点高出 ${(r.hi * 100).toFixed(0)} cm` };
      },
    },
    {
      text: '精平:斗底放平贴地,来回拉刮。起伏(均方根)要到 ±5 cm。',
      check: (g) => {
        const r = g.regionRms(GR.x, GR.z, GR.half, GR.half, g.custom.y);
        return { done: r.rms < 0.05, progress: clamp(1 - (r.rms - 0.05) / 0.15, 0, 1), hint: `起伏 ±${(r.rms * 100).toFixed(1)} cm(目标 ±5)` };
      },
    },
  ],
  score(g, res) {
    const r = g.regionRms(GR.x, GR.z, GR.half, GR.half, g.custom.y);
    res.lines.push(['起伏(均方根)', `±${(r.rms * 100).toFixed(1)} cm`], ['用时', fmt(g.time)]);
    return res;
  },
};

// ── 第 10 课 坡道 ───────────────────────────────────────────────────────
const RAMP = { type: 'ramp', x0: 8, x1: 17, x2: 23, x3: 32, zc: 0, w: 2.6, h: 2.6 };
const slope = {
  id: 'slope',
  kind: 'lesson',
  title: '第 10 课 · 上下坡',
  subtitle: '低速、直线、铲斗贴近地面',
  brief:
    '爬过前方的土坡(坡度约 16°)。坡道规矩:① 用乌龟档低速 ② 直线上下,不在坡上转向 ③ 不在坡上回转 ④ 铲斗离地 20~50 cm 跟着走 —— 万一打滑,马上把斗子放下去撑住 ⑤ 上坡时驱动轮在后。',
  goals: ['翻过土坡到对面', '不违反坡道规矩'],
  layout: { flat: 0.9, clear: [0, 0, 6], features: [RAMP] },
  setup(g) {
    g.rig.setMode('cab');
    g.m.setLock(false);
    g.marker(0x44dd66, 2.4, 35, 0);
    for (const x of [9, 16, 24, 31]) for (const z of [-3.6, 3.6]) g.cone(x, z);
  },
  update(g, dt) {
    const x = g.m.position.x;
    const onSlope = (x > RAMP.x0 - 1 && x < RAMP.x1) || (x > RAMP.x2 && x < RAMP.x3 + 1);
    if (!onSlope) {
      g.custom.h0 = g.m.heading;
      return;
    }
    if (g.m.travelHi && g.m.travelling) g.deduct('slopeHi', 8);
    if (Math.abs(g.m.heading - (g.custom.h0 ?? g.m.heading)) > 10 * DEG) {
      g.custom.h0 = g.m.heading;
      g.addPenalty('slopeTurn', 5, '在坡上转向', '坡上转向履带容易打滑侧滑,甚至翻车。要在坡下对正方向再直线上坡。');
    }
    if (Math.abs(g.m.swingVel) > 0.05) g.deduct('slopeSwing', 8);
    if (g.m.travelling && (g.bucketAbove > 1.2 || g.bucketAbove < 0.05)) g.deduct('slopeBucket', 10);
  },
  steps: [
    {
      text: (g) => `解锁,确认乌龟档(仪表上显示"龟"),铲斗离地 20~50 cm。鸣笛,直线开上坡。`,
      check: (g) => ({ done: g.m.position.x > RAMP.x1 + 0.5, hint: `铲斗离地 ${g.bucketAbove.toFixed(2)} m${g.m.travelHi ? ' · 现在是兔子档!按 V' : ''}` }),
    },
    { text: '到坡顶平台了,停一下。', check: (g, dt, st) => g.hold(st, 'h', !g.m.travelling, 1, dt) },
    {
      text: '直线下坡,铲斗保持离地 20~50 cm,慢慢开到坡下的绿圈。',
      check: (g) => ({ done: g.m.position.x > 33.5 && !g.m.travelling, hint: `铲斗离地 ${g.bucketAbove.toFixed(2)} m` }),
    },
  ],
  rules: {},
};

// ═══════════════════════════════════════════════════════════════════════
//  考证模拟
// ═══════════════════════════════════════════════════════════════════════
const EX = { start: [-35, 0], end: [4, 0] };
const exam = {
  id: 'exam',
  kind: 'exam',
  title: '考证模拟 · 实操考核',
  subtitle: '起动 → 场地驾驶 → 定点触球 → 挖掘装车 → 平整 → 收车',
  brief:
    '按挖掘机操作证实操考核的项目编排,满分 100 分,80 分合格。出现挖断管线、撞人、倾翻、撞车头直接判不合格。考官不会再提示操作方法 —— 全靠你自己。',
  goals: ['总分 ≥ 80', '总时限 15 分钟'],
  passScore: 80,
  timeLimit: 900,
  layout: {
    flat: 0.9,
    clear: [-14, 0, 22],
    features: [{ type: 'pile', x: 12, z: 0, r: 4, h: 2.0 }],
  },
  setup(g) {
    g.m.placeAt(EX.start[0], EX.start[1], 0, 0);
    g.m.stopEngineNow();
    g.m.parkPose();
    g.m.setThrottle(5);
    g.m.coolant = 50;
    g.rig.setMode('cab');
    // S 弯:两排路锥之间
    const cones = [];
    for (let i = 0; i <= 12; i++) {
      const x = -26 + i * 2.2;
      const zc = Math.sin((i / 12) * Math.PI * 2) * 3.2;
      cones.push(g.cone(x, zc - 2.3), g.cone(x, zc + 2.3));
    }
    g.custom.cones = cones;
    g.custom.endZone = g.marker(0x44dd66, 2.5, EX.end[0], EX.end[1]);
    g.custom.startScore = { lock: false, throttle: false, horn: false };
  },
  steps: [
    {
      text: '【项目一 起动】按规范起动发动机,并解锁。(10 分)',
      check: (g, dt, st) => {
        const s = g.custom.startScore;
        if (g.m.key === 'off' || (g.m.engine !== 'running' && g.m.key !== 'start')) {
          if (g.m.locked) s.lock = true;
          if (g.m.throttle <= 3) s.throttle = true;
          if (g.m.time - g.m.lastHorn < 3) s.horn = true;
        }
        if (g.m.engine === 'crank' && !st.judged) {
          st.judged = true;
          if (!s.throttle) g.addPenalty('ex1', 4, '起动时油门未在低速位');
          if (!s.horn) g.addPenalty('ex1h', 3, '起动前未鸣笛');
        }
        return g.m.running && !g.m.locked;
      },
    },
    {
      text: '【项目二 场地驾驶】按 S 形路线通过路锥,开到终点绿圈停车。不得碰倒路锥。(25 分,限时 3 分钟)',
      enter: (g, st) => (st.t0 = g.time),
      check: (g, dt, st) => {
        const d = Math.hypot(g.m.position.x - EX.end[0], g.m.position.z - EX.end[1]);
        if (g.time - st.t0 > 180 && !st.late) {
          st.late = true;
          g.addPenalty('ex2t', 10, '场地驾驶超时');
        }
        return { done: d < 2.5 && !g.m.travelling, hint: `距终点 ${d.toFixed(1)} m · 用时 ${fmt(g.time - st.t0)}` };
      },
    },
    {
      text: '【项目三 定点触球】用斗齿依次碰到 3 个黄球,不得碰倒标杆。(15 分)',
      enter: (g) => {
        const [x, z] = [g.m.position.x, g.m.position.z];
        g.custom.poles = [g.pole(x + 6.5, z - 3.5, 1.4), g.pole(x + 8, z + 3.2, 2.0), g.pole(x + 5, z + 4.5, 0.9)];
      },
      check: (g) => {
        const P = g.custom.poles;
        const n = P.filter((p) => p.touched).length;
        const down = P.filter((p) => p.down).length;
        return { done: n + down >= 3, progress: n / 3, hint: `${n} / 3` };
      },
    },
    {
      text: '【项目四 挖掘装车】从前方土堆取土,装满左侧自卸车 5 m³ 以上,装完鸣笛放车。(30 分,限时 4 分钟)',
      enter: (g, st) => {
        for (const p of g.custom.poles) g.removeProp(p);
        const [x, z] = [g.m.position.x, g.m.position.z];
        g.truckArrive(x + 1.0, z - 8, Math.PI);
        st.t0 = g.time;
      },
      check: (g, dt, st) => {
        if (g.time - st.t0 > 240 && !st.late) {
          st.late = true;
          g.addPenalty('ex4t', 10, '装车超时');
        }
        const left = g.truck.state === 'leaving' || g.truck.state === 'hidden';
        if (left && g.truck.load < 5 && !st.short) {
          st.short = true;
          g.addPenalty('ex4s', 10, '装载量不足 5 m³');
        }
        return { done: left, progress: g.truck.load / 5, hint: `车厢 ${g.truck.load.toFixed(1)} m³` };
      },
    },
    {
      text: '【项目五 平整】把右侧青色方框刮平,起伏 ±8 cm。(10 分,完成后按 Enter 交卷)',
      enter: (g, st) => {
        const x = g.m.position.x + 7;
        const z = g.m.position.z + 6.5;
        g.custom.gr = { x, z, half: 2 };
        // 在方框里弄出一些起伏
        for (const [dx, dz, h] of [
          [-0.8, -0.6, 0.35],
          [0.9, 0.7, 0.3],
        ])
          g.terrain.deposit(x + dx, z + dz, h, 1.1);
        const b = g.terrain.sampleRegion(x, z, 2, 2);
        g.custom.gy = b.reduce((s, v) => s + v, 0) / b.length - 0.08;
        g.gradeStakes(x, z, 2, g.custom.gy);
        g.designY = g.custom.gy;
        st.confirm = false;
        g.custom.onConfirm = () => (st.confirm = true);
      },
      check: (g, dt, st) => {
        const G = g.custom.gr;
        const r = g.regionRms(G.x, G.z, G.half, G.half, g.custom.gy);
        if (st.confirm) {
          const pts = r.rms < 0.08 ? 0 : r.rms < 0.15 ? 5 : 10;
          if (pts) g.addPenalty('ex5', pts, `平整不达标(±${(r.rms * 100).toFixed(0)} cm)`);
          g.designY = null;
          return true;
        }
        return { hint: `起伏 ±${(r.rms * 100).toFixed(1)} cm · 按 Enter 交卷` };
      },
    },
    {
      text: '【项目六 收车】按规范停机熄火。(10 分)',
      enter: (g, st) => (st.s = { bucket: false, throttle: false, idle: 0, lock: false }),
      check: (g, dt, st) => {
        const s = st.s;
        if (g.m.running) {
          if (g.bucketAbove < 0.15) s.bucket = true;
          if (g.m.throttle <= 2) s.throttle = true;
          if (g.m.rpm < 1150) s.idle += dt;
          s.lock = g.m.locked;
        }
        if (g.m.key === 'off') {
          if (!s.bucket) g.addPenalty('ex6a', 3, '熄火时铲斗未落地');
          if (!s.throttle) g.addPenalty('ex6b', 2, '熄火前未降油门');
          if (s.idle < 3) g.addPenalty('ex6c', 2, '熄火前未怠速冷却');
          if (!s.lock) g.addPenalty('lockedLeave');
          return true;
        }
        return false;
      },
    },
  ],
  onEvent(g, e) {
    if (e === 'horn' && g.truck.parked && g.truck.load > 2) g.truck.leave();
  },
  rules: { hitTruckCab: 30, overCab: 5, knockCone: 3, knockPole: 5, noHorn: 5 },
  score(g, res) {
    res.lines.push(['用时', fmt(g.time)], ['装车量', `${g.truck.load.toFixed(1)} m³`]);
    if (res.penalties.some((p) => p.code === 'hitTruckCab')) res.fatal = '铲斗撞到自卸车驾驶室';
    return res;
  },
};

// ═══════════════════════════════════════════════════════════════════════
//  工地任务
// ═══════════════════════════════════════════════════════════════════════
const PIT = { x: 8, z: 0, hx: 2.8, hz: 2.2, depth: 1.0 };
const jobPit = {
  id: 'pit',
  kind: 'job',
  title: '任务 1 · 基坑开挖装车',
  subtitle: '挖一个 5.6×4.4×1.0 m 的设备基坑,土方外运',
  brief:
    '甲方要在这里做一个设备基础。按放线挖到 1.0 m 深,土全部装车外运。自卸车会一辆接一辆地来,装满一辆鸣笛放走,下一辆马上到。注意:干活期间会有施工员从机器后面经过。',
  goals: ['坑底平均深 1.0 m', '土方装车外运', '安全第一'],
  timeLimit: 1200,
  layout: { flat: 0.85, clear: [0, 0, 18] },
  setup(g) {
    g.rig.setMode('cab');
    g.m.setLock(false);
    g.layout(PIT.x, PIT.z, PIT.hx, PIT.hz);
    g.truckArrive(1.0, -8, Math.PI);
    g.custom.nextTruckAt = null;
    g.custom.worker = g.worker(
      [
        [-14, 6],
        [-2, 4.5],
        [-1.5, -3],
        [-12, -6],
      ],
      1.0
    );
    g.custom.worker.active = false;
    g.custom.workerAt = 75 + Math.random() * 40;
  },
  update(g) {
    const w = g.custom.worker;
    if (!w.active && g.time > g.custom.workerAt) {
      w.active = true;
      g.say('注意,有施工员从你后面经过。', true);
    }
    if (w.active && w.s <= 0.01 && w.dir === 1 && g.time > g.custom.workerAt + 30) w.active = false;
    w.group.visible = w.active;
    if (g.custom.nextTruckAt && g.time > g.custom.nextTruckAt) {
      g.custom.nextTruckAt = null;
      g.truckArrive(1.0, -8, Math.PI);
    }
  },
  onTruck(g, e) {
    if (e === 'gone') {
      g.stats.trucksDone++;
      g.stats.truckLoads += g.custom.lastLoad || 0;
      g.custom.nextTruckAt = g.time + 6;
    }
    if (e === 'leaving') g.custom.lastLoad = g.truck.load;
  },
  onEvent(g, e) {
    if (e === 'horn' && g.truck.parked && g.truck.load > 2) g.truck.leave();
  },
  steps: [
    {
      text: '按放线开挖基坑到 1.0 m 深,土装车。装满一车(约 6~7 m³)鸣笛放车。坑挖好后按 Enter 验收。',
      enter: (g, st) => (g.custom.onConfirm = () => (st.confirm = true)),
      check: (g, dt, st) => {
        const d = g.regionDepth(PIT.x, PIT.z, PIT.hx - 0.3, PIT.hz - 0.3);
        if (st.confirm) return true;
        return { progress: d.avg / PIT.depth, hint: `坑深 ${d.avg.toFixed(2)} m(起伏 ±${(d.sd * 100).toFixed(0)} cm)· 已外运 ${g.stats.trucksDone} 车 · Enter 验收` };
      },
    },
  ],
  score(g, res) {
    const d = g.regionDepth(PIT.x, PIT.z, PIT.hx - 0.3, PIT.hz - 0.3);
    const vol = d.avg * (PIT.hx * 2) * (PIT.hz * 2);
    const hauled = g.stats.truckLoads + (g.truck.state === 'waiting' ? 0 : 0);
    const depthOk = d.avg > 0.9 && d.avg < 1.2;
    if (!depthOk) res.score -= 25;
    if (d.sd > 0.15) res.score -= 10;
    const onGround = g.groundVolume((x, z) => Math.abs(x - PIT.x) < 8 && Math.abs(z - PIT.z) < 8);
    if (onGround > 3) res.score -= 10;
    res.money = Math.round(Math.max(0, vol * 45 + hauled * 30 - res.penalties.reduce((s, p) => s + p.pts * 20, 0)));
    res.lines.push(['坑深', `${d.avg.toFixed(2)} m`], ['坑底起伏', `±${(d.sd * 100).toFixed(0)} cm`], ['外运', `${g.stats.trucksDone} 车 / ${hauled.toFixed(1)} m³`], ['用时', fmt(g.time)], ['结算', `¥ ${res.money}`]);
    return res;
  },
};

const TJ = { x0: 3.5, x1: 12.5, z: 0, hw: 0.45, depth: 1.3, gas: 9.0 };
const jobTrench = {
  id: 'pipeline',
  kind: 'job',
  title: '任务 2 · 管沟开挖',
  subtitle: '给排水管挖沟 —— 中途横穿一条燃气管',
  brief:
    '按放线挖一条 0.9 m 宽、1.3 m 深的管沟,弃土放在左侧。放线中间有一条<b>在役燃气管</b>横穿(地面有黄色警示桩,埋深约 0.9 m)。规定:管线两侧各 1 m 范围内严禁机械开挖,留给工人人工探挖。挖断燃气管 = 任务失败。',
  goals: ['两段管沟挖到 1.3 m', '燃气管两侧 1 m 不动', '弃土离沟边 ≥ 1 m'],
  timeLimit: 1200,
  layout: { flat: 0.9, clear: [0, 0, 20] },
  setup(g) {
    g.rig.setMode('cab');
    g.m.setLock(false);
    g.layout((TJ.x0 + TJ.x1) / 2, TJ.z, (TJ.x1 - TJ.x0) / 2, TJ.hw);
    g.pipe(TJ.gas, -6, TJ.gas, 6, 0.9);
  },
  steps: [
    {
      text: '先挖靠近自己这一段(燃气管警示桩以内),挖到 1.3 m。',
      check: (g) => {
        const d = g.regionDepth((TJ.x0 + TJ.gas - 1) / 2, TJ.z, (TJ.gas - 1 - TJ.x0) / 2 - 0.2, TJ.hw * 0.8);
        return { done: d.avg > 1.2, progress: d.avg / 1.3, hint: `近段 ${d.avg.toFixed(2)} m` };
      },
    },
    {
      text: '再挖燃气管那一侧的远段(管线外 1 m 以外),同样 1.3 m。管线两侧各 1 m 不许动。挖完按 Enter 验收。',
      enter: (g, st) => (g.custom.onConfirm = () => (st.confirm = true)),
      check: (g, dt, st) => {
        const d = g.regionDepth((TJ.gas + 1 + TJ.x1) / 2, TJ.z, (TJ.x1 - TJ.gas - 1) / 2 - 0.2, TJ.hw * 0.8);
        if (st.confirm) return true;
        return { progress: d.avg / 1.3, hint: `远段 ${d.avg.toFixed(2)} m · Enter 验收` };
      },
    },
  ],
  score(g, res) {
    const near = g.regionDepth((TJ.x0 + TJ.gas - 1) / 2, TJ.z, (TJ.gas - 1 - TJ.x0) / 2 - 0.2, TJ.hw * 0.8);
    const far = g.regionDepth((TJ.gas + 1 + TJ.x1) / 2, TJ.z, (TJ.x1 - TJ.gas - 1) / 2 - 0.2, TJ.hw * 0.8);
    const guard = g.regionDepth(TJ.gas, TJ.z, 0.9, TJ.hw);
    if (near.avg < 1.15) res.score -= 20;
    if (far.avg < 1.15) res.score -= 20;
    if (guard.avg > 0.4) res.score -= 20;
    const spoilNear = g.groundVolume((x, z) => x > TJ.x0 - 1 && x < TJ.x1 + 1 && Math.abs(z) < TJ.hw + 1);
    if (spoilNear > 1) res.score -= 10;
    res.money = Math.round(Math.max(0, (near.avg + far.avg) * 400 - res.penalties.reduce((s, p) => s + p.pts * 20, 0)));
    res.lines.push(['近段深度', `${near.avg.toFixed(2)} m`], ['远段深度', `${far.avg.toFixed(2)} m`], ['管线保护区扰动', `${guard.avg.toFixed(2)} m`], ['用时', fmt(g.time)], ['结算', `¥ ${res.money}`]);
    return res;
  },
};

const PAD = { x: 8.5, z: 0, half: 3.2 };
const jobPad = {
  id: 'pad',
  kind: 'job',
  title: '任务 3 · 场地平整',
  subtitle: '6.4×6.4 m 的硬化地坪基层',
  brief: '这块地要打混凝土地坪,基层要平。把方框刮平到设计标高,起伏越小结算越高。场地比第 9 课大、土包更多,可以挪机。',
  goals: ['起伏 ±5 cm 以内满分'],
  timeLimit: 1200,
  layout: {
    flat: 0.95,
    features: [
      { type: 'mound', x: 7, z: -2, r: 1.8, h: 0.6 },
      { type: 'mound', x: 10.5, z: 1.5, r: 1.6, h: 0.5 },
      { type: 'mound', x: 8, z: 2.4, r: 1.2, h: 0.35 },
      { type: 'pit', x: 10, z: -2, hx: 0.6, hz: 0.6, depth: 0.3 },
      { type: 'mound', x: 6.2, z: 1, r: 1, h: 0.3 },
    ],
  },
  setup(g) {
    g.rig.setMode('cab');
    g.m.setLock(false);
    const b = g.terrain.baseRegion(PAD.x, PAD.z, PAD.half, PAD.half);
    g.custom.y = b.reduce((s, v) => s + v, 0) / b.length;
    g.gradeStakes(PAD.x, PAD.z, PAD.half, g.custom.y);
    g.designY = g.custom.y;
  },
  steps: [
    {
      text: '刮平方框,完成后按 Enter 验收。',
      enter: (g, st) => (g.custom.onConfirm = () => (st.confirm = true)),
      check: (g, dt, st) => {
        const r = g.regionRms(PAD.x, PAD.z, PAD.half, PAD.half, g.custom.y);
        if (st.confirm) return true;
        return { progress: clamp(1 - (r.rms - 0.05) / 0.2, 0, 1), hint: `起伏 ±${(r.rms * 100).toFixed(1)} cm · Enter 验收` };
      },
    },
  ],
  score(g, res) {
    const r = g.regionRms(PAD.x, PAD.z, PAD.half, PAD.half, g.custom.y);
    res.score -= Math.round(clamp((r.rms - 0.05) * 300, 0, 60));
    res.money = Math.round(Math.max(0, 1200 * clamp(1 - (r.rms - 0.03) / 0.2, 0, 1) - res.penalties.reduce((s, p) => s + p.pts * 20, 0)));
    res.lines.push(['起伏(均方根)', `±${(r.rms * 100).toFixed(1)} cm`], ['用时', fmt(g.time)], ['结算', `¥ ${res.money}`]);
    return res;
  },
};

// ═══════════════════════════════════════════════════════════════════════
//  自由练习
// ═══════════════════════════════════════════════════════════════════════
const free = {
  id: 'free',
  kind: 'free',
  title: '自由练习',
  subtitle: '土堆、自卸车、标杆,随便玩',
  brief: '没有考核,没有时限。前方有土堆,左侧有自卸车(装满后鸣笛放走,会再来一辆),右侧有几根标杆。X 键可以一键收拢工作装置。',
  goals: ['随便玩'],
  layout: { flat: 0.6, features: [{ type: 'pile', x: 8, z: 0, r: 5, h: 2.2 }] },
  setup(g) {
    g.rig.setMode('cab');
    g.truckArrive(1.0, -8.5, Math.PI, true);
    g.pole(4, 7, 1.4);
    g.pole(7, 6, 1.9);
    g.pole(9.5, 4.5, 1.0);
  },
  onTruck(g, e) {
    if (e === 'gone') setTimeout(() => g.running && g.truckArrive(1.0, -8.5, Math.PI), 4000);
  },
  onEvent(g, e) {
    if (e === 'horn' && g.truck.parked && g.truck.load > 1) g.truck.leave();
  },
  steps: [
    {
      text: '自由练习。按 Esc 可以退出。',
      check: () => ({ hint: '' }),
    },
  ],
  rules: {},
  allowReset: true,
};

export const LESSONS = [walkaround, startStop, controls, touch, travel, dig, trench, loading, grading, slope];
export const EXAMS = [exam];
export const JOBS = [jobPit, jobTrench, jobPad];
export const FREE = free;

// 坡道课的专有扣分
import { RULES } from './game.js';
Object.assign(RULES, {
  slopeHi: { pts: 8, msg: '坡道上用兔子档', why: '坡道一律用乌龟档低速,兔子档扭矩小、速度快,下坡容易失控。' },
  slopeSwing: { pts: 8, msg: '在坡上回转', why: '坡上回转,重心横向偏移很容易侧翻。' },
  slopeBucket: { pts: 5, msg: '坡上行走铲斗高度不对', why: '铲斗要离地 20~50 cm 跟着走:太高重心高,贴地会铲地、顶住。万一打滑可以马上把斗子放下撑住。' },
  spoilNear: { pts: 5, msg: '弃土离沟边太近', why: '' },
});
