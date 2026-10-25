/**
 * 装载机 / 压路机 / 高空作业平台的课程。结构和挖掘机的关卡一样:setup + steps + rules。
 */
import { RULES } from '../game.js';
import { SteelBay, HighBayLamp } from './props.js';

const K = (k) => `<kbd>${k}</kbd>`;

Object.assign(RULES, {
  // 装载机
  ldShuttle: { pts: 5, msg: '高速直接换向', why: '车速还很快就从前进直接换到后退,变速箱离合器和传动轴要承受巨大冲击。先踩制动把车停稳(至少降到 5 km/h 以下)再换向。' },
  ldParkDrive: { pts: 3, msg: '驻车制动没松就起步', why: '起步前先松开驻车制动。带着驻车制动硬走,制动片很快就烧了。' },
  ldHighCarry: { pts: 5, msg: '运料时铲斗举得太高', why: '满斗行驶时铲斗要放低,斗底离地 40~50 cm:重心低、不挡视线,万一要急停也不会把料甩出去。到了卸料点再举升。' },
  ldTip: { pts: 10, msg: '出现侧翻险情', why: '满斗、动臂举高、车速快的时候急打方向,离心力加上高重心会把车掀翻。转弯前减速,铲斗放低。' },
  ldOverturn: { fatal: true, msg: '整机侧翻', why: '高速急转弯 / 坡上横行 / 举着满斗转弯,重心越过了支撑三角形。' },
  ldBucketUp: { pts: 5, msg: '停车时铲斗没有落地', why: '停车、离机前必须把铲斗平放在地面上。铲斗悬着,液压一泄漏就会掉下来砸人。' },
  ldNotNeutral: { pts: 3, msg: '停车时换向开关没回空挡', why: '离机前换向开关打到 N、拉起驻车制动,防止别人误碰或起动时窜车。' },
});

// ═══════════════════════════════════════════════════════════════════════
//  装载机
// ═══════════════════════════════════════════════════════════════════════

