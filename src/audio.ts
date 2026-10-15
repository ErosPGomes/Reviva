import { clamp } from "./math";

export type LockTone = "none" | "seeking" | "locked";
export type Threat = "none" | "lock" | "missile";

export interface AudioFrame {
  throttle: number;
  speed: number;
  alive: boolean;
  lock: LockTone;
  threat: Threat;
  pullUp: boolean;
}

/**
 * Áudio 100% sintetizado (Web Audio): nenhum arquivo para baixar. Ruído pré-gerado num único buffer
 * reutilizado por todos os disparos — criar AudioBufferSourceNode é barato, gerar ruído a cada tiro não.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private engine: { filter: BiquadFilterNode; gain: GainNode; rumble: OscillatorNode; rumbleGain: GainNode; wind: GainNode } | null = null;
  private beeper: { osc: OscillatorNode; gain: GainNode } | null = null;
  private warner: { osc: OscillatorNode; gain: GainNode } | null = null;
  private time = 0;
  private muted = false;

  /** Precisa ser chamado dentro de um gesto do usuário (política de autoplay). */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    this.master = master;

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(master);
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = this.noise;
    windSrc.loop = true;
    windSrc.playbackRate.value = 0.7;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 900;
    windFilter.Q.value = 0.6;
    const wind = ctx.createGain();
    wind.gain.value = 0;
    windSrc.connect(windFilter).connect(wind).connect(master);
    const rumble = ctx.createOscillator();
    rumble.type = "sawtooth";
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = "lowpass";
    rumbleFilter.frequency.value = 260;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0;
    rumble.connect(rumbleFilter).connect(rumbleGain).connect(master);
    src.start();
    windSrc.start();
    rumble.start();
    this.engine = { filter, gain, rumble, rumbleGain, wind };

    const tone = (type: OscillatorType) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      const g = ctx.createGain();
      g.gain.value = 0;
      osc.connect(g).connect(master);
      osc.start();
      return { osc, gain: g };
    };
    this.beeper = tone("square");
    this.warner = tone("square");
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }

  update(dt: number, f: AudioFrame): void {
    const ctx = this.ctx;
    if (!ctx || !this.engine || !this.beeper || !this.warner) return;
    this.time += dt;
    const now = ctx.currentTime;
    const e = this.engine;
    const on = f.alive ? 1 : 0;
    const ab = Math.max(0, (f.throttle - 0.85) / 0.15);
    e.filter.frequency.setTargetAtTime(350 + f.throttle * 1500 + ab * 900, now, 0.1);
    e.gain.gain.setTargetAtTime(on * (0.07 + f.throttle * 0.12 + ab * 0.08), now, 0.1);
    e.rumble.frequency.setTargetAtTime(48 + f.throttle * 40, now, 0.1);
    e.rumbleGain.gain.setTargetAtTime(on * (0.05 + f.throttle * 0.06), now, 0.1);
    e.wind.gain.setTargetAtTime(on * clamp((f.speed - 80) / 300, 0, 1) * 0.1, now, 0.2);

    // Padrões de bipe por estado (como os tons de seeker de caças reais).
    const t = this.time;
    let lockOn = 0;
    if (f.lock === "seeking") {
      this.beeper.osc.frequency.setValueAtTime(880, now);
      lockOn = t % 0.4 < 0.08 ? 1 : 0;
    } else if (f.lock === "locked") {
      this.beeper.osc.frequency.setValueAtTime(1320, now);
      lockOn = 1;
    }
    this.beeper.gain.gain.setTargetAtTime(lockOn * 0.035, now, 0.005);

    let warnOn = 0;
    if (f.threat === "missile") {
      this.warner.osc.frequency.setValueAtTime(1550, now);
      warnOn = t % 0.14 < 0.07 ? 1 : 0;
    } else if (f.threat === "lock") {
      this.warner.osc.frequency.setValueAtTime(700, now);
      warnOn = t % 0.5 < 0.18 ? 1 : 0;
    } else if (f.pullUp) {
      this.warner.osc.frequency.setValueAtTime(520, now);
      warnOn = t % 0.4 < 0.2 ? 1 : 0;
    }
    this.warner.gain.gain.setTargetAtTime(warnOn * 0.04, now, 0.005);
  }

  private burst(gain: number, duration: number, filterType: BiquadFilterType, freq: number, endFreq: number, rate = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || gain < 0.002) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, now);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    src.connect(f).connect(g).connect(this.master);
    src.start(now, Math.random() * 1.5);
    src.stop(now + duration + 0.05);
  }

  gun(distance = 0): void {
    const v = distance <= 0 ? 0.22 : 0.2 * clamp(1 - distance / 2500, 0, 1) ** 2;
    this.burst(v, 0.07, "lowpass", 2600, 500, 0.9 + Math.random() * 0.2);
  }

  explosion(distance: number): void {
    const v = clamp(1 - distance / 5000, 0, 1) ** 2;
    this.burst(v * 0.9, 1.6, "lowpass", 900, 60, 0.6);
  }

  missile(): void {
    this.burst(0.3, 1.2, "bandpass", 2200, 400, 1);
  }

  flare(): void {
    this.burst(0.12, 0.3, "highpass", 3000, 1500, 1.4);
  }

  hurt(): void {
    this.burst(0.25, 0.12, "bandpass", 600, 300, 0.8);
  }

  hitConfirm(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = 2400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    o.connect(g).connect(this.master);
    o.start(now);
    o.stop(now + 0.06);
  }
}
