/**
 * 游戏框架:加载关卡、按步骤推进、安全监控、扣分评分、存档。
 *
 * 一个关卡(scenario)= 场地布置 setup + 一串步骤 steps + 扣分规则 rules。
 * 每一步有 check(),返回 true(或 {done, progress, hint})就进入下一步。
 * 扣分不只是扣分 —— 每一条都附带"为什么不能这么干",这才是真正要学的东西。
 */
import * as THREE from 'three';
import { Cone, BallPole, Worker, BuriedPipe, makeMarker, makeLayout, makeGradeStakes } from './world.js';
import { UPPER, DEG, bucketLocal } from './config.js';
import { clamp } from './linkage.js';

export const RULES = {
  noHorn: { pts: 5, msg: '行走前未鸣笛', why: '起步前按一声喇叭,提醒周围的人你要动了。这是每个工地的硬性规定。' },
  knockCone: { pts: 5, msg: '撞倒路锥', why: '行走时要看清履带两侧和前后,转向时尾部和履带外沿都会扫过去。' },
  knockPole: { pts: 5, msg: '撞倒标杆', why: '斗齿接近目标时要放慢,用小行程点动去碰,而不是整个推过去。' },
  selfHit: { pts: 10, msg: '铲斗撞到本机', why: '斗杆收得太近、动臂又低时,铲斗会打到驾驶室前窗或履带。真机上这会打碎玻璃。' },
  hitTruckCab: { pts: 20, msg: '铲斗撞到自卸车驾驶室', why: '车里坐着司机!装车时斗子只能从车厢侧面或尾部进,永远不从驾驶室上方过。' },
  hitTruck: { pts: 8, msg: '铲斗撞到车厢', why: '先把动臂举过厢板高度再回转,回转到位后再张斗。' },
  hitObstacle: { pts: 8, msg: '撞到障碍物', why: '回转前先看尾部 —— 配重的回转半径 2.75 m,驾驶室里是看不到的。' },
  overCab: { pts: 5, msg: '满斗从自卸车驾驶室上方经过', why: '斗里的土随时可能掉下来砸穿驾驶室。回转路线要避开车头。' },
  highDrop: { pts: 3, msg: '卸料太高', why: '斗子离车厢太高就张斗,土石砸下去会砸坏车厢、震伤司机。斗子贴近车厢再慢慢张开。' },
  spillTruck: { pts: 3, msg: '装车撒料', why: '斗子没完全进到车厢上方就张斗,或者装得太满,土就撒在车外 —— 还得返工清理。' },
  reliefHold: { pts: 2, msg: '长时间憋缸', why: '油缸顶到头或者斗子顶死了还一直推手柄,溢流阀会一直泄压,油温飙升、浪费燃油。听到"吱——"就松手。' },
  hotShutdown: { pts: 5, msg: '高转速直接熄火', why: '熄火前要把油门降到最低,怠速运转几分钟,让涡轮增压器冷却。直接熄火会烧坏涡轮轴承。' },
  crankTooLong: { pts: 3, msg: '连续起动过久', why: '起动机每次不要超过 10 秒,打不着就停 30 秒再试,否则会烧起动机。' },
  coldHeavy: { pts: 2, msg: '未预热就重载', why: '冷车液压油黏度大,马上重载会伤泵、伤密封。起动后先怠速预热,再慢慢加负荷。' },
  jerkySpill: { pts: 2, msg: '回转起停过猛,土甩出斗外', why: '满斗回转要提前松手、慢慢停,让上车靠惯性滑到位。' },
  workerZone: { pts: 20, msg: '作业半径内有人仍继续作业', why: '任何人进入回转半径,必须立即停止一切动作,鸣笛示意,等人离开再继续。这是挖掘机伤人事故的头号原因。' },
  hitWorker: { fatal: true, msg: '撞到地面人员', why: '重大安全事故。' },
  gasStrike: { fatal: true, msg: '挖断燃气管道', why: '地下管线附近 1 m 内严禁机械开挖,必须人工探挖。挖断燃气管可能引发爆炸。' },
  overturn: { fatal: true, msg: '整机倾翻', why: '重心超出履带支撑范围。重载时不要把斗杆伸到最远,尤其不要在侧面。' },
  tipping: { pts: 10, msg: '出现倾翻险情', why: '车的一侧已经抬起来了!立即收回斗杆、放低载荷。' },
  lockedLeave: { pts: 5, msg: '离机前未锁定先导杆', why: '先导杆不锁,碰到手柄机器就会动。' },
};

