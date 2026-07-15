/**
 * 操作输入:两根先导手柄 + 两根行走操纵杆,和真机一一对应。
 *
 * 真挖掘机的手柄不控制"角度",而是控制**先导压力 → 主阀开度 → 流量 → 油缸速度**。
 * 所以这里输出的是 -1~1 的手柄行程,machine.js 再把它当流量指令用。
 *
 * ── 手法(操作模式)──────────────────────────────────────────────
 * 真机上有个"ISO/SAE 转换阀",能把两根手柄的功能对调。两种手法的差别只在于
 * **动臂和斗杆分别归哪只手管**,回转永远在左手左右、铲斗永远在右手左右。
 *
 *   ISO(日本标准 / 国内绝大多数机器,俗称"反铲手法"):
 *       左手柄  前后 = 斗杆伸/收     左右 = 回转
 *       右手柄  前后 = 动臂降/升     左右 = 铲斗收/卸
 *
 *   SAE(美标 / 挖掘装载机手法):
 *       左手柄  前后 = 动臂降/升     左右 = 回转
 *       右手柄  前后 = 斗杆伸/收     左右 = 铲斗收/卸
 *
 * 注意"前推 = 动臂下降"、"前推 = 斗杆伸出"—— 手柄推离身体,工作装置就往外/往下走,
 * 这个直觉在两种手法里都一样。
 */
import { HYDRAULICS, ENGINE } from './config.js';
import { clamp } from './linkage.js';

export const PATTERNS = {
  ISO: {
    name: 'ISO(日本标准)',
    short: 'ISO',
    left: { x: '回转', y: '斗杆' },
    right: { x: '铲斗', y: '动臂' },
  },
  SAE: {
    name: 'SAE(美标)',
    short: 'SAE',
    left: { x: '回转', y: '动臂' },
    right: { x: '铲斗', y: '斗杆' },
  },
};

const KEYMAP = {
  // 左手柄
  KeyW: ['leftY', 1],
  KeyS: ['leftY', -1],
  KeyA: ['leftX', -1],
  KeyD: ['leftX', 1],
  // 右手柄
  KeyI: ['rightY', 1],
  KeyK: ['rightY', -1],
  KeyJ: ['rightX', -1],
  KeyL: ['rightX', 1],
  ArrowUp: ['rightY', 1],
  ArrowDown: ['rightY', -1],
  ArrowLeft: ['rightX', -1],
  ArrowRight: ['rightX', 1],
  // 行走:R/F 管左履带,T/G 管右履带 —— 上下两排、左右并排,正好像真机那两根操纵杆
  KeyR: ['trackL', 1],
  KeyF: ['trackL', -1],
  KeyT: ['trackR', 1],
  KeyG: ['trackR', -1],
};

