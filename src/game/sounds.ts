import type { CharacterId, Rank } from "./types";

/**
 * Звуковые эффекты на WebAudio API и голосовые реплики персонажей.
 * Эффекты синтезируются на лету, а реплики лениво загружаются из public/audio.
 */

export type SfxName =
  | "card"
  | "flip"
  | "heartbeat"
  | "win"
  | "lose"
  | "uiClick";

/**
 * Публичные голосовые события.
 *
 * `play` намеренно описывает только объявленную выкладку и никогда не зависит
 * от закрытых карт. Реплика `devilRevealed` допустима только после вскрытия.
 */
export type VoiceCue =
  | "play"
  | "challenge"
  | "devilRevealed"
  | "caughtLying";

export interface VoiceOptions {
  count?: number;
  rank?: Rank;
}

type VoiceKey =
  | "liar"
  | "devil"
  | "threeCards"
  | "queen"
  | "queens"
  | "king"
  | "kings"
  | "ace"
  | "aces"
  | "caughtLying";

type VoiceProfile = Partial<Record<VoiceKey, string>>;

const FEMININE_VOICE_BASE: VoiceProfile = {
  liar: "audio/cupcake/liar.wav",
  devil: "audio/cupcake/devil.wav",
  threeCards: "audio/cupcake/three-cards.wav",
  queen: "audio/cupcake/queen.wav",
  queens: "audio/cupcake/queens.wav",
  king: "audio/cupcake/king.wav",
  kings: "audio/cupcake/kings.wav",
  ace: "audio/cupcake/ace.wav",
  aces: "audio/cupcake/aces.wav",
};

const MASCULINE_VOICE_BASE: VoiceProfile = {
  liar: "audio/gerk/liar.wav",
  devil: "audio/gerk/devil.wav",
  threeCards: "audio/gerk/three-cards.wav",
  queen: "audio/gerk/queen.wav",
  queens: "audio/gerk/queens.wav",
  king: "audio/gerk/king.wav",
  kings: "audio/gerk/kings.wav",
  ace: "audio/gerk/ace.wav",
  aces: "audio/gerk/aces.wav",
};

const VOICE_PROFILES: Partial<Record<CharacterId, VoiceProfile>> = {
  scubby: {
    ...FEMININE_VOICE_BASE,
  },
  foxy: {
    ...FEMININE_VOICE_BASE,
    devil: "audio/foxy/devil.wav",
    threeCards: "audio/foxy/three-cards.wav",
    caughtLying: "audio/foxy/caught-lie.mp3",
  },
  bristle: {
    ...MASCULINE_VOICE_BASE,
    devil: "audio/bristle/devil.wav",
    threeCards: "audio/bristle/three-cards.wav",
  },
  toar: {
    ...MASCULINE_VOICE_BASE,
    devil: "audio/toar/devil.wav",
    threeCards: "audio/toar/three-cards.wav",
  },
  cupcake: {
    ...MASCULINE_VOICE_BASE,
    devil: "audio/scubby/devil.wav",
    threeCards: "audio/scubby/three-cards.wav",
  },
  gerk: {
    ...MASCULINE_VOICE_BASE,
  },
};

const GENERIC_VOICES = {
  liar: "audio/generic/liar.wav",
  devil: "audio/generic/devil.wav",
  counts: {
    1: "audio/generic/one.wav",
    2: "audio/generic/two.wav",
    3: "audio/generic/three.wav",
  },
} as const;

const RANK_VOICE_KEYS: Record<Rank, readonly [VoiceKey, VoiceKey]> = {
  Q: ["queen", "queens"],
  K: ["king", "kings"],
  A: ["ace", "aces"],
};

/** Зайчихе нужен явно более высокий тембр, независимо от выбранной реплики. */
const CHARACTER_VOICE_RATE: Partial<Record<CharacterId, number>> = {
  scubby: 1.18,
};

/**
 * Единая карта голосовых событий. Она намеренно не принимает реальные карты:
 * до вскрытия звук не должен выдавать, был ли ход честным или содержал Дьявола.
 */