const ldBasics = {
  id: 'ld-basics',
  vehicle: 'loader',
  kind: 'lesson',
  title: '装载机 第 1 课 · 起步、行驶与停车',
  subtitle: '中位起动、换向、蠕行与制动',
  brief:
    '装载机和挖掘机的开法完全不同:它是靠方向盘折腰转向的轮式车,有液力变矩器 —— 挂上档松开油门车也会慢慢往前走(蠕行),停车得靠踩制动。这一课从冷车起动开始,把车开到前方的标记点,再倒回来,最后按规矩收车。',
  goals: ['正确起动(换向开关在 N)', '鸣笛、松驻车后起步', '开到标记点停稳', '倒车回到起点', '铲斗落地、空挡、驻车,熄火'],
  layout: { flat: 0.85 },
  setup(g) {
    g.m.stopEngineNow();
    g.m.parkPose();
    g.m.syncTerrain(true);
    g.rig.setMode('cab');
    g.custom.mk = g.marker(0x46d67f, 1.6, 18, 0);
    g.custom.home = g.marker(0x4aa3ff, 1.6, 0, 0);
    for (const x of [6, 10, 14]) {
      g.cone(x, -2.4);
      g.cone(x, 2.4);
    }
  },
  steps: [
    {
      text: `钥匙打到 ON(按一下 ${K('E')}),等仪表自检完。确认换向开关在 <b>N</b>,然后<b>按住 ${K('E')}</b> 打火。`,
      check: (g) => g.m.running,
    },
    {
      text: `起步前先把铲斗收到"运输位置":后拉手柄(${K('K')})把铲斗抬离地面 30~60 cm,再左扳(${K('J')})把铲斗收到底。`,
      check(g, dt, st) {
        const r = g.m.readout();
        const ok = r.tipAbove > 0.3 && r.tipAbove < 0.75 && r.bucketDeg > 25;
        return { done: g.hold(st, 'h', ok, 0.8, dt), hint: `斗齿离地 ${r.tipAbove.toFixed(2)} m,铲斗后倾 ${r.bucketDeg.toFixed(0)}°` };
      },
    },
    {
      text: `按 ${K('空格')} 鸣笛,${K('Q')} 松开驻车制动,${K('R')} 挂前进档。松开制动后车会自己慢慢往前走(变矩器蠕行),${K('W')} 加油门,${K('S')} 踩制动。`,
      check: (g) => g.m.dir === 1 && !g.m.parkBrake && g.m.travelling,
    },
    {
      text: '沿两排路锥中间直行,开到前方的绿色标记点,<b>踩制动停稳</b>。',
      check(g, dt, st) {
        const p = g.m.position;
        const d = Math.hypot(p.x - 18, p.z);
        return { done: d < 1.6 && Math.abs(g.m.speed) < 0.05, progress: 1 - Math.min(1, d / 18), hint: d < 3 ? '到位后按住 S 踩制动' : `距离 ${d.toFixed(1)} m` };
      },
    },
    {
      text: `换到后退档(${K('F')}) —— 先停稳再换向!倒车时会响倒车报警。回头看后视镜,倒回蓝色起点。`,
      check(g, dt, st) {
        const p = g.m.position;
        const d = Math.hypot(p.x, p.z);
        return { done: d < 1.8 && Math.abs(g.m.speed) < 0.05 && g.m.dir === -1, progress: 1 - Math.min(1, d / 18), hint: `距离起点 ${d.toFixed(1)} m` };
      },
    },
    {
      text: `收车:铲斗平放落地(${K('I')} 放下动臂、${K('L')} 把铲斗放平),换向开关回 ${K('N')},${K('Q')} 拉起驻车制动,最后 ${K('E')} 熄火。`,
      check(g) {
        const m = g.m;
        if (m.key === 'off') {
          const r = m.readout();
          if (r.tipAbove > 0.12) g.addPenalty('ldBucketUp');
          if (m.dir !== 0) g.addPenalty('ldNotNeutral');
          if (!m.parkBrake) g.addPenalty('lockedLeave', 5, '熄火前没拉驻车制动', '离机前一定要拉起驻车制动,坡上还要垫三角木。');
          return true;
        }
        return { hint: `${m.readout().tipAbove < 0.12 ? '✓' : '○'} 铲斗落地 ${m.dir === 0 ? '✓' : '○'} 空挡 ${m.parkBrake ? '✓' : '○'} 驻车` };
      },
    },
  ],
  rules: {},
  passScore: 70,
};

