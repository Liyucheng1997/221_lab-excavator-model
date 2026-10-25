/**
 * 车型登记表:每台车的名字、怎么造、用哪套键位、HUD 显示什么、按键说明、课程。
 * main / ui / game 都只认这张表,不直接认具体车型。
 */
import { createLoader } from './loader.js';
import { LOADER_LINKAGE } from './loader-kin.js';
import { createRoller } from './roller.js';
import { createLift } from './lift.js';
import { LOADER_LESSONS, LOADER_FREE, ROLLER_LESSONS, ROLLER_FREE, LIFT_LESSONS, LIFT_FREE } from './scenarios.js';
import { clamp } from '../linkage.js';

const K = (k) => `<kbd>${k}</kbd>`;
const stab = (v) => {
  const st = clamp(v, -1, 1);
  const c = st > 0.4 ? 'var(--ok)' : st > 0.15 ? 'var(--acc)' : 'var(--warn)';
  return `<div class="bar thin"><i style="width:${(clamp((st + 0.2) / 1.2, 0.02, 1) * 100).toFixed(0)}%;background:${c}"></i></div>`;
};
const engineBadge = (m) => [m.engine === 'running' ? '发动机运转' : m.engine === 'crank' ? '起动中…' : '发动机熄火', m.running ? 'ok-b' : 'dim-b'];
const keyBadge = (m) => [`钥匙 ${m.key.toUpperCase()} ${K('E')}`, 'dim-b'];

