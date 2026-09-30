/**
 * 操作输入:两根先导手柄 + 两根行走操纵杆 + 驾驶室里的开关,和真机一一对应。
 *
 * 真挖掘机的手柄不控制"角度",而是控制**先导压力 → 主阀开度 → 流量 → 油缸速度**。
 * 所以这里输出的是 -1~1 的手柄行程,machine.js 再把它当流量指令用。
 *
 * 键盘是开关量,推不出"半行程"。所以:
 *   · 按住越久推得越多(0.45 秒推到底),点一下就是一点点 —— 这就是"点动"
 *   · 按住 Shift = 最多推三分之一,用来精细操作(平地、对位)
 * 有游戏手柄最好:左右摇杆就是两根先导手柄,可以真正地半推。
 *
 * ── 手法(操作模式)──────────────────────────────────────────────
 *   ISO(国内绝大多数机器):左手 前后=斗杆 左右=回转;右手 前后=动臂 左右=铲斗
 *   SAE(美标):             左手 前后=动臂 左右=回转;右手 前后=斗杆 左右=铲斗
 * "前推 = 动臂下降"、"前推 = 斗杆伸出" —— 手柄推离身体,工作装置就往外/往下走。
 */
import { HYDRAULICS } from './config.js';
import { clamp } from './linkage.js';

export const PATTERNS = {
  ISO: { name: 'ISO 手法(国标/日标)', short: 'ISO', left: { x: '回转', y: '斗杆' }, right: { x: '铲斗', y: '动臂' } },
  SAE: { name: 'SAE 手法(美标)', short: 'SAE', left: { x: '回转', y: '动臂' }, right: { x: '铲斗', y: '斗杆' } },
};

const AXES = {
  KeyW: ['leftY', 1],
  KeyS: ['leftY', -1],
  KeyA: ['leftX', -1],
  KeyD: ['leftX', 1],
  KeyI: ['rightY', 1],
  KeyK: ['rightY', -1],
  KeyJ: ['rightX', -1],
  KeyL: ['rightX', 1],
  ArrowUp: ['rightY', 1],
  ArrowDown: ['rightY', -1],
  ArrowLeft: ['rightX', -1],
  ArrowRight: ['rightX', 1],
  KeyR: ['trackL', 1],
  KeyF: ['trackL', -1],
  KeyT: ['trackR', 1],
  KeyG: ['trackR', -1],
};

// 单次触发的按键
const ACTIONS = {
  KeyQ: 'lock',
  KeyV: 'travelSpeed',
  KeyM: 'mode',
  KeyU: 'autoIdle',
  KeyB: 'lights',
  KeyC: 'camera',
  Tab: 'pip',
  KeyH: 'help',
  F1: 'help',
  Escape: 'pause',
  KeyX: 'resetPose',
  KeyP: 'pattern',
  Equal: 'throttleUp',
  NumpadAdd: 'throttleUp',
  Minus: 'throttleDown',
  NumpadSubtract: 'throttleDown',
  Enter: 'confirm',
};

const KB_RATE = 2.2; // 键盘:每秒增加的手柄行程
const FINE_CAP = 0.34;