/** 料堆 + 侧面装车 */
const ldLoading = {
  id: 'ld-loading',
  vehicle: 'loader',
  kind: 'lesson',
  title: '装载机 第 2 课 · 铲装与装车',
  subtitle: '一次铲装法、V 形作业装自卸车',
  brief:
    '前方是一堆松土,左侧停着一辆自卸车。用"V 形作业法"装满它:斗底放平对准料堆、Ⅰ档低速插入,插到一半边顶边收斗、同时提动臂,装满后收斗到底倒车退出;再斜着开到车厢侧面,举升到顶、翻斗卸料,然后倒车回来铲下一斗。三斗左右装满一车,鸣笛放车。',
  goals: ['装够 6.5 m³', '不撒料、不撞车', '运料时铲斗放低'],
  timeLimit: 600,
  layout: { flat: 0.85, features: [{ type: 'pile', x: 15, z: 0, r: 6.5, h: 3.0 }] },
  setup(g) {
    g.rig.setMode('cab');
    g.m.placeAt(2, 0, 0);
    g.m.carryPose();
    g.m.syncTerrain(true);
    g.truckArrive(5.5, -11, 0, true);
  },
  onEvent(g, e) {
    if (e === 'horn' && g.truck.parked && g.truck.load > 6) g.truck.leave();
  },
  steps: [
    {
      text: `Ⅰ档对准料堆。铲斗<b>放平、贴地</b>:动臂放到底(${K('I')}),铲斗调到斗底水平(${K('J')}/${K('L')})。`,
      check(g, dt, st) {
        const r = g.m.readout();
        const ok = r.tipAbove < 0.12 && Math.abs(r.bucketDeg) < 8;
        return { done: g.hold(st, 'h', ok, 0.6, dt), hint: `斗齿离地 ${r.tipAbove.toFixed(2)} m · 铲斗角 ${r.bucketDeg.toFixed(0)}°` };
      },
    },
    {
      text: `${K('R')} 前进、${K('W')} 加油门插入料堆;插进去后<b>边往前顶边收斗(${K('J')})、同时提动臂(${K('K')})</b>,装到 80% 以上。`,
      check(g) {
        const m = g.m;
        const f = m.bucketLoad / m.capacity;
        return { done: f >= 0.8, progress: f / 0.8, hint: `斗内 ${(f * 100).toFixed(0)}%` };
      },
    },
    {
      text: `收斗到底,${K('S')} 停车、${K('F')} 换倒档,倒车退出料堆。运料时铲斗离地 40~50 cm。`,
      check(g) {
        const m = g.m;
        return m.dir === -1 && Math.abs(m.speed) > 0.3 && m.readout().bucketDeg > 30;
      },
    },
    {
      text: '斜着开到自卸车车厢<b>侧面</b>,边走边举升动臂,停稳后翻斗(' + K('L') + ')卸料。斗子要完全越过厢板再翻,别磕到车厢。',
      check(g) {
        const v = g.truck.load;
        return { done: v > 1.5, progress: v / 1.5, hint: `车内 ${v.toFixed(1)} m³` };
      },
    },
    {
      text: '继续铲装、卸料,把车装到 6.5 m³ 以上。装车要均匀:先装靠车头的一侧,再装车尾。',
      check(g) {
        const v = g.truck.load;
        return { done: v >= 6.5, progress: v / 6.5, hint: `车内 ${v.toFixed(1)} / 6.5 m³` };
      },
    },
    {
      text: `装满了,鸣笛(${K('空格')})放车。`,
      check: (g) => g.truck.state === 'leaving' || g.truck.state === 'hidden',
    },
  ],
  score(g, res) {
    res.lines.push(['装车量', `${g.truck.load.toFixed(1)} m³`]);
    res.lines.push(['撒料', `${g.stats.truckSpill.toFixed(2)} m³`]);
    return res;
  },
  rules: {},
  passScore: 70,
};

export const LOADER_FREE = {
  id: 'ld-free',
  vehicle: 'loader',
  kind: 'free',
  title: '装载机 · 自由练习',
  subtitle: '料堆 + 自卸车',
  brief: '没有考核。前方有一大堆松土,左侧有自卸车(装满后鸣笛放走,会再来一辆)。X 键可以一键把铲斗收到运输位置。',
  goals: ['随便玩'],
  layout: { flat: 0.75, features: [{ type: 'pile', x: 15, z: 2, r: 7, h: 3.2 }] },
  setup(g) {
    g.rig.setMode('cab');
    g.m.placeAt(2, 0, 0);
    g.m.carryPose();
    g.m.parkBrake = false;
    g.m.syncTerrain(true);
    g.truckArrive(5.5, -11, 0, true);
    g.pole(-6, 8, 1.6);
    g.pole(-10, 6, 1.6);
  },
  onTruck(g, e) {
    if (e === 'gone') setTimeout(() => g.running && g.truckArrive(5.5, -11, 0), 4000);
  },
  onEvent(g, e) {
    if (e === 'horn' && g.truck.parked && g.truck.load > 1) g.truck.leave();
  },
  steps: [{ text: '自由练习。按 Esc 可以退出。', check: () => ({ hint: '' }) }],
  rules: {},
  allowReset: true,
};

export const LOADER_LESSONS = [ldBasics, ldLoading];

// ═══════════════════════════════════════════════════════════════════════
//  压路机
// ═══════════════════════════════════════════════════════════════════════