// ── 装载机 ─────────────────────────────────────────────────────────────
const loaderDef = {
  id: 'loader',
  name: '装载机',
  short: '5 吨轮式',
  brand: '锐工 RG856 · 5 吨级轮式装载机',
  title: '装载机驾驶培训',
  sub: 'Z 型反转六连杆、液力变矩器、铰接转向 —— 铲装料堆、运料、装车',
  input: 'wheel',
  create: createLoader,
  lessons: LOADER_LESSONS,
  free: LOADER_FREE,
  /** 菜单背景:原地举升翻斗 */
  demo(sim, t) {
    const LK = LOADER_LINKAGE;
    const k = (Math.sin(t * 0.35) + 1) / 2;
    sim.liftL = LK.liftMin + 0.02 + k * (LK.liftMax - LK.liftMin - 0.05);
    const tilt = (Math.sin(t * 0.35 + 1.6) + 1) / 2;
    sim.tiltL = LK.tiltMin + 0.05 + tilt * (LK.tiltMax - LK.tiltMin - 0.1);
    sim.st.gamma = Math.sin(t * 0.21) * 0.25;
    sim.syncTerrain(true);
  },
  action(sim, a) {
    switch (a) {
      case 'dirF':
        sim.setDir(1);
        return '换向:F 前进';
      case 'dirR':
        sim.setDir(-1);
        return '换向:R 后退';
      case 'dirN':
        sim.setDir(0);
        return '换向:N 空挡';
      case 'travelSpeed':
        sim.toggleGear();
        return sim.gear === 1 ? 'Ⅰ档(作业档,≤12 km/h)' : 'Ⅱ档(行驶档,≤26 km/h)';
      case 'lock':
        sim.toggleParkBrake();
        return sim.parkBrake ? '驻车制动:拉起' : '驻车制动:松开';
      case 'resetPose':
        sim.carryPose();
        sim.syncTerrain(true);
        return '铲斗收回到运输位置';
    }
    return null;
  },
  hud: {
    title: '装载机操纵',
    legend: `<div class="vk-grid">
      <span>${K('W')}油门 ${K('S')}制动</span><span>${K('A')}${K('D')}方向盘</span>
      <span>${K('R')}前进 ${K('N')}空挡 ${K('F')}后退</span><span>${K('V')}Ⅰ/Ⅱ档 ${K('Q')}驻车</span>
      <span>${K('I')}动臂降 ${K('K')}动臂升</span><span>${K('J')}收斗 ${K('L')}翻斗</span>
    </div>`,
    bars: [
      { label: '方向盘', keys: 'A/D', value: (m, r) => r.leftX },
      { label: '油门/制动', keys: 'W/S', value: (m, r) => r.leftY },
      { label: '动臂', keys: 'K/I', value: (m, r) => -r.rightY },
      { label: '铲斗', keys: 'J/L', value: (m, r) => -r.rightX },
    ],
    badges: (m) => [[m.parkBrake ? '(P) 驻车制动 ' + K('Q') : '驻车已松开 ' + K('Q'), m.parkBrake ? 'bad-b' : 'ok-b'], engineBadge(m), keyBadge(m)],
    rows(m) {
      const r = m.readout();
      const dir = m.dir === 1 ? '<b style="color:var(--ok)">F 前进</b>' : m.dir === -1 ? '<b style="color:var(--warn)">R 后退</b>' : 'N 空挡';
      return [
        ['换向 · 档位', `${dir} · ${m.gear === 1 ? 'Ⅰ' : 'Ⅱ'}档`],
        ['车速', `${Math.abs(m.speed * 3.6).toFixed(1)} km/h`],
        ['转速', `${Math.round(m.rpm)} rpm`],
        ['斗内物料', `${m.bucketLoad.toFixed(2)} m³ <small>(${((m.bucketLoad / m.capacity) * 100).toFixed(0)}%)</small>`],
        ['斗齿离地', r.tipAbove < 0 ? `插入 ${(-r.tipAbove).toFixed(2)} m` : `${r.tipAbove.toFixed(2)} m`],
        ['动臂铰点高', `${r.hingeH.toFixed(2)} m`],
        ['铲斗角', `${r.bucketDeg > 0 ? '后倾' : '前倾'} ${Math.abs(r.bucketDeg).toFixed(0)}°`],
        ['折腰角', `${r.gammaDeg > 0.5 ? '左 ' : r.gammaDeg < -0.5 ? '右 ' : ''}${Math.abs(r.gammaDeg).toFixed(0)}°`],
        ['侧向稳定', stab(m.stability)],
      ];
    },
    warns(m) {
      const w = [];
      if (m.spilling) w.push('铲斗前倾,物料在往外倒');
      if (m.relief > 0.6) w.push('憋压!油缸到头或铲斗顶死了 —— 松手');
      if (m.slip > 0.5) w.push('轮胎打滑:插入阻力太大');
      if (m.tilt.kind === 'tip') w.push('⚠ 侧翻危险!减速、回正方向、放低铲斗');
      if (m.selfTest > 0) w.push('仪表自检中…');
      return w;
    },
  },
  help: () => `<div class="help"><table>
    <tr><th colspan="2">行驶</th></tr>
    <tr><td>${K('W')}</td><td>油门踏板:踩下越多转速越高、车越快;同时液压泵流量也越大(举升快)</td></tr>
    <tr><td>${K('S')}</td><td>制动踏板。液力变矩器挂上档就会"蠕行",停车必须踩住制动</td></tr>
    <tr><td>${K('A')} ${K('D')}</td><td>方向盘(铰接转向:前后车架折腰,原地打方向车头车尾一起摆)</td></tr>
    <tr><td>${K('R')} ${K('N')} ${K('F')}</td><td>换向开关:F 前进 / N 空挡 / R 后退。高速时不要直接换向</td></tr>
    <tr><td>${K('V')}</td><td>Ⅰ档(铲装作业)/ Ⅱ档(场内转场)</td></tr>
    <tr><td>${K('Q')}</td><td>驻车制动:拉起 / 松开</td></tr>
    <tr><th colspan="2">工作装置(右手先导手柄)</th></tr>
    <tr><td>${K('K')} ${K('I')}</td><td>手柄后拉 = 动臂上升,前推 = 动臂下降</td></tr>
    <tr><td>${K('J')} ${K('L')}</td><td>手柄左扳 = 收斗(铲斗上翻),右扳 = 翻斗卸料</td></tr>
    <tr><td>${K('Shift')}</td><td>按住:微操(手柄最多推 1/3)</td></tr>
    <tr><td>${K('X')}</td><td>铲斗一键收到运输位置(仅自由练习)</td></tr>
    <tr><th colspan="2">其他</th></tr>
    <tr><td>${K('E')}</td><td>钥匙:OFF→ON;ON 时按住 = 打火(换向开关必须在 N);运转时按一下 = 熄火</td></tr>
    <tr><td>${K('空格')} / ${K('B')}</td><td>喇叭 / 工作灯</td></tr>
    <tr><td>${K('C')} / ${K('Tab')} / ${K('Esc')}</td><td>切换视角 / 侧视小窗 / 暂停</td></tr>
  </table>
  <p class="dim">铲装要领:Ⅰ档、斗底放平贴地,对准料堆低速插入;插到一半边往前顶边收斗、同时提动臂,装满后收斗到底、倒车退出;运料时铲斗离地 40~50 cm。</p></div>`,
};


