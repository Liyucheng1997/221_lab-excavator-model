/**
 * 声音。全部用 WebAudio 现合成,不带任何音频文件。
 *
 * 声音在这里不只是气氛 —— 真机手是**听着**声音干活的:
 *   · 憋缸时溢流阀会"吱——"地尖叫,发动机声调往下掉:斗子插太深了 / 油缸顶到头了
 *   · 行走时有行走报警器"嘀、嘀"地响
 *   · 自卸车倒车有倒车喇叭
 */
export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.volume = 0.8;
  }

  start() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.35 * this.volume;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    // 噪声源
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const noise = () => {
      const n = ctx.createBufferSource();
      n.buffer = buf;
      n.loop = true;
      n.start();
      return n;
    };

    // ── 柴油机:点火频率(6 缸 4 冲程 = 转速/60×3)+ 谐波 + 燃烧噪声 ──
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    lp.Q.value = 2.5;
    this.engLp = lp;
    this.engGain.connect(lp).connect(this.master);
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    const g2 = ctx.createGain();
    g2.gain.value = 0.3;
    this.osc1.connect(this.engGain);
    this.osc2.connect(g2).connect(this.engGain);
    this.osc1.start();
    this.osc2.start();
    // 燃烧噪声用低频调制
    const combNoise = noise();
    const cbp = ctx.createBiquadFilter();
    cbp.type = 'bandpass';
    cbp.frequency.value = 180;
    cbp.Q.value = 1.2;
    this.combGain = ctx.createGain();
    this.combGain.gain.value = 0;
    combNoise.connect(cbp).connect(this.combGain).connect(this.master);
    // 涡轮增压的哨音
    this.turbo = ctx.createOscillator();
    this.turbo.type = 'sine';
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turbo.connect(this.turboGain).connect(this.master);
    this.turbo.start();

    // ── 液压泵声 ──
    const hn = noise();
    const hbp = ctx.createBiquadFilter();
    hbp.type = 'bandpass';
    hbp.frequency.value = 1400;
    hbp.Q.value = 3;
    this.hydGain = ctx.createGain();
    this.hydGain.gain.value = 0;
    hn.connect(hbp).connect(this.hydGain).connect(this.master);
    this.hydBp = hbp;

    // ── 溢流阀尖叫 ──
    const rn = noise();
    const rbp = ctx.createBiquadFilter();
    rbp.type = 'bandpass';
    rbp.frequency.value = 3200;
    rbp.Q.value = 18;
    this.reliefGain = ctx.createGain();
    this.reliefGain.gain.value = 0;
    rn.connect(rbp).connect(this.reliefGain).connect(this.master);

    // ── 履带:低频轰隆 + 链节咔嗒 ──
    const tn = noise();
    const tlp = ctx.createBiquadFilter();
    tlp.type = 'lowpass';
    tlp.frequency.value = 140;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    tn.connect(tlp).connect(this.rumbleGain).connect(this.master);
    this.clankT = 0;

    // ── 起动机 ──
    this.starter = ctx.createOscillator();
    this.starter.type = 'sawtooth';
    this.starter.frequency.value = 55;
    this.starterGain = ctx.createGain();
    this.starterGain.gain.value = 0;
    const slp = ctx.createBiquadFilter();
    slp.type = 'lowpass';
    slp.frequency.value = 700;
    this.starter.connect(slp).connect(this.starterGain).connect(this.master);
    this.starter.start();

    // ── 喇叭:两个音叠在一起 ──
    this.hornGain = ctx.createGain();
    this.hornGain.gain.value = 0;
    const hlp = ctx.createBiquadFilter();
    hlp.type = 'lowpass';
    hlp.frequency.value = 2500;
    this.hornGain.connect(hlp).connect(this.master);
    for (const f of [415, 520]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(this.hornGain);
      o.start();
    }

    // 蜂鸣(行走报警 / 倒车 / 警告)
    this.beepT = 0;
    this.truckBeepT = 0;
    this.warnT = 0;
    this.enabled = true;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = 0.35 * v;
  }

  _beep(freq, dur, vol = 0.12, type = 'square') {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.setValueAtTime(vol, t + dur - 0.02);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  _burst(freq, dur, vol, q = 1, type = 'lowpass') {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(f).connect(g).connect(this.master);
    n.start(t, Math.random());
    n.stop(t + dur);
  }

  /** 金属撞击声 */
  clang(strength = 1) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (const f of [310, 587, 941, 1523]) {
      const o = ctx.createOscillator();
      o.frequency.value = f * (0.97 + Math.random() * 0.06);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.08 * strength, t);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.9);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 1);
    }
    this._burst(900, 0.15, 0.3 * strength, 1, 'bandpass');
  }

  /** 土落进车厢/地面的闷响 */
  thud(vol = 0.3) {
    this._burst(220, 0.35, Math.min(0.5, vol));
  }

  ding() {
    this._beep(880, 0.12, 0.08, 'sine');
    setTimeout(() => this._beep(1320, 0.18, 0.08, 'sine'), 110);
  }
  buzz() {
    this._beep(180, 0.35, 0.12, 'sawtooth');
  }
  success() {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this._beep(f, 0.16, 0.07, 'triangle'), i * 120));
  }

  /**
   * 每帧:
   *   s = { rpm, load, hyd, relief, travel, crank, running, horn, travelAlarm, truckReversing, warn }
   */
  update(dt, s) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const on = s.running ? 1 : 0;
    const f = (s.rpm / 60) * 3;
    this.osc1.frequency.setTargetAtTime(Math.max(8, f), t, 0.05);
    this.osc2.frequency.setTargetAtTime(Math.max(8, f * 2.01), t, 0.05);
    this.engLp.frequency.setTargetAtTime(300 + s.load * 500 + s.rpm * 0.12, t, 0.1);
    const engVol = s.rpm > 50 ? (0.06 + s.load * 0.12 + (s.rpm / 2000) * 0.06) * Math.min(1, s.rpm / 600) : 0;
    this.engGain.gain.setTargetAtTime(engVol, t, 0.08);
    this.combGain.gain.setTargetAtTime(on * (0.04 + s.load * 0.1), t, 0.1);
    this.turbo.frequency.setTargetAtTime(1800 + s.rpm * 1.4, t, 0.3);
    this.turboGain.gain.setTargetAtTime(on * (s.rpm / 2000) * 0.012, t, 0.3);
    this.hydBp.frequency.setTargetAtTime(900 + s.rpm * 0.5, t, 0.1);
    this.hydGain.gain.setTargetAtTime(on * s.hyd * 0.05, t, 0.06);
    this.reliefGain.gain.setTargetAtTime(on * s.relief * 0.09, t, 0.04);
    this.rumbleGain.gain.setTargetAtTime(s.travel * 0.35, t, 0.1);
    this.starterGain.gain.setTargetAtTime(s.crank ? 0.18 : 0, t, 0.03);
    this.starter.frequency.setTargetAtTime(s.crank ? 48 + Math.random() * 20 : 50, t, 0.02);
    this.hornGain.gain.setTargetAtTime(s.horn ? 0.09 : 0, t, 0.01);

    // 履带链节咔嗒
    if (s.travel > 0.05) {
      this.clankT -= dt * (2 + s.travel * 8);
      if (this.clankT <= 0) {
        this.clankT = 1;
        this._burst(1600, 0.05, 0.05 * s.travel, 4, 'bandpass');
      }
    }
    // 行走报警器
    if (s.travelAlarm) {
      this.beepT -= dt;
      if (this.beepT <= 0) {
        this.beepT = 0.9;
        this._beep(1250, 0.35, 0.05);
      }
    } else this.beepT = 0;
    // 自卸车倒车喇叭
    if (s.truckReversing) {
      this.truckBeepT -= dt;
      if (this.truckBeepT <= 0) {
        this.truckBeepT = 0.8;
        this._beep(980, 0.4, 0.035, 'sine');
      }
    }
    // 倾翻警报
    if (s.warn) {
      this.warnT -= dt;
      if (this.warnT <= 0) {
        this.warnT = 0.35;
        this._beep(2200, 0.15, 0.06);
      }
    }
  }
}
