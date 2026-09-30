/**
 * 界面:菜单、关卡简介、游戏内 HUD、绕机检查热点、成绩单、暂停、帮助。纯 DOM。
 */
import * as THREE from 'three';
import { PATTERNS } from './input.js';
import { BUCKET, ENGINE, UPPER } from './config.js';
import { clamp } from './linkage.js';
import { LESSONS, EXAMS, JOBS, FREE } from './scenarios.js';

const $ = (s, r = document) => r.querySelector(s);
const h = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const stars = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

// ── 游戏内 HUD ─────────────────────────────────────────────────────────
class Hud {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div id="coach" class="panel">
        <div class="c-head"><span id="c-title"></span><span id="c-count"></span></div>
        <div id="c-step"></div>
        <div class="bar"><i id="c-bar"></i></div>
        <div id="c-hint"></div>
        <div id="c-say"></div>
        <div class="c-foot"><span id="c-time"></span><span id="c-score"></span></div>
      </div>
      <div id="alert"></div>
      <div id="toasts"></div>
      <div id="topbar" class="panel">
        <span id="cam-name"></span>
        <button data-act="camera" title="C">视角 C</button>
        <button data-act="pip" title="Tab">侧视小窗 Tab</button>
        <button data-act="help" title="H">按键 H</button>
        <button data-act="pause" title="Esc">暂停 Esc</button>
      </div>
      <div id="grade" class="panel hidden"><span>斗齿相对设计标高</span><b id="grade-v"></b></div>
      <div id="sticks" class="panel">
        <div class="sticks-head"><span id="pattern-name"></span><span class="dim">P 切换</span></div>
        <div class="stick-pair">
          ${['l', 'r']
            .map(
              (s) => `
          <div class="stick-box">
            <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" class="ring"/><line x1="50" y1="8" x2="50" y2="92" class="ax"/><line x1="8" y1="50" x2="92" y2="50" class="ax"/><circle id="dot-${s}" cx="50" cy="50" r="8" class="dot"/></svg>
            <div class="lbl up" id="${s}-up"></div><div class="lbl down" id="${s}-down"></div>
            <div class="lbl left" id="${s}-left"></div><div class="lbl right" id="${s}-right"></div>
            <div class="stick-name">${s === 'l' ? '左手柄 <kbd>WASD</kbd>' : '右手柄 <kbd>IJKL</kbd>'}</div>
          </div>`
            )
            .join('')}
        </div>
        <div class="tracks-row">
          <div class="track-ind"><span>左履带</span><div class="tbar"><i id="tl"></i></div><kbd>R/F</kbd></div>
          <div class="track-ind"><span>右履带</span><div class="tbar"><i id="tr"></i></div><kbd>T/G</kbd></div>
        </div>
      </div>
      <div id="machine" class="panel">
        <div class="m-row m-top">
          <span id="m-lock" class="badge"></span>
          <span id="m-engine" class="badge"></span>
          <span id="m-key" class="badge dim-b"></span>
        </div>
        <div class="m-grid">
          <span>转速</span><b id="m-rpm"></b>
          <span>油门 <kbd>-</kbd><kbd>+</kbd></span><b id="m-thr"></b>
          <span>模式 <kbd>M</kbd> · 行走 <kbd>V</kbd></span><b id="m-mode"></b>
          <span>水温</span><b id="m-temp"></b>
          <span>斗内土量</span><b id="m-load"></b>
          <span>斗齿离地</span><b id="m-tip"></b>
          <span>回转角</span><b id="m-swing"></b>
          <span>稳定性</span><b><div class="bar thin"><i id="m-stab"></i></div></b>
        </div>
        <div id="m-warn"></div>
      </div>
      <div id="keys-hint"></div>
    `;
    this.el = {};
    for (const n of root.querySelectorAll('[id]')) this.el[n.id] = n;
    this._toastN = 0;
  }

  show(v) {
    this.root.classList.toggle('hidden', !v);
  }

  setScenario(sc, g) {
    this.el['c-title'].textContent = sc.title;
    this.el['c-say'].textContent = '';
    this.el.toasts.innerHTML = '';
    this.alert(null);
  }

  setStep(i, steps, step, g) {
    this.el['c-count'].textContent = steps.length > 1 ? `${i + 1} / ${steps.length}` : '';
    const t = typeof step.text === 'function' ? step.text(g) : step.text;
    this.el['c-step'].innerHTML = t;
    this.el['c-hint'].textContent = '';
    this.el['c-bar'].style.width = '0%';
    this._g = g;
  }

  setStepState(progress, hint) {
    this.el['c-bar'].style.width = progress == null ? '0%' : `${clamp(progress, 0, 1) * 100}%`;
    this.el['c-bar'].parentElement.classList.toggle('hidden', progress == null);
    if (hint !== undefined && hint !== this._hint) {
      this._hint = hint;
      this.el['c-hint'].textContent = hint || '';
    }
  }

  coach(text) {
    this.el['c-say'].textContent = text ? `🎧 ${text.replace(/<[^>]+>/g, '')}` : '';
  }

  alert(text) {
    if (text === this._alert) return;
    this._alert = text;
    this.el.alert.textContent = text || '';
    this.el.alert.classList.toggle('on', !!text);
  }

  toast(text, kind = 'info', why = '') {
    const t = h(`<div class="toast ${kind}"><b></b>${why ? '<p></p>' : ''}</div>`);
    t.querySelector('b').textContent = text;
    if (why) t.querySelector('p').textContent = why;
    this.el.toasts.prepend(t);
    while (this.el.toasts.children.length > 4) this.el.toasts.lastChild.remove();
    setTimeout(() => t.classList.add('out'), kind === 'fatal' ? 8000 : 6500);
    setTimeout(() => t.remove(), kind === 'fatal' ? 8600 : 7100);
  }

  setPattern(p) {
    const P = PATTERNS[p];
    this.el['pattern-name'].textContent = P.name;
    const axes = {
      斗杆: { up: '伸出', down: '收回' },
      动臂: { up: '下降', down: '上升' },
      回转: { left: '左转', right: '右转' },
      铲斗: { left: '收斗', right: '卸料' },
    };
    const set = (side, cfg) => {
      this.el[`${side}-up`].textContent = `${cfg.y}${axes[cfg.y].up}`;
      this.el[`${side}-down`].textContent = `${cfg.y}${axes[cfg.y].down}`;
      this.el[`${side}-left`].textContent = `${cfg.x}${axes[cfg.x].left}`;
      this.el[`${side}-right`].textContent = `${cfg.x}${axes[cfg.x].right}`;
    };
    set('l', P.left);
    set('r', P.right);
  }

  setCamera(name) {
    this.el['cam-name'].textContent = `📷 ${name}`;
  }

  update(g) {
    const m = g.m;
    const E = this.el;
    const raw = g.input.raw;
    E['dot-l'].setAttribute('cx', 50 + raw.leftX * 34);
    E['dot-l'].setAttribute('cy', 50 - raw.leftY * 34);
    E['dot-r'].setAttribute('cx', 50 + raw.rightX * 34);
    E['dot-r'].setAttribute('cy', 50 - raw.rightY * 34);
    const bar = (el, v) => {
      const w = Math.abs(v) * 50;
      el.style.width = `${w}%`;
      el.style.left = v >= 0 ? '50%' : `${50 - w}%`;
    };
    bar(E.tl, raw.trackL);
    bar(E.tr, raw.trackR);

    const set = (id, txt) => {
      if (E[id]._t !== txt) {
        E[id].innerHTML = txt;
        E[id]._t = txt;
      }
    };
    set('m-lock', m.locked ? '🔒 先导锁定 <kbd>Q</kbd>' : '🔓 已解锁 <kbd>Q</kbd>');
    E['m-lock'].className = `badge ${m.locked ? 'bad-b' : 'ok-b'}`;
    const eng = m.engine === 'running' ? '发动机运转' : m.engine === 'crank' ? '起动中…' : '发动机熄火';
    set('m-engine', eng);
    E['m-engine'].className = `badge ${m.running ? 'ok-b' : 'dim-b'}`;
    set('m-key', `钥匙 ${m.key.toUpperCase()} <kbd>E</kbd>`);
    set('m-rpm', `${Math.round(m.rpm)} rpm${m.autoDecelActive ? ' <small>自动怠速</small>' : ''}`);
    set('m-thr', `${m.throttle} / ${ENGINE.throttleSteps}`);
    set('m-mode', `${ENGINE.modes[m.mode].name} · ${m.travelHi ? '兔(高速)' : '龟(低速)'}`);
    set('m-temp', `${m.coolant.toFixed(0)} °C`);
    E['m-temp'].classList.toggle('warn', m.coolant < 40 && m.running);
    const f = m.bucketLoad / BUCKET.capacity;
    set('m-load', `${m.bucketLoad.toFixed(2)} m³ <small>(${(f * 100).toFixed(0)}%)</small>`);
    const d = g.tipAbove ?? 0;
    set('m-tip', d < 0 ? `入土 ${(-d).toFixed(2)} m` : `${d.toFixed(2)} m`);
    E['m-tip'].classList.toggle('warn', d < -0.02);
    const s = g.swingDeg();
    set('m-swing', `${s > 1 ? '右 ' : s < -1 ? '左 ' : ''}${Math.abs(s).toFixed(0)}°`);
    const st = clamp(m.stability, -1, 1);
    E['m-stab'].style.width = `${clamp((st + 0.2) / 1.2, 0.02, 1) * 100}%`;
    E['m-stab'].style.background = st > 0.4 ? 'var(--ok)' : st > 0.15 ? 'var(--acc)' : 'var(--warn)';

    const warns = [];
    if (m.spilling) warns.push('斗口翻过了,土在往外撒');
    if (m.relief > 0.6) warns.push('憋缸!溢流阀在泄压 —— 松手');
    if (m.tilt.kind === 'jack' && m.tilt.angle > 0.02) warns.push('车被铲斗撑起来了');
    if (m.tilt.kind === 'tip') warns.push('⚠ 倾翻危险!收斗杆、放低载荷');
    if (m.flowShare < 0.85 && m.hydraulicsLive) warns.push('复合动作太多,泵流量不够分');
    if (Math.abs(s) > 100 && (Math.abs(raw.trackL) > 0.1 || Math.abs(raw.trackR) > 0.1)) warns.push('驱动轮在前方 —— 行走杆方向是反的!');
    if (m.selfTest > 0) warns.push('仪表自检中…');
    set('m-warn', warns.map((w) => `<div>${w}</div>`).join(''));

    // 设计标高读数
    if (g.designY != null) {
      E.grade.classList.remove('hidden');
      const e = g.tip.y - g.designY;
      set('grade-v', `${e >= 0 ? '+' : ''}${(e * 100).toFixed(0)} cm`);
      E['grade-v'].style.color = Math.abs(e) < 0.05 ? 'var(--ok)' : e > 0 ? 'var(--acc)' : 'var(--warn)';
    } else E.grade.classList.add('hidden');

    // 计时 / 得分
    const pen = g.penalties?.reduce((a, p) => a + p.pts, 0) || 0;
    set('c-time', `⏱ ${fmt(g.time)}${g.sc?.timeLimit ? ` / ${fmt(g.sc.timeLimit)}` : ''}`);
    set('c-score', g.sc?.kind === 'free' ? '' : `得分 ${Math.max(0, 100 - pen)}`);

    // 动态文字(data-live)
    for (const el of this.el['c-step'].querySelectorAll('[data-live]')) {
      if (el.dataset.live === 'throttle') el.textContent = m.throttle;
    }
  }
}

// ── 绕机检查热点 ───────────────────────────────────────────────────────
class Hotspots {
  constructor(root, camera) {
    this.root = root;
    this.camera = camera;
    this.items = new Map();
    this._v = new THREE.Vector3();
  }
  add(item) {
    const el = h(`<button class="hotspot"><i></i><span></span></button>`);
    el.querySelector('span').textContent = item.label;
    el.onclick = (e) => {
      e.stopPropagation();
      item.onClick();
    };
    this.root.appendChild(el);
    this.items.set(item.id, { ...item, el });
  }
  mark(id, state) {
    const it = this.items.get(id);
    if (it) it.el.className = `hotspot ${state}`;
  }
  clear() {
    for (const it of this.items.values()) it.el.remove();
    this.items.clear();
  }
  update(w, hgt) {
    for (const it of this.items.values()) {
      const p = this._v.copy(it.at()).project(this.camera);
      const vis = p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
      it.el.style.display = vis ? '' : 'none';
      it.el.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * hgt}px)`;
    }
  }
}