const STORE = 'rg215-sim-v1';

export function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(STORE)) || {};
  } catch {
    return {};
  }
}
export function saveProgress(p) {
  try {
    localStorage.setItem(STORE, JSON.stringify(p));
  } catch {
    /* 隐私模式下存不了,不影响游戏 */
  }
}

export class Game {
  constructor(deps) {
    Object.assign(this, deps); // scene, terrain, ex, m, truck, fx, sound, input, rig, ui
    this.props = new THREE.Group();
    this.scene.add(this.props);
    this.knockables = [];
    this.workers = [];
    this.pipes = [];
    this.sc = null;
    this.running = false;
    this.paused = false;
    this.progress = loadProgress();
    this.settings = Object.assign({ pattern: 'ISO', voice: true, pip: false, volume: 0.8, quality: 'high' }, this.progress.settings || {});
    this.tip = new THREE.Vector3();
    this._edgeA = new THREE.Vector3();
    this.m.on('*', (e, d) => this._onMachineEvent(e, d));
    this.truck.onEvent = (e, d) => this._onTruckEvent(e, d);
  }

  saveSettings() {
    this.progress.settings = this.settings;
    saveProgress(this.progress);
  }

  // ── 关卡生命周期 ──────────────────────────────────────────────────────

  load(sc) {
    this.clear();
    this.sc = sc;
    this.time = 0;
    this.stepIndex = 0;
    this.st = {};
    this.penalties = [];
    this.fatal = null;
    this.done = false;
    this.finished = false;
    this._cool = {};
    this.stats = { ground: [], truckLoads: 0, trucksDone: 0, truckSpill: 0, cycles: 0 };
    this.custom = {};
    this.m.bucketLoad = 0;
    this.m.hookLoad = 0;
    this.fx.clear();
    this.truck.reset();
    this.truck.group.visible = false;
    this.truck.state = 'hidden';
    this.terrain.generate(sc.layout || {});
    // 默认:发动机已经着车、锁杆锁着、油门中档,停在原点
    this.m.placeAt(0, 0, 0, 0);
    this.m.resetPose();
    this.m.startEngineNow();
    this.m.setLock(true);
    this.m.setThrottle(7);
    this.m.mode = 'P';
    this.m.travelHi = false;
    this.m.autoIdle = true;
    this.m.coolant = 75;
    if (sc.setup) sc.setup(this);
    this.m.syncTerrain(true);
    this.ex.setPose(this.m.pose);
    this.input.releaseAll();
    this.running = true;
    this.paused = false;
    this.ui.hud.show(true);
    this.ui.hud.setScenario(sc, this);
    this._enterStep();
  }

  clear() {
    while (this.props.children.length) this.props.remove(this.props.children[0]);
    this.knockables = [];
    this.workers = [];
    this.pipes = [];
    this.m.obstacles = [this.truck];
    this.ui.hotspots?.clear();
  }

  exit() {
    this.running = false;
    this.clear();
    this.ui.hud.show(false);
    if (window.speechSynthesis) speechSynthesis.cancel();
  }

  get step() {
    return this.sc?.steps?.[this.stepIndex];
  }

  _enterStep() {
    const s = this.step;
    this.st = { t: 0 };
    if (!s) return;
    if (s.enter) s.enter(this, this.st);
    this.ui.hud.setStep(this.stepIndex, this.sc.steps, s, this);
    this.say(s.voice ?? (typeof s.text === 'function' ? s.text(this) : s.text));
  }

