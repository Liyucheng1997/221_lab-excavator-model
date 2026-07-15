/**
 * HUD:关卡面板、手柄示意图、仪表。纯 DOM,每帧只写变化的字段。
 */
import { PATTERNS } from './input.js';
import { BUCKET, ENGINE, DEG } from './config.js';
import { clamp } from './linkage.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      title: $('task-title'),
      num: $('task-num'),
      brief: $('task-brief'),
      bar: $('task-bar'),
      hint: $('task-hint'),
      tips: $('tips-list'),
      task: $('task'),
      patternName: $('pattern-name'),
      dotL: $('dot-l'),
      dotR: $('dot-r'),
      tl: $('tl'),
      tr: $('tr'),
      rpm: $('g-rpm'),
      thr: $('g-thr'),
      load: $('g-load'),
      loadBar: $('load-bar'),
      depth: $('g-depth'),
      swing: $('g-swing'),
      spill: $('spill-row'),
      cam: $('cam-name'),
      help: $('help'),
      toast: $('toast'),
    };
    this._toastTimer = null;
  }

  setTask(task, index, total) {
    this.el.title.textContent = task.title;
    this.el.num.textContent = `${index + 1} / ${total}`;
    this.el.brief.textContent = task.brief;
    this.el.tips.innerHTML = '';
    for (const t of task.tips || []) {
      const li = document.createElement('li');
      li.innerHTML = t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
      this.el.tips.appendChild(li);
    }
    this.el.task.classList.remove('done');
  }

  setTaskState(state, done) {
    this.el.bar.style.width = `${clamp(state.progress, 0, 1) * 100}%`;
    this.el.hint.textContent = state.hint || '';
    this.el.task.classList.toggle('done', !!done);
  }

  /** 手柄示意图上的四个方向标签,随手法变 */
  setPattern(pattern) {
    const p = PATTERNS[pattern];
    this.el.patternName.textContent = p.name;

    // 前推手柄 = 动臂下降 / 斗杆伸出;左右按各自定义
    const axes = {
      斗杆: { up: '伸出', down: '收回', left: '', right: '' },
      动臂: { up: '下降', down: '上升', left: '', right: '' },
      回转: { left: '左转', right: '右转' },
      铲斗: { left: '收斗', right: '卸料' },
    };
    const set = (side, cfg) => {
      const y = axes[cfg.y];
      const x = axes[cfg.x];
      $(`${side}-up`).textContent = `${cfg.y}${y.up}`;
      $(`${side}-down`).textContent = `${cfg.y}${y.down}`;
      $(`${side}-left`).textContent = `${cfg.x}${x.left}`;
      $(`${side}-right`).textContent = `${cfg.x}${x.right}`;
    };
    set('l', p.left);
    set('r', p.right);

    $('help-left').textContent = `${p.left.y}(前后) · ${p.left.x}(左右)`;
    $('help-right').textContent = `${p.right.y}(前后) · ${p.right.x}(左右)`;
  }

  setSticks(raw) {
    // SVG 里 y 向下,所以手柄前推(y>0)要取负
    this.el.dotL.setAttribute('cx', 50 + raw.leftX * 34);
    this.el.dotL.setAttribute('cy', 50 - raw.leftY * 34);
    this.el.dotR.setAttribute('cx', 50 + raw.rightX * 34);
    this.el.dotR.setAttribute('cy', 50 - raw.rightY * 34);
    const bar = (el, v) => {
      const w = Math.abs(v) * 50;
      el.style.width = `${w}%`;
      el.style.left = v >= 0 ? '50%' : `${50 - w}%`;
    };
    bar(this.el.tl, raw.trackL);
    bar(this.el.tr, raw.trackR);
  }

  setGauges(machine, throttle, tipY, groundY) {
    this.el.rpm.textContent = `${Math.round(machine.rpm)} rpm`;
    this.el.thr.textContent = `${throttle} / ${ENGINE.throttleSteps}`;
    const f = machine.bucketLoad / BUCKET.capacity;
    this.el.load.textContent = `${machine.bucketLoad.toFixed(2)} m³ (${(f * 100).toFixed(0)}%)`;
    this.el.loadBar.style.width = `${clamp(f, 0, 1) * 100}%`;

    // 斗齿相对地面:负 = 已经扎进土里
    const d = tipY - groundY;
    this.el.depth.textContent = `${d >= 0 ? '+' : ''}${d.toFixed(2)} m`;
    this.el.depth.classList.toggle('warn', d < -0.05);

    // 回转角:显示上车相对底盘转了多少,真机上这个关系很要命
    let s = ((machine.pose.swing / DEG) % 360 + 540) % 360 - 180;
    this.el.swing.textContent = `${s > 0 ? '右' : s < 0 ? '左' : ''} ${Math.abs(s).toFixed(0)}°`;

    this.el.spill.classList.toggle('on', machine.spilling);
  }

  setCamera(name) {
    this.el.cam.textContent = name;
  }

  toggleHelp() {
    this.el.help.classList.toggle('hidden');
  }

  toast(msg, ms = 2600) {
    this.el.toast.textContent = msg;
    this.el.toast.classList.add('on');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.el.toast.classList.remove('on'), ms);
  }
}