// ── 主界面 ─────────────────────────────────────────────────────────────
export class UI {
  constructor(app) {
    this.app = app; // { game, start(sc), onSettings }
    const root = $('#ui');
    root.innerHTML = `
      <div id="hud" class="hidden"></div>
      <div id="hotspots"></div>
      <div id="menu" class="overlay"></div>
      <div id="modal" class="overlay hidden"></div>
    `;
    this.hud = new Hud($('#hud'));
    this.menuEl = $('#menu');
    this.modalEl = $('#modal');
    this.hotspots = new Hotspots($('#hotspots'), app.camera);
    $('#topbar').addEventListener('click', (e) => {
      const a = e.target.closest('button')?.dataset.act;
      if (a) app.action(a);
    });
  }

  get menuOpen() {
    return !this.menuEl.classList.contains('hidden');
  }
  get modalOpen() {
    return !this.modalEl.classList.contains('hidden');
  }

  // ── 菜单 ──
  showMenu(page = 'main') {
    this.menuEl.classList.remove('hidden');
    const P = this.app.game.progress;
    const card = (sc) => {
      const p = P[`${sc.kind}:${sc.id}`] || {};
      return `<button class="card" data-sc="${sc.kind}:${sc.id}">
        <div class="card-t">${sc.title}</div>
        <div class="card-s">${sc.subtitle || ''}</div>
        <div class="card-f"><span class="stars">${stars(p.stars || 0)}</span>${p.best ? `<span>最佳 ${p.best}</span>` : ''}${p.money ? `<span>¥${p.money}</span>` : ''}</div>
      </button>`;
    };
    const lessonsDone = LESSONS.filter((s) => (P[`lesson:${s.id}`]?.stars || 0) > 0).length;
    let body = '';
    if (page === 'main') {
      body = `
        <div class="title-block">
          <div class="brand">锐工 RG215 · 20 吨级液压挖掘机</div>
          <h1>挖掘机驾驶培训模拟器</h1>
          <p class="sub">真实比例、真实操纵、真实工况 —— 从绕机检查到考证实操,一步一步学会开挖掘机</p>
        </div>
        <div class="menu-grid">
          <button class="big" data-page="lessons"><b>驾校课程</b><span>10 节课,从零开始 · 已完成 ${lessonsDone}/10</span></button>
          <button class="big" data-page="exam"><b>考证模拟</b><span>六个实操项目,百分制,80 分合格</span></button>
          <button class="big" data-page="jobs"><b>工地任务</b><span>基坑、管沟、场地平整,真实工况</span></button>
          <button class="big" data-sc="free:free"><b>自由练习</b><span>土堆 + 自卸车 + 标杆,随便玩</span></button>
        </div>
        <div class="menu-row">
          <button data-page="settings">设置</button>
          <button data-page="help">按键说明</button>
        </div>
        <p class="dim center">建议接一个游戏手柄:左右摇杆正好对应真机的两根先导手柄,可以真正地半推。</p>`;
    } else if (page === 'lessons' || page === 'exam' || page === 'jobs') {
      const list = page === 'lessons' ? LESSONS : page === 'exam' ? EXAMS : JOBS;
      const name = { lessons: '驾校课程', exam: '考证模拟', jobs: '工地任务' }[page];
      body = `<div class="page-head"><button data-page="main">← 返回</button><h2>${name}</h2></div>
        <div class="cards">${list.map(card).join('')}</div>`;
    } else if (page === 'settings') {
      const s = this.app.game.settings;
      body = `<div class="page-head"><button data-page="main">← 返回</button><h2>设置</h2></div>
        <div class="settings">
          <label>操作手法</label>
          <div class="seg" data-set="pattern">
            <button data-v="ISO" class="${s.pattern === 'ISO' ? 'sel' : ''}"><b>ISO 手法</b><span>国内绝大多数机器(小松、三一、卡特国内版出厂默认)。左手:斗杆+回转;右手:动臂+铲斗</span></button>
            <button data-v="SAE" class="${s.pattern === 'SAE' ? 'sel' : ''}"><b>SAE 手法</b><span>美标。动臂和斗杆跟 ISO 对调:左手动臂,右手斗杆</span></button>
          </div>
          <label>教练语音</label>
          <div class="seg small" data-set="voice"><button data-v="1" class="${s.voice ? 'sel' : ''}">开</button><button data-v="0" class="${!s.voice ? 'sel' : ''}">关</button></div>
          <label>默认打开侧视小窗</label>
          <div class="seg small" data-set="pip"><button data-v="1" class="${s.pip ? 'sel' : ''}">开</button><button data-v="0" class="${!s.pip ? 'sel' : ''}">关</button></div>
          <label>画质</label>
          <div class="seg small" data-set="quality"><button data-v="high" class="${s.quality === 'high' ? 'sel' : ''}">高</button><button data-v="low" class="${s.quality === 'low' ? 'sel' : ''}">低(笔记本/集显)</button></div>
          <label>音量</label>
          <input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-set="volume">
          <button class="danger" data-act="resetProgress">清除学习进度</button>
        </div>`;
    } else if (page === 'help') {
      body = `<div class="page-head"><button data-page="main">← 返回</button><h2>按键说明</h2></div>${helpTable(this.app.game.settings.pattern)}`;
    }
    this.menuEl.innerHTML = `<div class="menu-card ${page === 'main' ? '' : 'wide'}">${body}</div>`;
    this.menuEl.classList.toggle('main', page === 'main');
    this.menuEl.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.app.sound.start();
      if (b.dataset.page) this.showMenu(b.dataset.page);
      else if (b.dataset.sc) this.showBrief(b.dataset.sc);
      else if (b.dataset.act === 'resetProgress') {
        if (confirm('确定清除所有学习进度?')) {
          this.app.game.progress = { settings: this.app.game.settings };
          this.app.game.saveSettings();
          this.showMenu('settings');
        }
      } else if (b.parentElement?.dataset.set) {
        const k = b.parentElement.dataset.set;
        let v = b.dataset.v;
        if (k === 'voice' || k === 'pip') v = v === '1';
        this.app.setSetting(k, v);
        this.showMenu('settings');
      }
    };
    const vol = this.menuEl.querySelector('input[data-set="volume"]');
    if (vol) vol.oninput = () => this.app.setSetting('volume', parseFloat(vol.value));
  }

  hideMenu() {
    this.menuEl.classList.add('hidden');
  }

  findScenario(key) {
    const [kind, id] = key.split(':');
    const all = [...LESSONS, ...EXAMS, ...JOBS, FREE];
    return all.find((s) => s.kind === kind && s.id === id);
  }

  showBrief(key) {
    const sc = this.findScenario(key);
    const back = { lesson: 'lessons', exam: 'exam', job: 'jobs', free: 'main' }[sc.kind];
    this.menuEl.classList.remove('hidden', 'main');
    this.menuEl.innerHTML = `<div class="menu-card wide brief">
      <div class="page-head"><button data-page="${back}">← 返回</button><h2>${sc.title}</h2></div>
      <p class="brief-text">${sc.brief}</p>
      <div class="goals"><b>目标</b><ul>${sc.goals.map((g) => `<li>${g}</li>`).join('')}</ul></div>
      ${sc.timeLimit ? `<p class="dim">时限 ${fmt(sc.timeLimit)}</p>` : ''}
      <p class="dim">当前手法:${PATTERNS[this.app.game.settings.pattern].name}(可在设置里更改,或游戏中按 P)</p>
      <button class="primary" data-go="1">开 始</button>
    </div>`;
    this.menuEl.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.page) this.showMenu(b.dataset.page);
      if (b.dataset.go) {
        this.hideMenu();
        this.app.start(sc);
      }
    };
  }

  // ── 弹窗 ──
  _modal(html, onClick) {
    this.modalEl.innerHTML = `<div class="modal-card">${html}</div>`;
    this.modalEl.classList.remove('hidden');
    this.modalEl.onclick = (e) => {
      const b = e.target.closest('button');
      if (b) onClick(b);
    };
  }
  closeModal() {
    this.modalEl.classList.add('hidden');
    this.modalEl.innerHTML = '';
  }

  inspect({ title, text, options, onPick }) {
    this._modal(
      `<h3>🔍 ${title}</h3><p class="inspect-text">${text}</p><div class="modal-btns">${options
        .map((o) => `<button data-v="${o.value}">${o.label}</button>`)
        .join('')}</div>`,
      (b) => {
        this.closeModal();
        onPick(b.dataset.v);
      }
    );
  }

  showPause() {
    const g = this.app.game;
    this._modal(
      `<h3>已暂停</h3>
      <p class="dim">${g.sc?.title || ''}</p>
      <div class="modal-btns col">
        <button data-a="resume" class="primary">继续</button>
        <button data-a="restart">重新开始</button>
        <button data-a="help">按键说明</button>
        <button data-a="menu">退出到菜单</button>
      </div>`,
      (b) => {
        const a = b.dataset.a;
        if (a === 'resume') this.app.resume();
        if (a === 'restart') {
          this.closeModal();
          this.app.start(g.sc);
        }
        if (a === 'help') this.showHelp(true);
        if (a === 'menu') {
          this.closeModal();
          this.app.toMenu();
        }
      }
    );
  }

  showHelp(fromPause = false) {
    this._modal(`${helpTable(this.app.game.settings.pattern)}<div class="modal-btns"><button data-a="close" class="primary">关闭</button></div>`, () => {
      if (fromPause) this.showPause();
      else this.app.resume();
    });
  }

  showResults(res, g) {
    const pens = res.penalties.length
      ? `<div class="pens"><b>扣分项</b>${res.penalties
          .map((p) => `<div class="pen"><span>${p.pts ? `−${p.pts}` : '✖'}</span><div><b>${p.msg}</b>${p.why ? `<p>${p.why}</p>` : ''}</div></div>`)
          .join('')}</div>`
      : '<p class="good-line">没有任何违规操作 👍</p>';
    const verdict = res.fatal ? `不合格 · ${res.fatal}` : res.passed ? (res.kind === 'exam' ? '考核合格' : '完成') : res.completed ? '未达标' : '未完成';
    this._modal(
      `<div class="result ${res.passed ? 'pass' : 'fail'}">
        <div class="r-title">${res.title}</div>
        <div class="r-verdict">${verdict}</div>
        <div class="r-score"><b>${Math.round(res.score)}</b><span>分</span></div>
        <div class="r-stars">${stars(res.stars)}</div>
        <div class="r-lines">${res.lines.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
        ${pens}
      </div>
      <div class="modal-btns">
        <button data-a="retry">再来一次</button>
        ${res.passed && this.nextOf(g.sc) ? '<button data-a="next" class="primary">下一课 →</button>' : ''}
        <button data-a="menu">返回菜单</button>
      </div>`,
      (b) => {
        const a = b.dataset.a;
        this.closeModal();
        if (a === 'retry') this.app.start(g.sc);
        else if (a === 'next') {
          const n = this.nextOf(g.sc);
          this.app.toMenu(true);
          this.showBrief(`${n.kind}:${n.id}`);
        }
        else this.app.toMenu();
      }
    );
  }

  nextOf(sc) {
    const list = sc.kind === 'lesson' ? LESSONS : sc.kind === 'job' ? JOBS : null;
    if (!list) return null;
    const i = list.indexOf(sc);
    return list[i + 1] || null;
  }
}