// ── 压路机 ─────────────────────────────────────────────────────────────
const THR = ['怠速', '中速', '高速(作业)'];
const rollerDef = {
  id: 'roller',
  name: '压路机',
  short: '20 吨单钢轮',
  brand: '锐工 RG620 · 20 吨级单钢轮振动压路机',
  title: '压路机驾驶培训',
  sub: '静液压行走、铰接转向、高/低振幅振动 —— 起步开振、关振停车、轮迹重叠,把松土路基压实',
  tip: '游戏手柄:左摇杆 = 方向盘 + 行走手柄,左摇杆按下 = 振动开关。',
  input: 'wheel',
  create: createRoller,
  lessons: ROLLER_LESSONS,
  free: ROLLER_FREE,
  menuDist: 13,
  demo(sim, t) {
    // 原地来回摆方向、钢轮慢慢转
    sim.st.gamma = Math.sin(t * 0.25) * 0.3;
    sim.model.roll(0.006, 0.006);
    sim.syncTerrain(true);
  },
  action(sim, a) {
    switch (a) {
      case 'dirN':
        sim.centerLever();
        return '行走手柄回中位(停车)';
      case 'vibe':
        if (sim.toggleVibe()) return sim.vibe ? `振动:开(${sim.amp === 'high' ? '高' : '低'}振幅)` : '振动:关';
        return null;
      case 'mode':
        sim.amp = sim.amp === 'high' ? 'low' : 'high';
        return sim.amp === 'high' ? '振幅:高(压厚层、土方路基)' : '振幅:低(压薄层、面层,振感小)';
      case 'travelSpeed':
        if (sim.toggleRange()) return sim.range === 1 ? 'Ⅰ档:作业档(≤ 6 km/h,可振动)' : 'Ⅱ档:行驶档(≤ 11 km/h,不能振动)';
        return null;
      case 'throttleUp':
        sim.setThrottle(sim.throttleStep + 1);
        return `油门:${THR[sim.throttleStep]}`;
      case 'throttleDown':
        sim.setThrottle(sim.throttleStep - 1);
        return `油门:${THR[sim.throttleStep]}`;
      case 'lock':
        sim.toggleParkBrake();
        return sim.parkBrake ? '停车制动:按下' : '停车制动:松开';
      case 'resetPose':
        sim.lever = 0;
        return '行走手柄回中';
    }
    return null;
  },
  hud: {
    title: '压路机操纵',
    legend: `<div class="vk-grid">
      <span>${K('W')}${K('S')} 行走手柄 推/拉</span><span>${K('N')} 手柄回中</span>
      <span>${K('A')}${K('D')} 方向盘</span><span>${K('G')} 振动开关</span>
      <span>${K('M')} 振幅 高/低</span><span>${K('V')} Ⅰ/Ⅱ档</span>
      <span>${K('-')}${K('+')} 油门</span><span>${K('Q')} 停车制动</span>
    </div>`,
    bars: [
      { label: '方向盘', keys: 'A/D', value: (m, r) => r.leftX },
      { label: '行走手柄', keys: 'W/S', value: (m) => m.lever },
      { label: '振动', keys: 'G', value: (m) => (m.vibeLive ? m.vibeHz / 32 : 0) },
    ],
    badges: (m) => [
      [m.parkBrake ? '(P) 停车制动 ' + K('Q') : '停车制动松开 ' + K('Q'), m.parkBrake ? 'bad-b' : 'ok-b'],
      [m.vibeLive ? `振动 ${m.amp === 'high' ? '高' : '低'}` : '振动 关', m.vibeLive ? 'ok-b' : 'dim-b'],
      engineBadge(m),
    ],
    rows(m, g) {
      const rows = [
        ['档位 · 油门', `${m.range === 1 ? 'Ⅰ 作业' : 'Ⅱ 行驶'} · ${THR[m.throttleStep]}`],
        ['车速', `${Math.abs(m.speed * 3.6).toFixed(1)} km/h${m.speed < -0.05 ? ' <small>倒车</small>' : ''}`],
        ['转速', `${Math.round(m.rpm)} rpm`],
        ['振动频率', m.vibeLive ? `${m.vibeHz.toFixed(0)} Hz · ${m.amp === 'high' ? '2.0' : '1.0'} mm` : '—'],
      ];
      if (g.sc?.cov) {
        const c = g.sc.cov(g);
        rows.push(['路基达标', `${(c.frac * 100).toFixed(0)}% <small>平均 ${c.passes.toFixed(1)} 遍</small>`]);
      }
      rows.push(['侧向稳定', stab(m.stability)]);
      return rows;
    },
    warns(m) {
      const w = [];
      if (m.vibeLive && Math.abs(m.speed) < 0.08) w.push('原地振动!会振出坑 —— 关振动(G)');
      if (m.vibeLive && Math.abs(m.speed) > 1.25) w.push('振动碾压太快(> 4.5 km/h)');
      if (m.vibeLive && m.rpm < 1900) w.push('转速太低,振动频率不够');
      if (m.tilt.kind === 'tip') w.push('⚠ 侧翻危险!立即停车');
      if (m.selfTest > 0) w.push('仪表自检中…');
      return w;
    },
    // 压实遍数图(和驾驶室里的屏幕一样)
    canvas(ctx, m, w, h) {
      ctx.clearRect(0, 0, w, h);
      m.drawCoverage(ctx, 0, 0, w, h);
    },
  },
  help: () => `<div class="help"><table>
    <tr><th colspan="2">行走(静液压)</th></tr>
    <tr><td>${K('W')} ${K('S')}</td><td>行走手柄往前推 / 往后拉。推得越多走得越快;<b>松手后手柄留在原位</b>,不会自己回中</td></tr>
    <tr><td>${K('N')}</td><td>手柄拉回中位 = 停车(中位有卡槽:一把拉过中位会卡住,要松手再推)</td></tr>
    <tr><td>${K('A')} ${K('D')}</td><td>方向盘(铰接转向)</td></tr>
    <tr><td>${K('V')}</td><td>Ⅰ档作业(≤ 6 km/h,可振动)/ Ⅱ档行驶(≤ 11 km/h,不能振动)</td></tr>
    <tr><td>${K('Q')}</td><td>停车制动</td></tr>
    <tr><th colspan="2">振动</th></tr>
    <tr><td>${K('G')}</td><td>振动开关(手柄顶上的按钮)。先起步、再开振;先关振、再停车</td></tr>
    <tr><td>${K('M')}</td><td>振幅 高 / 低</td></tr>
    <tr><td>${K('-')} ${K('+')}</td><td>油门开关:怠速 / 中速 / 高速。振动作业必须在高速档</td></tr>
    <tr><th colspan="2">其他</th></tr>
    <tr><td>${K('E')}</td><td>钥匙:OFF→ON;ON 时按住 = 打火(行走手柄必须在中位)</td></tr>
    <tr><td>${K('空格')} / ${K('B')}</td><td>喇叭 / 工作灯</td></tr>
    <tr><td>${K('C')} / ${K('Tab')} / ${K('Esc')}</td><td>切换视角 / 侧视小窗 / 暂停</td></tr>
  </table>
  <p class="dim">压实要领:由低往高、由边往中;每条轮迹重叠 1/3 钢轮宽;振动碾压 2~4 km/h,一般土方 3~5 遍;离填方边缘留 0.5 m。</p></div>`,
};