export class Input {
  constructor() {
    this.pattern = 'ISO';
    this.throttle = ENGINE.defaultThrottle;
    this.keys = new Set();
    this.gamepadIndex = null;
    this.usingGamepad = false;

    // 原始手柄行程(已做先导响应平滑)
    this.raw = { leftX: 0, leftY: 0, rightX: 0, rightY: 0, trackL: 0, trackR: 0 };
    this.target = { leftX: 0, leftY: 0, rightX: 0, rightY: 0, trackL: 0, trackR: 0 };

    this.listeners = {};

    window.addEventListener('keydown', (e) => this._onKey(e, true));
    window.addEventListener('keyup', (e) => this._onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadIndex = e.gamepad.index;
      this._emit('gamepad', true);
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.gamepadIndex = null;
      this.usingGamepad = false;
      this._emit('gamepad', false);
    });
  }

  on(evt, fn) {
    (this.listeners[evt] ||= []).push(fn);
  }
  _emit(evt, ...a) {
    for (const f of this.listeners[evt] || []) f(...a);
  }

  _onKey(e, down) {
    if (e.repeat) return;
    if (down) {
      switch (e.code) {
        case 'KeyP':
          this.pattern = this.pattern === 'ISO' ? 'SAE' : 'ISO';
          this._emit('pattern', this.pattern);
          return;
        case 'KeyC':
          this._emit('camera');
          return;
        case 'KeyH':
          this._emit('help');
          return;
        case 'KeyN':
          this._emit('nextTask');
          return;
        case 'KeyX':
          this._emit('resetPose');
          return;
        case 'Equal':
        case 'NumpadAdd':
          this.throttle = clamp(this.throttle + 1, 1, ENGINE.throttleSteps);
          return;
        case 'Minus':
        case 'NumpadSubtract':
          this.throttle = clamp(this.throttle - 1, 1, ENGINE.throttleSteps);
          return;
      }
    }
    if (!KEYMAP[e.code]) return;
    e.preventDefault();
    if (down) this.keys.add(e.code);
    else this.keys.delete(e.code);
  }

  _pollGamepad() {
    if (this.gamepadIndex === null) return null;
    const gp = navigator.getGamepads?.()[this.gamepadIndex];
    if (!gp) return null;
    const dz = (v) => (Math.abs(v) < HYDRAULICS.deadzone ? 0 : v);
    const btn = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
    const g = {
      leftX: dz(gp.axes[0] ?? 0),
      leftY: dz(-(gp.axes[1] ?? 0)), // 手柄的 Y 轴向上是负
      rightX: dz(gp.axes[2] ?? 0),
      rightY: dz(-(gp.axes[3] ?? 0)),
      // 每侧的扳机管那一侧的履带:扳机前进,肩键后退
      trackL: btn(6) - btn(4),
      trackR: btn(7) - btn(5),
    };
    const active = Object.values(g).some((v) => Math.abs(v) > 0.02);
    if (active) this.usingGamepad = true;
    return g;
  }

  /** 每帧调用:键盘/手柄 → 平滑后的手柄行程 */
  update(dt) {
    const t = this.target;
    for (const k of Object.keys(t)) t[k] = 0;

    for (const code of this.keys) {
      const [axis, v] = KEYMAP[code];
      t[axis] += v;
    }
    for (const k of Object.keys(t)) t[k] = clamp(t[k], -1, 1);

    const gp = this._pollGamepad();
    if (gp) {
      // 手柄和键盘可以混用,谁给的量大听谁的
      for (const k of Object.keys(t)) {
        if (Math.abs(gp[k]) > Math.abs(t[k])) t[k] = gp[k];
      }
    }

    // 先导阀不是瞬间开到底的,给一个爬升速率 —— 这就是"点动"手感的来源
    const rate = HYDRAULICS.spoolRate * dt;
    for (const k of Object.keys(this.raw)) {
      const d = t[k] - this.raw[k];
      this.raw[k] += clamp(d, -rate, rate);
      if (Math.abs(this.raw[k]) < 1e-3) this.raw[k] = 0;
    }
  }

  /**
   * 按当前手法把手柄行程翻译成各机构的动作指令。
   * 约定:返回值 > 0 一律代表"该关节角度增大",由 machine.js 统一处理。
   *   boom   > 0 动臂上升
   *   arm    > 0 斗杆伸出
   *   bucket > 0 铲斗卸料
   *   swing  > 0 向右回转
   */
  commands() {
    const r = this.raw;
    const iso = this.pattern === 'ISO';
    return {
      swing: r.leftX,
      // 前推手柄 = 动臂下降,所以要取反
      boom: iso ? -r.rightY : -r.leftY,
      // 前推手柄 = 斗杆伸出,方向一致
      arm: iso ? r.leftY : r.rightY,
      // 手柄左推 = 收斗(斗角减小),方向一致
      bucket: r.rightX,
      trackL: r.trackL,
      trackR: r.trackR,
    };
  }

  /** 驾驶室里两根手柄的视觉摆动 */
  stickVisual() {
    return [
      { x: this.raw.leftX, y: this.raw.leftY },
      { x: this.raw.rightX, y: this.raw.rightY },
    ];
  }
}