  _advance() {
    this.sound.ding();
    this.stepIndex++;
    if (this.stepIndex >= this.sc.steps.length) this.finish(true);
    else this._enterStep();
  }

  finish(completed) {
    if (this.finished) return;
    this.finished = true;
    this.running = false;
    const sc = this.sc;
    let res = {
      title: sc.title,
      kind: sc.kind,
      completed: completed && !this.fatal,
      time: this.time,
      penalties: this.penalties.slice(),
      fatal: this.fatal,
      lines: [],
    };
    const deducted = this.penalties.reduce((s, p) => s + p.pts, 0);
    res.score = clamp(100 - deducted, 0, 100);
    if (sc.score) res = sc.score(this, res) || res;
    if (res.fatal) res.score = 0;
    res.passed = res.completed && res.score >= (sc.passScore ?? 60);
    res.stars = !res.passed ? 0 : res.score >= 90 ? 3 : res.score >= 75 ? 2 : 1;
    // 存档
    const key = `${sc.kind}:${sc.id}`;
    const prev = this.progress[key] || {};
    this.progress[key] = {
      best: Math.max(prev.best || 0, res.passed ? res.score : 0),
      stars: Math.max(prev.stars || 0, res.stars),
      money: Math.max(prev.money || 0, res.money || 0),
      plays: (prev.plays || 0) + 1,
    };
    saveProgress(this.progress);
    if (res.passed) this.sound.success();
    else this.sound.buzz();
    this.say(res.passed ? '合格,干得不错。' : res.fatal ? `考核中止:${res.fatal}。` : '这次没有通过,看看扣分原因再来一次。');
    this.ui.showResults(res, this);
  }

  // ── 每帧 ──────────────────────────────────────────────────────────────

  update(dt) {
    if (!this.running || this.paused) return;
    this.time += dt;
    this.ex.getTipWorld(this.tip);
    this.tipAbove = this.tip.y - this.terrain.heightAt(this.tip.x, this.tip.z);
    // 铲斗最低点离地(行走、坡道时看这个)
    let low = 1e9;
    for (const p of this.ex.bucketWorldPoints(this._bp || (this._bp = []))) low = Math.min(low, p.y - this.terrain.heightAt(p.x, p.z));
    this.bucketAbove = Math.min(low, this.tipAbove);
    this.cmds = this.input.commands();

    for (const k of this.knockables) k.update(dt);
    for (const w of this.workers) w.update(dt, this.terrain);
    this._safety(dt);

    if (this.sc.update) this.sc.update(this, dt);
    if (this.finished) return;

    const s = this.step;
    if (s) {
      this.st.t += dt;
      const r = s.check(this, dt, this.st);
      let done = false;
      let prog = null;
      let hint = null;
      if (r === true) done = true;
      else if (r && typeof r === 'object') ({ done, progress: prog, hint } = r);
      this.ui.hud.setStepState(prog, hint);
      if (done) this._advance();
    }
    if (this.sc.timeLimit && this.time > this.sc.timeLimit && !this.finished) {
      this.addPenalty('timeout', 0, '超出时限');
      this.finish(false);
    }
  }