export class Input {
  constructor() {
    this.pattern = 'ISO';
    this.keys = new Set();
    this.gamepadIndex = null;
    this.usingGamepad = false;
    this.enabled = true;
    this.raw = { leftX: 0, leftY: 0, rightX: 0, rightY: 0, trackL: 0, trackR: 0 };
    this.kb = { leftX: 0, leftY: 0, rightX: 0, rightY: 0, trackL: 0, trackR: 0 };
    this.horn = false;
    this.keyHeld = false;
    this.listeners = {};
    this._gpPrev = [];
    this.trackShift();

    window.addEventListener('keydown', (e) => this._onKey(e, true));
    window.addEventListener('keyup', (e) => this._onKey(e, false));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.horn = false;
      if (this.keyHeld) this._emit('keyUp');
      this.keyHeld = false;
    });
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
    // 输入框里打字时不抢键
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'F1') e.preventDefault();
    if (e.code === 'KeyE') {
      if (down && !e.repeat) {
        this.keyHeld = true;
        this._emit('keyDown');
      } else if (!down) {
        this.keyHeld = false;
        this._emit('keyUp');
      }
      return;
    }
    if (e.code === 'Space') {
      this.horn = down;
      return;
    }
    if (down && !e.repeat && ACTIONS[e.code]) {
      const a = ACTIONS[e.code];
      if (a === 'pattern') {
        this.pattern = this.pattern === 'ISO' ? 'SAE' : 'ISO';
        this._emit('pattern', this.pattern);
      } else this._emit(a);
      return;
    }
    if (!AXES[e.code]) return;
    if (down) this.keys.add(e.code);
    else this.keys.delete(e.code);
  }

  _pollGamepad() {
    if (this.gamepadIndex === null) return null;
    const gp = navigator.getGamepads?.()[this.gamepadIndex];
    if (!gp) return null;
    const dz = (v) => {
      const a = Math.abs(v);
      if (a < HYDRAULICS.deadzone) return 0;
      return Math.sign(v) * ((a - HYDRAULICS.deadzone) / (1 - HYDRAULICS.deadzone));
    };
    const btn = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
    const pressed = (i) => {
      const now = btn(i) > 0.5;
      const was = this._gpPrev[i];
      this._gpPrev[i] = now;
      return now && !was;
    };
    const g = {
      leftX: dz(gp.axes[0] ?? 0),
      leftY: dz(-(gp.axes[1] ?? 0)),
      rightX: dz(gp.axes[2] ?? 0),
      rightY: dz(-(gp.axes[3] ?? 0)),
      trackL: btn(6) - btn(4),
      trackR: btn(7) - btn(5),
    };
    // 按键:A 喇叭、B 锁杆、X 龟兔档、Y 视角、Back 钥匙、Start 暂停、十字键上下 油门
    this.gpHorn = btn(0) > 0.5;
    if (pressed(1)) this._emit('lock');
    if (pressed(2)) this._emit('travelSpeed');
    if (pressed(3)) this._emit('camera');
    if (pressed(9)) this._emit('pause');
    if (pressed(12)) this._emit('throttleUp');
    if (pressed(13)) this._emit('throttleDown');
    const backNow = btn(8) > 0.5;
    if (backNow && !this._gpBack) this._emit('keyDown');
    if (!backNow && this._gpBack) this._emit('keyUp');
    this._gpBack = backNow;
    if (Object.values(g).some((v) => Math.abs(v) > 0.05)) this.usingGamepad = true;
    return g;
  }

  /** 每帧调用:键盘/手柄 → 平滑后的手柄行程 */
  update(dt) {
    const fine = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this._shift;
    const target = { leftX: 0, leftY: 0, rightX: 0, rightY: 0, trackL: 0, trackR: 0 };
    if (this.enabled) for (const code of this.keys) if (AXES[code]) target[AXES[code][0]] += AXES[code][1];
    const cap = fine ? FINE_CAP : 1;
    // 键盘:按住越久推得越多
    for (const k of Object.keys(this.kb)) {
      const t = clamp(target[k], -1, 1) * cap;
      const cur = this.kb[k];
      if (t === 0) this.kb[k] = 0;
      else if (Math.sign(t) !== Math.sign(cur)) this.kb[k] = Math.sign(t) * 0.12;
      else this.kb[k] = Math.sign(t) * Math.min(Math.abs(t), Math.abs(cur) + KB_RATE * dt);
      if (Math.abs(this.kb[k]) < 0.12 && t !== 0) this.kb[k] = Math.sign(t) * 0.12;
    }
    const gp = this.enabled ? this._pollGamepad() : null;
    const want = { ...this.kb };
    if (gp) for (const k of Object.keys(want)) if (Math.abs(gp[k]) > Math.abs(want[k])) want[k] = gp[k];
    // 先导阀开启也要时间
    const rate = HYDRAULICS.spoolRate * dt;
    for (const k of Object.keys(this.raw)) {
      const d = want[k] - this.raw[k];
      this.raw[k] += clamp(d, -rate * 1.6, rate);
      if (Math.abs(this.raw[k]) < 1e-3) this.raw[k] = 0;
    }
  }

  get hornPressed() {
    return this.enabled && (this.horn || !!this.gpHorn);
  }

  /** 修饰键状态(Shift 不在 AXES 里,单独记) */
  trackShift() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Shift') this._shift = true;
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') this._shift = false;
    });
  }

  /**
   * 按当前手法把手柄行程翻译成各机构的动作指令。
   * 约定:返回值 > 0 一律代表"该关节角度增大":
   *   boom > 0 动臂上升 | arm > 0 斗杆伸出 | bucket > 0 铲斗卸料 | swing > 0 向右回转
   */
  commands() {
    const r = this.raw;
    const iso = this.pattern === 'ISO';
    return {
      swing: r.leftX,
      boom: iso ? -r.rightY : -r.leftY,
      arm: iso ? r.leftY : r.rightY,
      bucket: r.rightX,
      trackL: r.trackL,
      trackR: r.trackR,
    };
  }

  /** 某个机构对应哪个键(给提示用) */
  keyFor(fn, dir) {
    const iso = this.pattern === 'ISO';
    const map = {
      swing: ['A', 'D'],
      boom: iso ? ['K', 'I'] : ['S', 'W'], // [升, 降]
      arm: iso ? ['S', 'W'] : ['K', 'I'], // [收, 伸]
      bucket: ['J', 'L'], // [收, 卸]
    };
    return map[fn][dir];
  }

  stickVisual() {
    return [
      { x: this.raw.leftX, y: this.raw.leftY },
      { x: this.raw.rightX, y: this.raw.rightY },
    ];
  }

  releaseAll() {
    this.keys.clear();
    for (const k of Object.keys(this.raw)) {
      this.raw[k] = 0;
      this.kb[k] = 0;
    }
    this.horn = false;
  }
}