export function resolveVoicePath(
  characterId: CharacterId | null,
  cue: VoiceCue,
  options: VoiceOptions = {},
): string {
  const profile = characterId ? VOICE_PROFILES[characterId] : undefined;

  if (cue === "challenge") {
    return profile?.liar ?? GENERIC_VOICES.liar;
  }
  if (cue === "devilRevealed") {
    return profile?.devil ?? GENERIC_VOICES.devil;
  }
  if (cue === "caughtLying") {
    return profile?.caughtLying ?? "";
  }

  const count = Math.max(1, Math.min(3, Math.round(options.count ?? 1))) as
    | 1
    | 2
    | 3;
  if (count === 3 && profile?.threeCards) {
    return profile.threeCards;
  }
  if (options.rank && profile) {
    const [single, plural] = RANK_VOICE_KEYS[options.rank];
    const rankPath = profile[count === 1 ? single : plural];
    if (rankPath) return rankPath;
  }
  return GENERIC_VOICES.counts[count];
}

const MASTER_VOLUME = 0.5;

/**
 * Тактильная отдача, доступная и внешним звуковым движкам (револьверная сцена).
 * На десктопе и при SSR безопасно ничего не делает.
 */
export function vibrateHaptic(pattern: number | number[]): void {
  if (typeof navigator === "undefined") return;
  const nav = navigator as Navigator & {
    vibrate?: (pattern: number | number[]) => boolean;
  };
  if (typeof nav.vibrate !== "function") return;
  try {
    nav.vibrate(pattern);
  } catch {
    /* Некоторые браузеры блокируют вибрацию без жеста пользователя. */
  }
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voiceCache = new Map<string, HTMLAudioElement>();
  private activeVoice: HTMLAudioElement | null = null;
  /** Реплика, ждущая окончания текущей (см. queueVoice). */
  private queuedVoice: { path: string; rate: number } | null = null;
  muted = false;

  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
      this.master.connect(this.ctx.destination);
    }
    // iOS переводит контекст ещё и в "interrupted" (звонок, сворачивание).
    if (this.ctx.state !== "running") this.ctx.resume().catch(() => undefined);
    return this.ctx;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : MASTER_VOLUME;
    if (muted) this.queuedVoice = null;
    if (muted && this.activeVoice) {
      this.activeVoice.pause();
      this.activeVoice.currentTime = 0;
      this.activeVoice = null;
    }
  }

  private voice(path: string): HTMLAudioElement | null {
    if (typeof Audio === "undefined") return null;
    const cached = this.voiceCache.get(path);
    if (cached) return cached;

    const url =
      typeof document === "undefined" ? path : new URL(path, document.baseURI).href;
    const audio = new Audio(url);
    audio.preload = "auto";
    audio.volume = 0.82;
    // Сбой загрузки не должен навсегда заглушить реплику: следующий вызов
    // создаст элемент заново.
    audio.onerror = () => {
      if (this.voiceCache.get(path) === audio) this.voiceCache.delete(path);
    };
    this.voiceCache.set(path, audio);
    return audio;
  }

  private playVoiceFile(path: string, playbackRate = 1): void {
    const audio = this.voice(path);
    if (!audio) return;
    // Новая реплика вытесняет и звучащую, и отложенную.
    this.queuedVoice = null;

    if (this.activeVoice && this.activeVoice !== audio) {
      this.activeVoice.pause();
      this.activeVoice.currentTime = 0;
    }

    audio.currentTime = 0;
    audio.playbackRate = playbackRate;
    audio.preservesPitch = playbackRate === 1;
    (
      audio as HTMLAudioElement & { webkitPreservesPitch?: boolean }
    ).webkitPreservesPitch = playbackRate === 1;
    this.activeVoice = audio;
    const finish = () => {
      if (this.activeVoice !== audio) return;
      this.activeVoice = null;
      const next = this.queuedVoice;
      this.queuedVoice = null;
      if (next && !this.muted) this.playVoiceFile(next.path, next.rate);
    };
    audio.onended = finish;
    void audio.play().catch(finish);
  }

  /** Озвучивает только публичное событие: заявление, обвинение или уже вскрытого Дьявола. */
  playVoice(
    characterId: CharacterId | null,
    cue: VoiceCue,
    options: VoiceOptions = {},
  ): void {
    if (this.muted) return;

    const path = resolveVoicePath(characterId, cue, options);
    if (path) {
      this.playVoiceFile(path, characterId ? CHARACTER_VOICE_RATE[characterId] : 1);
    }
  }

  /**
   * Как playVoice, но не обрывает звучащую реплику, а ждёт её конца. Нужна
   * при вскрытии: реакция обвинённого раньше глушила «Лжец!» обвинителя
   * в первые миллисекунды.
   */
  queueVoice(
    characterId: CharacterId | null,
    cue: VoiceCue,
    options: VoiceOptions = {},
  ): void {
    if (this.muted) return;
    const path = resolveVoicePath(characterId, cue, options);
    if (!path) return;
    const rate = (characterId ? CHARACTER_VOICE_RATE[characterId] : undefined) ?? 1;
    const active = this.activeVoice;
    if (active && !active.paused && !active.ended) {
      this.queuedVoice = { path, rate };
      return;
    }
    this.playVoiceFile(path, rate);
  }

  /**
   * Тактильная отдача на мобильных устройствах. На десктопе и при SSR
   * безопасно ничего не делает, если Vibration API недоступен.
   */
  private vibrate(pattern: number | number[]): void {
    if (this.muted) return;
    vibrateHaptic(pattern);
  }

  private noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  play(name: SfxName): void {
    if (this.muted) return;

    // Тактильная отдача для ключевых событий, если доступен Vibration API.
    switch (name) {
      case "win":
        this.vibrate([25, 40, 25, 40, 60]);
        break;
      case "lose":
        this.vibrate(180);
        break;
    }

    this.playSynth(name);
  }

  /** Синтезированные эффекты на WebAudio. */
  private playSynth(name: SfxName): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;

    switch (name) {
      case "card":
      case "uiClick": {
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer(ctx, 0.08);
        const filter = ctx.createBiquadFilter();
        filter.type = "highpass";
        filter.frequency.value = name === "card" ? 1800 : 3000;
        const g = ctx.createGain();
        g.gain.setValueAtTime(name === "card" ? 0.35 : 0.15, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
        src.connect(filter).connect(g).connect(this.master);
        src.start(t);
        break;
      }
      case "flip": {
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer(ctx, 0.16);
        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.setValueAtTime(1200, t);
        filter.frequency.exponentialRampToValueAtTime(3500, t + 0.14);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.3, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
        src.connect(filter).connect(g).connect(this.master);
        src.start(t);
        break;
      }
      case "heartbeat": {
        for (const [offset, freq] of [
          [0, 70],
          [0.18, 55],
        ] as const) {
          const osc = ctx.createOscillator();
          osc.type = "sine";
          osc.frequency.value = freq;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, t + offset);
          g.gain.exponentialRampToValueAtTime(0.5, t + offset + 0.02);
          g.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.16);
          osc.connect(g).connect(this.master);
          osc.start(t + offset);
          osc.stop(t + offset + 0.2);
        }
        break;
      }
      case "win":
      case "lose": {
        const notes = name === "win" ? [392, 494, 587, 784] : [330, 262, 196];
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          osc.type = name === "win" ? "triangle" : "sawtooth";
          osc.frequency.value = freq;
          const start = t + i * 0.14;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, start);
          g.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
          g.gain.exponentialRampToValueAtTime(0.001, start + 0.4);
          osc.connect(g).connect(this.master!);
          osc.start(start);
          osc.stop(start + 0.45);
        });
        break;
      }
    }
  }

  /** Разблокировать AudioContext после первого жеста пользователя. */
  unlock(): void {
    this.ensure();
  }

  /**
   * Общая шина эффектов для внешних процедурных движков (звук револьверной
   * сцены): контекст и мастер-гейн, поэтому подчиняются громкости и mute.
   */
  fxBus(): { ctx: AudioContext; out: AudioNode } | null {
    const ctx = this.ensure();
    if (!ctx || !this.master) return null;
    return { ctx, out: this.master };
  }
}

export const sfx = new SoundEngine();