Object.assign(RULES, {
  rlStaticVibe: { pts: 5, msg: '原地振动', why: '钢轮停在原地还开着振动,会把路基振出一道横向的坑(俗称"振坑"),还伤减振器。顺序永远是:先起步、再开振;先关振、再停车。' },
  rlVibeReverse: { pts: 5, msg: '振动状态下换向', why: '到头换向前要先关振动:带着振动停车 → 原地振坑;带着振动起步 → 钢轮"啃"进松土里。' },
  rlFast: { pts: 3, msg: '振动碾压速度过快', why: '振动压实的速度一般 2~4 km/h。太快了每个点受到的振动次数不够,压不实,还容易压出波浪。' },
  rlLowRpmVibe: { pts: 3, msg: '低转速振动', why: '振动频率跟着发动机转速走。转速低频率就低,钢轮会"跳"着走,压实效果差,还会损坏振动轴承。振动前把油门开到高速档。' },
  rlEdge: { pts: 5, msg: '离填方边缘太近,车身倾斜', why: '碾压路基边缘时钢轮外侧要离边缘留 0.5 m 左右,边缘的松土承载力差,压上去容易塌、容易翻车。' },
  rlTip: { pts: 10, msg: '出现侧翻险情', why: '车身侧倾太大了!立即停车,回正方向,沿原路慢慢退回平地。' },
  rlOverturn: { fatal: true, msg: '压路机侧翻', why: '压路机重心高、车身窄,在边坡上横向行驶或者开出填方边缘就会侧翻。' },
  rlParkDrive: { pts: 3, msg: '停车制动没松就推手柄', why: '起步前先松开停车制动。' },
});

const PAD = { x: 13, z: 0, hx: 6, hz: 2.8 };

const rlBasics = {
  id: 'rl-basics',
  vehicle: 'roller',
  kind: 'lesson',
  title: '压路机 第 1 课 · 振动压实',
  subtitle: '先起步后开振、先关振后停车,轮迹重叠 1/3',
  brief:
    '前方是一层刚摊铺好的松土路基(12 m × 5.6 m)。用振动压实把它压到合格:Ⅰ档低速、油门最高档,起步后再开振动,到头先关振动再停车换向;每条轮迹和上一条重叠约 1/3 钢轮宽度,每处至少振压 3 遍。右下角的面板上有压实遍数图:红 → 黄 → 绿。',
  goals: ['路基 85% 以上压实度达标', '不原地振动、不带振换向', '振动碾压速度 ≤ 4 km/h', '离填方边缘留够距离'],
  timeLimit: 900,
  layout: { flat: 0.85, features: [{ type: 'pad', ...PAD, h: 0.32, slope: 1.6, rough: 0.12 }] },
  setup(g) {
    g.m.stopEngineNow();
    g.m.placeAt(-1, 0, 0);
    g.m.syncTerrain(true);
    g.rig.setMode('cab');
    g.custom.home = g.marker(0x4aa3ff, 1.8, -1, 0);
    // 路基四角外的边桩
    for (const [sx, sz] of [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ])
      g.pole(PAD.x + sx * (PAD.hx + 1.9), PAD.z + sz * (PAD.hz + 1.9), 1.2);
  },
  cov: (g) => g.m.coverage(PAD.x, PAD.z, PAD.hx - 0.35, PAD.hz - 0.35, 0.8),
  steps: [
    {
      text: `确认行走手柄在<b>中位</b>(${K('N')}),钥匙打到 ON(${K('E')}),等自检完再按住 ${K('E')} 打火。`,
      check: (g) => g.m.running,
    },
    {
      text: `油门开到最高档(按两下 ${K('+')}),${K('Q')} 松开停车制动,${K('空格')} 鸣笛。`,
      check: (g) => g.m.throttleStep === 2 && !g.m.parkBrake && g.time - g.m.lastHorn < 8,
    },
    {
      text: `往前推行走手柄(按住 ${K('W')} 推一点就松手 —— 手柄会留在原位,不会自己回中)。慢速开上路基。`,
      check(g) {
        const p = g.m.position;
        return { done: p.x + 1.75 > PAD.x - PAD.hx + 0.5, hint: `车速 ${(Math.abs(g.m.speed) * 3.6).toFixed(1)} km/h` };
      },
    },
    {
      text: `车已经在走了,现在按 ${K('G')} 打开振动。<b>永远是先起步、后开振。</b>`,
      check: (g) => g.m.vibeLive && Math.abs(g.m.speed) > 0.2,
    },
    {
      text: `开始压实。到头时:${K('G')} 关振动 → ${K('N')} 手柄回中停稳 → ${K('S')} 往回拉倒车 → 起步后再 ${K('G')} 开振。一条压 3 遍后,往旁边挪大半个钢轮宽,压下一条。`,
      check(g) {
        const c = g.sc.cov(g);
        return { done: c.frac >= 0.85, progress: c.frac / 0.85, hint: `达标面积 ${(c.frac * 100).toFixed(0)}% · 平均 ${c.passes.toFixed(1)} 遍 · 平均压实度 ${(c.comp * 100).toFixed(0)}%` };
      },
    },
    {
      text: `压完了。关振动,开下路基回到蓝色起点:手柄回中(${K('N')})停稳,拉起停车制动(${K('Q')}),油门回怠速(${K('-')}),最后熄火(${K('E')})。`,
      check(g) {
        const m = g.m;
        const d = Math.hypot(m.position.x + 1, m.position.z);
        if (m.key === 'off') {
          if (!m.parkBrake) g.addPenalty('lockedLeave', 5, '熄火前没拉停车制动', '离机前一定要拉起停车制动。');
          return true;
        }
        return { hint: `${d < 2.5 ? '✓' : '○'} 回到起点 ${m.vibe ? '○' : '✓'} 关振动 ${m.parkBrake ? '✓' : '○'} 停车制动` };
      },
    },
  ],
  score(g, res) {
    const c = g.sc.cov(g);
    res.lines.push(['达标面积', `${(c.frac * 100).toFixed(0)}%`]);
    res.lines.push(['平均遍数', c.passes.toFixed(1)]);
    res.lines.push(['平均压实度', `${(c.comp * 100).toFixed(0)}%`]);
    return res;
  },
  rules: {},
  passScore: 70,
};