  _safety(dt) {
    const m = this.m;
    // 满斗从自卸车驾驶室上方过
    if (this.truck.group.visible && m.bucketLoad > 0.15) {
      if (this.truck.isOverCab(this.tip) || this.truck.isOverCab(this._bucketCenter())) this.deduct('overCab');
    }
    // 作业半径内有人
    let danger = false;
    const reach = Math.hypot(this.tip.x - m.position.x, this.tip.z - m.position.z);
    const R = Math.max(UPPER.tailRadius + 1.0, reach + 1.2);
    for (const w of this.workers) {
      if (!w.active) continue;
      const d = Math.hypot(w.position.x - m.position.x, w.position.z - m.position.z);
      if (d < R) {
        danger = true;
        const moving = Math.abs(m.swingVel) > 0.03 || m.travelling || (m.moving && m.hydraulicsLive && this._anyCmd());
        if (moving && this.time - (w.enteredAt ?? this.time) > 0.8) this.deduct('workerZone');
        w.enteredAt ??= this.time;
      } else w.enteredAt = undefined;
    }
    this.workerDanger = danger;
    this.ui.hud.alert(danger ? '⚠ 有人进入作业半径 —— 立即停止所有动作,鸣笛示警!' : null);
    // 地下管线:斗齿离管子太近
    for (const p of this.pipes) {
      if (p.struck) continue;
      const [a, b] = this.ex.getCuttingEdge(this._edgeA, new THREE.Vector3());
      if (p.distance(a) < 0.3 || p.distance(b) < 0.3 || p.distance(this.tip) < 0.3) {
        p.struck = true;
        this.addPenalty('gasStrike');
      }
    }
  }

  _anyCmd() {
    const c = this.cmds;
    return Math.abs(c.boom) + Math.abs(c.arm) + Math.abs(c.bucket) + Math.abs(c.swing) > 0.1;
  }

  _bucketCenter() {
    const [x, y] = bucketLocal([0.28, -0.7]);
    const v = new THREE.Vector3(x, y, 0);
    return this.ex.bucketPivot.localToWorld(v);
  }

  // ── 扣分 ──────────────────────────────────────────────────────────────

  /** 按规则扣分(带冷却,同一个错误不会一秒扣十次) */
  deduct(code, cooldown = 6) {
    if (!this.running) return;
    const t = this._cool[code] ?? -1e9;
    if (this.time - t < cooldown) return;
    this._cool[code] = this.time;
    this.addPenalty(code);
  }

  addPenalty(code, pts, msg, why) {
    const r = RULES[code] || {};
    const rules = this.sc?.rules || {};
    if (rules[code] === 0) return;
    const p = {
      code,
      pts: pts ?? rules[code] ?? r.pts ?? 0,
      msg: msg ?? r.msg ?? code,
      why: why ?? r.why ?? '',
      t: this.time,
    };
    if (r.fatal && !this.sc?.noFatal) {
      this.fatal = p.msg;
      this.penalties.push(p);
      this.ui.hud.toast(`✖ ${p.msg}`, 'fatal', p.why);
      this.sound.buzz();
      setTimeout(() => this.finish(false), 1800);
      return;
    }
    this.penalties.push(p);
    this.ui.hud.toast(p.pts ? `−${p.pts}  ${p.msg}` : p.msg, 'bad', p.why);
    this.sound.buzz();
    if (p.why) this.say(p.msg + '。' + p.why, true);
  }

