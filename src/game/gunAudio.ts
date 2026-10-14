import { sfx, vibrateHaptic } from "./sounds";
import type { RevolverSoundKind } from "./revolverTimeline";

/**
 * Оцифрованные звуки первой версии револьвера — ключевые моменты сцены
 * звучат настоящими записями; при недоступности файла механизм откатывается
 * на процедурный синтез, поэтому сцена звучит всегда.
 */
export const REVOLVER_SAMPLES: Partial<
  Record<RevolverSoundKind, { url: string; gain: number; offsetSec?: number }>
> = {
  bang: { url: "audio/sfx/gunshot.wav", gain: 1 },
  // В исходной MP3-записи есть около 93 мс начальной тишины.
  click: { url: "audio/sfx/dry-click.mp3", gain: 0.85, offsetSec: 0.09 },
  cock: { url: "audio/sfx/cock.mp3", gain: 0.9 },
};

/**
 * Процедурный звук револьверной сцены, перенесённый из оригинальной
 * SVG-анимации: защёлка, откидывание, укладка патронов, трещотка барабана,
 * захлопывание, взвод, спуск, выстрел и осечка. Всё синтезируется на лету
 * через WebAudio и подключено к мастер-шине игры, поэтому звук сцены
 * подчиняется общему переключателю звука и громкости.
 */
export class GunAudio {
  private noise: AudioBuffer | null = null;
  private samples = new Map<RevolverSoundKind, AudioBuffer | null>();
  private samplePromises = new Map<RevolverSoundKind, Promise<AudioBuffer | null>>();
  private preloadStarted = false;

  constructor() {
    // Записи декодируются заранее: к моменту удара курка сэмпл готов,
    // и выстрел звучит без сетевой задержки.
    this.preload();
  }

  private preload(): void {
    if (this.preloadStarted) return;
    this.preloadStarted = true;
    const bus = sfx.fxBus();
    if (!bus) return;
    for (const kind of Object.keys(REVOLVER_SAMPLES) as RevolverSoundKind[]) {
      void this.loadSample(kind, bus.ctx);
    }
  }

  /**
   * Загружает оцифрованный звук. Удача и провал кэшируются: битый файл
   * не должен переводить сцену в режим вечных повторных запросов.
   */
  private loadSample(
    kind: RevolverSoundKind,
    ctx: AudioContext,
  ): Promise<AudioBuffer | null> {
    if (this.samples.has(kind)) return Promise.resolve(this.samples.get(kind)!);
    const spec = REVOLVER_SAMPLES[kind];
    if (!spec) return Promise.resolve(null);

    const url = new URL(spec.url, document.baseURI).href;
    const promise = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((raw) => ctx.decodeAudioData(raw))
      .then((buffer) => {
        this.samples.set(kind, buffer);
        return buffer;
      })
      .catch(() => {
        this.samples.set(kind, null);
        return null;
      });
    this.samplePromises.set(kind, promise);
    return promise;
  }

  private startSample(buffer: AudioBuffer, gain: number, offsetSec = 0): void {
    const bus = sfx.fxBus();
    if (!bus) return;
    const src = bus.ctx.createBufferSource();
    src.buffer = buffer;
    const g = bus.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(bus.out);
    src.start(0, Math.min(offsetSec, buffer.duration));
  }

  private ensureNoise(ctx: AudioContext): AudioBuffer | null {
    if (this.noise) return this.noise;
    const len = Math.floor(ctx.sampleRate);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buffer;
    return buffer;
  }

  private burst(opts: {
    dur: number;
    gain: number;
    type: BiquadFilterType;
    freq: number;
    q?: number;
    sweepTo?: number;
    attack?: number;
  }) {
    const bus = sfx.fxBus();
    if (!bus) return;
    const noise = this.ensureNoise(bus.ctx);
    if (!noise) return;
    const t0 = bus.ctx.currentTime;
    const src = bus.ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const flt = bus.ctx.createBiquadFilter();
    flt.type = opts.type;
    flt.frequency.setValueAtTime(opts.freq, t0);
    if (opts.sweepTo)
      flt.frequency.exponentialRampToValueAtTime(opts.sweepTo, t0 + opts.dur);
    flt.Q.value = opts.q ?? 1;
    const g = bus.ctx.createGain();
    const attack = opts.attack ?? 0.002;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opts.gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    src.connect(flt).connect(g).connect(bus.out);
    src.start(t0);
    src.stop(t0 + opts.dur + 0.05);
  }

  private tone(
    freq: number,
    dur: number,
    gain: number,
    type: OscillatorType = "sine",
    sweepTo?: number,
  ) {
    const bus = sfx.fxBus();
    if (!bus) return;
    const t0 = bus.ctx.currentTime;
    const osc = bus.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    const g = bus.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(bus.out);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  play(kind: RevolverSoundKind) {
    if (sfx.muted) return;
    // Тактильная отдача не зависит от того, чем сыгран звук — записью или синтезом.
    if (kind === "bang") vibrateHaptic([40, 30, 120]);
    if (kind === "click") vibrateHaptic(18);

    // Сначала оцифрованная запись первой версии; синтез — резерв.
    const spec = REVOLVER_SAMPLES[kind];
    if (spec) {
      const cached = this.samples.get(kind);
      if (cached) {
        this.startSample(cached, spec.gain, spec.offsetSec);
        return;
      }
      // Не ждём сеть и decodeAudioData в момент удара курка: даже короткое
      // ожидание здесь слышится как рассинхрон с вспышкой/щелчком. Текущий
      // акцент звучит синтезом сразу, а фоновая загрузка готовит запись к
      // следующему воспроизведению.
      this.playProcedural(kind);
      return;
    }
    this.playProcedural(kind);
  }

  /** Синтез механизма на WebAudio — как в оригинальной анимации. */
  private playProcedural(kind: RevolverSoundKind) {
    switch (kind) {
      case "latch":
        this.burst({ dur: 0.04, gain: 0.25, type: "bandpass", freq: 2600, q: 2 });
        break;
      case "open":
        this.burst({ dur: 0.09, gain: 0.3, type: "bandpass", freq: 1400, q: 1.5 });
        this.tone(900, 0.08, 0.05, "triangle", 500);
        break;
      case "load":
        this.tone(3400, 0.09, 0.12, "sine", 2600);
        this.burst({ dur: 0.03, gain: 0.2, type: "highpass", freq: 3000 });
        break;
      case "tick":
        this.burst({ dur: 0.014, gain: 0.18, type: "bandpass", freq: 4200, q: 3 });
        break;
      case "close":
        this.burst({ dur: 0.12, gain: 0.5, type: "lowpass", freq: 1800, sweepTo: 400 });
        this.tone(220, 0.1, 0.15, "triangle", 120);
        break;
      case "cock":
        this.burst({ dur: 0.035, gain: 0.35, type: "bandpass", freq: 2200, q: 2.5 });
        break;
      case "trigger":
        this.burst({ dur: 0.02, gain: 0.12, type: "bandpass", freq: 3000, q: 3 });
        break;
      case "click":
        this.burst({ dur: 0.05, gain: 0.55, type: "bandpass", freq: 1900, q: 1.2 });
        this.tone(1500, 0.04, 0.1, "square", 800);
        break;
      case "bang":
        this.burst({ dur: 0.9, gain: 1.0, type: "lowpass", freq: 5000, sweepTo: 120, attack: 0.001 });
        this.burst({ dur: 0.25, gain: 0.7, type: "highpass", freq: 1200 });
        this.tone(140, 0.5, 0.8, "sine", 35);
        break;
    }
  }
}