export const ROLLER_FREE = {
  id: 'rl-free',
  vehicle: 'roller',
  kind: 'free',
  title: '压路机 · 自由练习',
  subtitle: '一大块松土路基 + 土包',
  brief: '没有考核。前方是一大块松铺路基,周围有几个土包。右下角能看到压实遍数图。N 键手柄回中。',
  goals: ['随便压'],
  layout: {
    flat: 0.7,
    features: [
      { type: 'pad', x: 14, z: 0, hx: 9, hz: 6, h: 0.3, slope: 2, rough: 0.14 },
      { type: 'mound', x: -8, z: 9, r: 3, h: 0.6 },
      { type: 'mound', x: -12, z: -6, r: 2.5, h: 0.5 },
    ],
  },
  setup(g) {
    g.rig.setMode('cab');
    g.m.placeAt(-1, 0, 0);
    g.m.parkBrake = false;
    g.m.setThrottle(2);
    g.m.syncTerrain(true);
  },
  steps: [{ text: '自由练习。按 Esc 可以退出。', check: () => ({ hint: '' }) }],
  rules: {},
  allowReset: true,
};

export const ROLLER_LESSONS = [rlBasics];

// ═══════════════════════════════════════════════════════════════════════
//  剪叉式高空作业平台
// ═══════════════════════════════════════════════════════════════════════