  _onMachineEvent(e, d) {
    if (!this.running) {
      return;
    }
    switch (e) {
      case 'noHorn':
        this.deduct('noHorn', 10);
        break;
      case 'selfHit':
        this.sound.clang(0.8);
        this.deduct('selfHit', 4);
        break;
      case 'hit': {
        const o = d.obstacle;
        this.sound.clang(clamp(d.impact, 0.3, 1.5));
        if (o.kind === 'truck') this.deduct(o.lastHit === 'cab' ? 'hitTruckCab' : 'hitTruck', 3);
        else if (o.kind === 'worker') this.addPenalty('hitWorker');
        else if (o.kind === 'pipe') this.addPenalty('gasStrike');
        else this.deduct('hitObstacle', 4);
        break;
      }
      case 'knock':
        this.sound.clang(0.3);
        this.deduct(d.obstacle.kind === 'pole' ? 'knockPole' : 'knockCone', 0.3);
        break;
      case 'reliefHold':
        this.deduct('reliefHold', 10);
        break;
      case 'hotShutdown':
        this.deduct('hotShutdown');
        break;
      case 'crankTooLong':
        this.deduct('crankTooLong');
        break;
      case 'coldHeavy':
        this.deduct('coldHeavy', 30);
        break;
      case 'jerkySpill':
        this.deduct('jerkySpill', 8);
        break;
      case 'tipping':
        this.deduct('tipping', 8);
        break;
      case 'overturn':
        this.addPenalty('overturn');
        break;
      case 'startBlocked':
        this.ui.hud.toast('起动机不转 —— 先导安全锁杆没锁', 'info', '中位起动保护:锁杆必须抬起(锁定)才能打火,防止一着车机器就乱动。按 Q。');
        break;
      case 'lockedInput':
        this.ui.hud.toast('手柄没反应?先导安全锁杆还锁着', 'info', '按 Q 放下锁杆(解锁)后,液压才会接通。');
        break;
      case 'swingBlocked':
        this.ui.hud.toast('斗子插在土里,转不动', 'info', '先抬动臂把斗子拔出来再回转。别在土里硬转 —— 会别坏回转机构。');
        break;
      case 'travelBlocked':
        this.ui.hud.toast('铲斗顶住地面了,走不动', 'info', '行走前把铲斗抬离地面 20~50 cm;上坡时坡面会越来越高,斗子要跟着抬。');
        break;
      case 'jack':
        this.ui.hud.toast('车被撑起来了', 'info', '斗子顶住地面还继续压动臂,整车就会被撑起来。这是个实用技巧(清理履带、脱困),但平时挖掘时要避免。');
        break;
      case 'horn':
        // 鸣笛:作业半径里的人会赶紧走开
        for (const w of this.workers) {
          if (w.enteredAt !== undefined) {
            w.dir *= -1;
            w.speed = Math.max(w.speed, 1.8);
            w.paused = 0;
          }
        }
        break;
    }
    if (this.sc?.onEvent) this.sc.onEvent(this, e, d);
  }

  _onTruckEvent(e, d) {
    if (e === 'load') {
      if (d.dropH > 2.2) this.deduct('highDrop', 10);
      this.sound.thud(0.1 + d.vol * 2);
    }
    if (this.sc?.onTruck) this.sc.onTruck(this, e, d);
  }

  /** 落土的去向统计 */
  onSoilLand(p, vol, target, fallH) {
    if (target === 'truck') {
      const over = this.truck.addSoil(p, vol, fallH);
      for (const o of over) this._groundSoil(o.p, o.vol, true);
    } else this._groundSoil(p, vol, false);
  }

  _groundSoil(p, vol, fromTruck) {
    this.terrain.deposit(p.x, p.z, vol, 0.7);
    this.stats.ground.push({ x: p.x, z: p.z, vol });
    if (this.truck.group.visible && this.truck.state !== 'hidden') {
      const tp = this.truck.group.position;
      if (fromTruck || Math.hypot(p.x - tp.x, p.z - tp.z) < 6) {
        this.stats.truckSpill += vol;
        if (this.stats.truckSpill > 0.25 * (1 + (this._spillWarned || 0))) {
          this._spillWarned = (this._spillWarned || 0) + 1;
          this.deduct('spillTruck', 5);
        }
      }
    }
  }

  // ── 给关卡用的工具 ────────────────────────────────────────────────────