// ── 剪叉式升降平台 ─────────────────────────────────────────────────────
const liftDef = {
  id: 'lift',
  name: '升降机',
  short: '10 m 剪叉式',
  brand: '锐工 RG10S · 10 米电动剪叉式高空作业平台',
  title: '升降平台操作培训',
  sub: '平台控制盒操作、高位慢速、倾斜报警、下降停顿 —— 高处作业的安全规矩',
  tip: '游戏手柄:左摇杆上下 = 控制手柄,左右 = 转向;右摇杆左右 = 延伸平台。',
  input: 'wheel',
  create: createLift,
  lessons: LIFT_LESSONS,
  free: LIFT_FREE,
  menuDist: 15,
  menuLookY: 3.2,
  demo(sim, t) {
    sim.theta = 0.06 + ((Math.sin(t * 0.22 - 1.4) + 1) / 2) * 0.5;
    sim.ext = ((Math.sin(t * 0.3) + 1) / 2) * 0.9;
    sim.guards = sim.theta > 0.1 ? 1 : 0;
    sim.syncTerrain(true);
  },
  action(sim, a) {
    switch (a) {
      case 'mode':
        sim.toggleMode();
        return sim.mode === 'drive' ? '选择开关:行走' : '选择开关:举升';
      case 'lock':
        sim.toggleEstop();
        return sim.estop ? '急停:按下(全部断电)' : '急停:拔出';
      case 'gate':
        sim.toggleGate();
        return sim.gateOpen ? '护栏门:打开' : '护栏门:关好';
      case 'resetPose':
        sim.stow();
        return '平台降到底、收回延伸平台';
    }
    return null;
  },
  hud: {
    title: '平台控制盒',
    legend: `<div class="vk-grid">
      <span>${K('M')} 行走 / 举升</span><span>${K('W')}${K('S')} 控制手柄</span>
      <span>${K('A')}${K('D')} 转向</span><span>${K('J')}${K('L')} 延伸平台</span>
      <span>${K('T')} 护栏门</span><span>${K('Q')} 急停</span>
    </div>`,
    bars: [
      { label: '控制手柄', keys: 'W/S', value: (m, r) => r.leftY },
      { label: '转向', keys: 'A/D', value: (m) => -m.steer / 0.55 },
      { label: '延伸平台', keys: 'J/L', value: (m) => m.ext / 0.9 },
    ],
    badges: (m) => [
      [m.estop ? '急停按下 ' + K('Q') : '急停已拔出 ' + K('Q'), m.estop ? 'bad-b' : 'ok-b'],
      [m.mode === 'drive' ? '行走档 ' + K('M') : '举升档 ' + K('M'), 'ok-b'],
      [m.gateOpen ? '门开着 ' + K('T') : '门已关 ' + K('T'), m.gateOpen ? 'bad-b' : 'dim-b'],
      [`钥匙 ${m.key === 'off' ? 'OFF' : 'ON'} ${K('E')}`, 'dim-b'],
    ],
    rows(m) {
      const r2 = (v) => (Math.abs(v) * (180 / Math.PI)).toFixed(1);
      return [
        ['平台高度', `${m.deck.toFixed(2)} m <small>工作高度 ${(m.deck + 2).toFixed(1)} m</small>`],
        ['车身倾斜', `横 ${r2(m.roll)}° · 纵 ${r2(m.pitch)}°`, m.alarm === '倾斜报警' ? 'warn' : ''],
        ['行走速度', `${Math.abs(m.speed * 3.6).toFixed(1)} km/h <small>${m.elevated ? '高位慢速' : ''}</small>`],
        ['延伸平台', `${m.ext.toFixed(2)} m`],
        ['电量', `${(m.battery * 100).toFixed(0)}%`],
        ['稳定性', stab(m.stability)],
      ];
    },
    warns(m) {
      const w = [];
      if (m.alarm === '倾斜报警') w.push('⚠ 倾斜报警!只能下降,不能升、不能走');
      if (m.alarm === '下降停顿') w.push('下降停顿中 —— 确认平台下方没有人');
      if (m.gateOpen && m.running) w.push('护栏门没关!');
      if (m.estop && m.key !== 'off') w.push('急停按下中,按 Q 拔出');
      if (m.alarm === '整机倾翻') w.push('整机倾翻');
      return w;
    },
  },
  help: () => `<div class="help"><table>
    <tr><th colspan="2">平台控制盒</th></tr>
    <tr><td>${K('M')}</td><td>选择开关:行走 / 举升(手柄只做当前档位的动作)</td></tr>
    <tr><td>${K('W')} ${K('S')}</td><td>控制手柄 前推 / 后拉:行走档 = 前进 / 后退;举升档 = 上升 / 下降</td></tr>
    <tr><td>${K('A')} ${K('D')}</td><td>手柄上的转向翘板(行走档)</td></tr>
    <tr><td>${K('Shift')}</td><td>按住:微动(手柄最多推 1/3),接近梁、管道时用</td></tr>
    <tr><td>${K('J')} ${K('L')}</td><td>延伸平台 收回 / 推出(最多 0.9 m)</td></tr>
    <tr><td>${K('Q')}</td><td>急停按钮:按下全部断电,拔出恢复</td></tr>
    <tr><td>${K('T')}</td><td>平台入口护栏门 开 / 关</td></tr>
    <tr><td>${K('E')}</td><td>钥匙开关(通电)</td></tr>
    <tr><td>${K('空格')}</td><td>喇叭</td></tr>
    <tr><td>${K('C')} / ${K('Tab')} / ${K('Esc')}</td><td>切换视角 / 侧视小窗 / 暂停</td></tr>
  </table>
  <p class="dim">平台升起后行走速度自动降到 0.8 km/h;车身倾斜超限会报警并锁止上升和行走;下降到 2 m 左右自动停顿 3 秒。</p></div>`,
};

export const VEHICLE_LIST = [
  { id: 'excavator', name: '挖掘机', short: '20 吨履带式' },
  loaderDef,
  rollerDef,
  liftDef,
];
export const VEHICLES = Object.fromEntries(VEHICLE_LIST.map((v) => [v.id, v]));