Object.assign(RULES, {
  lfGateOpen: { pts: 10, msg: '护栏门没关就升降 / 行走', why: '进入平台后第一件事就是关好入口门(或挂好安全链)。门开着升起来,一个踉跄人就从门口掉下去了。' },
  lfTilt: { pts: 8, msg: '平台升起时车身倾斜报警', why: '剪叉平台只能在坚实平整的地面上升起。车身横向超过 1.5°、纵向超过 3°,倾斜传感器就会报警锁止。升起之前先看地面。' },
  lfCrush: { pts: 10, msg: '平台撞到上方障碍', why: '升到接近梁、管道的时候要点动慢升,随时看头顶。护栏顶到钢梁,操作员的手和头就在中间 —— 这是高空作业平台最常见的挤压伤亡事故。' },
  lfLowerOnPerson: { pts: 20, msg: '平台下方有人仍在下降', why: '下降前必须确认平台下面和剪叉四周没有人。剪叉合拢时会把人夹住。下降到 2 m 左右机器会自动停顿,就是给你最后一次确认的机会。' },
  lfOverturn: { fatal: true, msg: '升降平台倾翻', why: '平台升起时重心很高,在斜坡上、坑洼地面上升起,或者高位行驶开进坑里,都会倾翻。' },
});

const LAMP = { x: 12, y: 8.3, z: 1.1 };

const lfBasics = {
  id: 'lf-basics',
  vehicle: 'lift',
  kind: 'lesson',
  title: '升降平台 第 1 课 · 安全升降与高处作业',
  subtitle: '关门、低位就位、点动升到作业高度、确认下方无人再下降',
  brief:
    '厂房钢梁下面挂着一盏需要检修的工矿灯(离地 8.3 m)。开着剪叉平台到灯的正下方,升到手够得着的高度作业,然后安全降下、开回来停好。注意头顶的钢梁和消防水管,注意地面上走动的工人。',
  goals: ['关门、拔急停后再操作', '收拢状态下行走就位', '升到作业高度,不碰上方障碍', '下降时确认下方无人', '收车:降到底、按急停、断电'],
  timeLimit: 600,
  layout: { flat: 0.95 },
  setup(g) {
    g.rig.setMode('cab');
    g.m.placeAt(0, 0, 0);
    g.m.estop = true;
    g.m.key = 'off';
    g.m.engine = 'off';
    g.m.gateOpen = true;
    g.m.syncTerrain(true);
    const bay = new SteelBay({ cx: LAMP.x, halfSpan: 4, beamY: 8.8, extraBeams: [{ x0: 4, x1: 9.5, y: 5.6, z: 0.6, r: 0.12 }] });
    g.props.add(bay.group);
    g.m.obstacles.push(bay);
    const lamp = new HighBayLamp(LAMP.x, LAMP.y, LAMP.z);
    g.props.add(lamp.group);
    lamp.ring.position.set(LAMP.x, g.terrain.heightAt(LAMP.x, LAMP.z) + 0.03, LAMP.z);
    g.props.add(lamp.ring);
    g.custom.lamp = lamp;
    g.custom.home = g.marker(0x4aa3ff, 1.4, 0, 0);
  },
  // 平台升起后派一个工人走过来,看你会不会在他头顶下降
  update(g) {
    const st = g.custom;
    if (!st.workerSent && g.stepIndex >= 4) {
      st.workerSent = true;
      g.worker(
        [
          [4, 7],
          [10.6, 2.2],
          [10.6, 1.4],
        ],
        0.9
      );
    }
  },
  steps: [
    {
      text: `作业前检查:平台入口门开着 —— 按 ${K('T')} 关好护栏门。`,
      check: (g) => !g.m.gateOpen,
    },
    {
      text: `拔出急停按钮(${K('Q')}),钥匙打到 ON(${K('E')})通电。`,
      check: (g) => g.m.running,
    },
    {
      text: `选择开关在"行走"档(${K('M')} 切换)。鸣笛(${K('空格')})后用手柄 ${K('W')}/${K('S')} 前后、${K('A')}/${K('D')} 转向,<b>收拢状态下</b>开到灯具正下方的绿圈里停稳。`,
      check(g, dt, st) {
        const m = g.m;
        const d = Math.hypot(m.position.x - LAMP.x, m.position.z - LAMP.z);
        const ok = d < 0.55 && !m.travelling;
        return { done: g.hold(st, 'h', ok, 0.6, dt), progress: 1 - Math.min(1, d / 12), hint: `离作业点 ${d.toFixed(1)} m` };
      },
    },
    {
      text: `${K('M')} 切到"举升"档,${K('W')} 升平台。快到灯具时按住 ${K('Shift')} 点动,<b>手够得着灯(灯在胸口到头顶之间)就停</b>。注意上方的消防水管和钢梁!`,
      check(g, dt, st) {
        const m = g.m;
        const lamp = g.custom.lamp;
        const deckY = m.deckWorldY();
        const rel = lamp.bottom - deckY;
        const ok = rel > 1.2 && rel < 2.0 && !m.moving;
        return { done: g.hold(st, 'h', ok, 1.5, dt), progress: Math.min(1, deckY / (lamp.bottom - 1.6)), hint: `灯具比平台底板高 ${rel.toFixed(2)} m(目标 1.2~2.0 m)` };
      },
    },
    {
      text: '检修中……(换灯管、接线)。完成后灯会亮起来。',
      check(g, dt, st) {
        st.t2 = (st.t2 || 0) + dt;
        if (st.t2 > 3) g.custom.lamp.setLit(true);
        return { done: st.t2 > 3.5, progress: st.t2 / 3.5 };
      },
    },
    {
      text: `作业完成,${K('S')} 下降。<b>先看平台下面有没有人</b> —— 有人就停下、鸣笛示意他离开。下降到 2 m 左右会自动停顿 3 秒。`,
      check(g) {
        const m = g.m;
        return { done: m.deck < 1.43, hint: `平台高度 ${m.deck.toFixed(1)} m` };
      },
    },
    {
      text: `${K('M')} 切回行走档,开回蓝色起点停好,按下急停(${K('Q')}),钥匙打到 OFF(${K('E')})。`,
      check(g) {
        const m = g.m;
        const d = Math.hypot(m.position.x, m.position.z);
        if (m.key === 'off') {
          if (d > 2) g.addPenalty('notHome', 3, '没有停回停车位', '用完的平台要停回指定位置,收拢、断电、充电。');
          return true;
        }
        return { hint: `${d < 2 ? '✓' : '○'} 回到起点 ${m.estop ? '✓' : '○'} 急停按下` };
      },
    },
  ],
  rules: {},
  passScore: 70,
};

