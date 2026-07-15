/**
 * 引擎和液压声。全部用 WebAudio 现合成,不带任何音频文件。
 *
 * 声音在这里不只是气氛 —— 真机手是**听着**声音干活的:
 * 一憋缸,发动机声调就往下掉,这是"斗子插太深了"的第一信号。
 */
export class EngineAudio {
  constructor() {
    this.ctx = null;
    this.enabled = false;
  }

  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.32;
    this.master.connect(ctx.destination);

    // ── 柴油机:基频取点火频率(4 缸 4 冲程 ≈ 转速/60×2),再叠一个八度上的谐波 ──
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0.0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    lp.Q.value = 3.5;
    this.engGain.connect(lp).connect(this.master);

    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    this.osc1.connect(this.engGain);
    this.osc2.connect(g2).connect(this.engGain);
    this.osc1.start();
    this.osc2.start();

    // ── 白噪声源,液压声和履带声都从这儿分出去 ──
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = ctx.createBufferSource();
    this.noise.buffer = buf;
    this.noise.loop = true;
    this.noise.start();

    // 液压泵/溢流阀的啸叫:动作越大越明显
    this.hydGain = ctx.createGain();
    this.hydGain.gain.value = 0;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2100;
    bp.Q.value = 7;
    this.noise.connect(bp).connect(this.hydGain).connect(this.master);

    // 履带和机体的低频轰隆
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    const rlp = ctx.createBiquadFilter();
    rlp.type = 'lowpass';
    rlp.frequency.value = 150;
    this.noise.connect(rlp).connect(this.rumbleGain).connect(this.master);

    this.enabled = true;
  }

  /**
   * rpm    发动机转速
   * load   0~1 液压负载(会让声音变闷变沉)
   * hyd    0~1 手柄动作量
   * travel 0~1 行走量
   */
  update(rpm, load, hyd, travel) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const f = (rpm / 60) * 2; // 点火频率
    this.osc1.frequency.setTargetAtTime(f, t, 0.05);
    this.osc2.frequency.setTargetAtTime(f * 2.02, t, 0.05);
    this.engGain.gain.setTargetAtTime(0.1 + load * 0.16, t, 0.08);
    this.hydGain.gain.setTargetAtTime(hyd * 0.05, t, 0.06);
    this.rumbleGain.gain.setTargetAtTime(travel * 0.22 + load * 0.05, t, 0.1);
  }
}