function helpTable(pattern) {
  const P = PATTERNS[pattern];
  return `<div class="help">
    <table>
      <tr><th colspan="2">工作装置 —— 两根先导手柄(${P.name})</th></tr>
      <tr><td><kbd>W</kbd><kbd>S</kbd></td><td>左手柄 前推/后拉:${P.left.y === '斗杆' ? '斗杆伸出 / 收回' : '动臂下降 / 上升'}</td></tr>
      <tr><td><kbd>A</kbd><kbd>D</kbd></td><td>左手柄 左/右:向左 / 向右回转</td></tr>
      <tr><td><kbd>I</kbd><kbd>K</kbd> 或 ↑↓</td><td>右手柄 前推/后拉:${P.right.y === '动臂' ? '动臂下降 / 上升' : '斗杆伸出 / 收回'}</td></tr>
      <tr><td><kbd>J</kbd><kbd>L</kbd> 或 ←→</td><td>右手柄 左/右:收斗 / 卸料</td></tr>
      <tr><td><kbd>Shift</kbd></td><td>按住:微操(手柄最多推 1/3)</td></tr>
      <tr><th colspan="2">行走 —— 两根行走杆(左右履带分开控制)</th></tr>
      <tr><td><kbd>R</kbd><kbd>F</kbd></td><td>左履带 前进 / 后退</td></tr>
      <tr><td><kbd>T</kbd><kbd>G</kbd></td><td>右履带 前进 / 后退</td></tr>
      <tr><td><kbd>V</kbd></td><td>行走速度 龟(低速)/ 兔(高速)</td></tr>
      <tr><th colspan="2">驾驶室开关</th></tr>
      <tr><td><kbd>E</kbd></td><td>钥匙:按一下 OFF→ON;在 ON 时按住 = START 打火;运转时按一下 = 熄火</td></tr>
      <tr><td><kbd>Q</kbd></td><td>先导安全锁杆:抬起 = 锁定(液压切断),放下 = 解锁</td></tr>
      <tr><td><kbd>空格</kbd></td><td>喇叭(行走前、放车时鸣笛)</td></tr>
      <tr><td><kbd>-</kbd> <kbd>+</kbd></td><td>油门旋钮 1~10 档</td></tr>
      <tr><td><kbd>M</kbd> / <kbd>U</kbd> / <kbd>B</kbd></td><td>作业模式 P/E/L · 自动怠速 · 工作灯</td></tr>
      <tr><th colspan="2">其他</th></tr>
      <tr><td><kbd>C</kbd></td><td>切换视角(驾驶室 / 环视 / 跟随 / 侧视 / 俯视);驾驶室视角里拖动鼠标转头、滚轮缩放、双击回正</td></tr>
      <tr><td><kbd>Tab</kbd></td><td>侧视小窗(判断远近用)</td></tr>
      <tr><td><kbd>P</kbd></td><td>切换 ISO / SAE 手法</td></tr>
      <tr><td><kbd>Enter</kbd></td><td>交卷 / 验收(部分任务)</td></tr>
      <tr><td><kbd>X</kbd></td><td>一键收拢(仅自由练习)</td></tr>
      <tr><td><kbd>Esc</kbd></td><td>暂停</td></tr>
    </table>
    <p class="dim">游戏手柄:左右摇杆 = 两根先导手柄;LT/RT 左右履带前进,LB/RB 后退;A 喇叭,B 锁杆,X 龟兔档,Y 视角,Back 钥匙,Start 暂停,十字键上下 油门。</p>
  </div>`;
}