export const LIFT_FREE = {
  id: 'lf-free',
  vehicle: 'lift',
  kind: 'free',
  title: '升降平台 · 自由练习',
  subtitle: '钢结构厂房 + 几盏灯 + 一段斜坡',
  brief: '没有考核。前方是一跨钢结构厂房,梁下挂着几盏灯。左边有一段斜坡,可以体会一下倾斜报警。X 键一键降到底并收回延伸平台。',
  goals: ['随便玩'],
  layout: { flat: 0.95, features: [{ type: 'ramp', x0: -14, x1: -8, x2: -4, x3: 0, zc: 10, w: 3, h: 0.6 }] },
  setup(g) {
    g.rig.setMode('cab');
    g.m.placeAt(0, 0, 0);
    g.m.syncTerrain(true);
    const bay = new SteelBay({ cx: 12, halfSpan: 4.5, beamY: 9.2, extraBeams: [{ x0: 5, x1: 10, y: 6.2, z: -1.5, r: 0.1, color: 0x2d6fb3 }] });
    g.props.add(bay.group);
    g.m.obstacles.push(bay);
    for (const [x, y, z] of [
      [12, 8.7, -2.5],
      [12, 8.7, 0.5],
      [12, 8.7, 3.0],
    ]) {
      const l = new HighBayLamp(x, y, z);
      l.setLit(true);
      g.props.add(l.group);
    }
  },
  steps: [{ text: '自由练习。按 Esc 可以退出。', check: () => ({ hint: '' }) }],
  rules: {},
  allowReset: true,
};

export const LIFT_LESSONS = [lfBasics];