  say(text, urgent = false) {
    // 朗读前去掉 HTML;<kbd>Q</kbd> 读作"Q 键"
    text = String(text || '')
      .replace(/<kbd>(.*?)<\/kbd>/g, '$1 键')
      .replace(/<[^>]+>/g, '');
    this.ui.hud.coach(text);
    if (!this.settings.voice || !window.speechSynthesis || !text) return;
    try {
      if (urgent || speechSynthesis.speaking) speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/[()()]/g, ','));
      u.lang = 'zh-CN';
      u.rate = 1.08;
      const v = speechSynthesis.getVoices().find((v) => v.lang.startsWith('zh'));
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    } catch {
      /* 某些浏览器没有语音 */
    }
  }

  /** 上车相对底盘的回转角,-180~180,正 = 向右 */
  swingDeg() {
    return -(((((this.m.pose.swing / DEG) % 360) + 540) % 360) - 180);
  }
  headingDeg() {
    return this.m.heading / DEG;
  }
  /** 条件持续 secs 秒才算数 */
  hold(st, key, cond, secs, dt) {
    st[key] = cond ? (st[key] || 0) + dt : 0;
    return st[key] >= secs;
  }
  stopped() {
    const m = this.m;
    return Math.abs(m.swingVel) < 0.01 && !m.travelling;
  }
  marker(color, r, x, z, beam = true) {
    const mk = makeMarker(color, r, beam);
    mk.position.set(x, this.terrain.heightAt(x, z) + 0.03, z);
    this.props.add(mk);
    return mk;
  }
  cone(x, z) {
    const c = new Cone();
    c.kind = 'cone';
    c.group.position.set(x, this.terrain.heightAt(x, z), z);
    this.props.add(c.group);
    this.knockables.push(c);
    this.m.obstacles.push(c);
    return c;
  }
  pole(x, z, h) {
    const p = new BallPole(h);
    p.kind = 'pole';
    p.group.position.set(x, this.terrain.heightAt(x, z), z);
    this.props.add(p.group);
    this.knockables.push(p);
    this.m.obstacles.push(p);
    return p;
  }
  removeProp(o) {
    this.props.remove(o.group);
    this.knockables = this.knockables.filter((k) => k !== o);
    this.m.obstacles = this.m.obstacles.filter((k) => k !== o);
  }
  worker(path, speed) {
    const w = new Worker(path, speed);
    w.kind = 'worker';
    this.props.add(w.group);
    this.workers.push(w);
    this.m.obstacles.push(w);
    return w;
  }
  pipe(x0, z0, x1, z1, depth) {
    const p = new BuriedPipe(this.terrain, x0, z0, x1, z1, depth);
    p.kind = 'pipe';
    this.props.add(p.group);
    this.pipes.push(p);
    this.m.obstacles.push(p);
    return p;
  }
  layout(cx, cz, hl, hw, rot = 0) {
    const g = makeLayout(this.terrain, cx, cz, hl, hw, rot);
    this.props.add(g);
    return g;
  }
  gradeStakes(cx, cz, half, y) {
    const g = makeGradeStakes(cx, cz, half, y, this.terrain);
    this.props.add(g);
    return g;
  }
  /** 地上某区域里落了多少土(由 stats.ground 累计) */
  groundVolume(fn) {
    return this.stats.ground.reduce((s, e) => s + (fn(e.x, e.z) ? e.vol : 0), 0);
  }
  regionDepth(cx, cz, hx, hz) {
    const h = this.terrain.sampleRegion(cx, cz, hx, hz);
    const b = this.terrain.baseRegion(cx, cz, hx, hz);
    const d = h.map((v, i) => b[i] - v);
    const avg = d.reduce((s, v) => s + v, 0) / (d.length || 1);
    const sd = Math.sqrt(d.reduce((s, v) => s + (v - avg) ** 2, 0) / (d.length || 1));
    return { avg, sd, max: Math.max(...d), min: Math.min(...d) };
  }
  regionRms(cx, cz, hx, hz, target) {
    const h = this.terrain.sampleRegion(cx, cz, hx, hz);
    const rms = Math.sqrt(h.reduce((s, v) => s + (v - target) ** 2, 0) / (h.length || 1));
    const hi = Math.max(...h) - target;
    const lo = target - Math.min(...h);
    return { rms, hi, lo };
  }
  truckArrive(x, z, heading, instant = false) {
    this.truck.reset();
    this.truck.setSpot(x, z, heading);
    const avoid = { x: this.m.position.x, z: this.m.position.z };
    this.truck.avoid = avoid;
    if (instant) this.truck.parkAtSpot();
    else this.truck.arrive(undefined, avoid);
  }
}
