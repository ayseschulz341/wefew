import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { GunAudio, REVOLVER_SAMPLES } from "../game/gunAudio";
import { SoundEngine, resolveVoicePath } from "../game/sounds";

class FakeAudio {
  static created: FakeAudio[] = [];

  src: string;
  preload = "";
  volume = 1;
  playbackRate = 1;
  preservesPitch = true;
  webkitPreservesPitch = true;
  currentTime = 0;
  onended: (() => void) | null = null;
  pause = vi.fn();
  play = vi.fn(() => Promise.resolve());

  constructor(src = "") {
    this.src = src;
    FakeAudio.created.push(this);
  }
}

const NativeAudio = globalThis.Audio;

class FakeParam {
  value = 0;
  setValueAtTime() { return this; }
  exponentialRampToValueAtTime() { return this; }
  linearRampToValueAtTime() { return this; }
}

class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  Q = new FakeParam();
  buffer: unknown = null;
  loop = false;
  type = "";
  connect(target: unknown) { return target; }
  start = vi.fn();
  stop = vi.fn();
}

class FakeContext {
  static last: FakeContext | null = null;
  state: AudioContextState = "suspended";
  currentTime = 0;
  sampleRate = 8000;
  destination = new FakeNode();
  nodes: FakeNode[] = [];
  resume = vi.fn(() => Promise.resolve());
  constructor() { FakeContext.last = this; }
  private node() { const n = new FakeNode(); this.nodes.push(n); return n; }
  createGain() { return this.node(); }
  createBufferSource() { return this.node(); }
  createBiquadFilter() { return this.node(); }
  createOscillator() { return this.node(); }
  createBuffer(_channels: number, length: number) {
    return { getChannelData: () => new Float32Array(length), duration: length / this.sampleRate };
  }
}

describe("эффекты на приостановленном AudioContext", () => {
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("не копит звуки, пока контекст спит, и играет после разблокировки", () => {
    vi.stubGlobal("window", { AudioContext: FakeContext });
    vi.stubGlobal("navigator", {});
    const engine = new SoundEngine();
    const started = () => FakeContext.last!.nodes.filter((n) => n.start.mock.calls.length > 0).length;

    engine.play("flip");
    engine.play("heartbeat");
    expect(started()).toBe(0);

    FakeContext.last!.state = "running";
    engine.play("flip");
    expect(started()).toBeGreaterThan(0);
  });

  it("внутри жеста пользователя звук разрешён сразу", () => {
    vi.stubGlobal("window", { AudioContext: FakeContext });
    vi.stubGlobal("navigator", { userActivation: { isActive: true } });
    const engine = new SoundEngine();

    engine.play("uiClick");
    expect(FakeContext.last!.nodes.some((n) => n.start.mock.calls.length > 0)).toBe(true);
  });
});

describe("голосовые реплики", () => {
  let engine: SoundEngine;

  beforeAll(() => {
    globalThis.Audio = FakeAudio as unknown as typeof Audio;
  });

  afterAll(() => {
    globalThis.Audio = NativeAudio;
  });

  beforeEach(() => {
    FakeAudio.created = [];
    engine = new SoundEngine();
  });

  it("выбирает персональную реплику для публичного события", () => {
    engine.playVoice("cupcake", "challenge");

    expect(FakeAudio.created).toHaveLength(1);
    expect(FakeAudio.created[0].src).toContain("audio/gerk/liar.wav");
    expect(FakeAudio.created[0].preload).toBe("auto");
    expect(FakeAudio.created[0].play).toHaveBeenCalledOnce();
  });

  it("сопоставляет голоса полу обновлённых портретов", () => {
    expect(resolveVoicePath("scubby", "challenge")).toBe(
      "audio/cupcake/liar.wav",
    );
    expect(resolveVoicePath("foxy", "play", { count: 1, rank: "Q" })).toBe(
      "audio/cupcake/queen.wav",
    );
    expect(resolveVoicePath("bristle", "challenge")).toBe(
      "audio/gerk/liar.wav",
    );
    expect(resolveVoicePath("toar", "play", { count: 1, rank: "K" })).toBe(
      "audio/gerk/king.wav",
    );
    expect(resolveVoicePath("cupcake", "challenge")).toBe(
      "audio/gerk/liar.wav",
    );
    expect(resolveVoicePath("gerk", "play", { count: 1, rank: "A" })).toBe(
      "audio/gerk/ace.wav",
    );
  });

  it("делает голос Scubby явно женским и не переносит настройку на Foxy", () => {
    const scubbyVoicePaths = [
      resolveVoicePath("scubby", "challenge"),
      resolveVoicePath("scubby", "devilRevealed"),
      resolveVoicePath("scubby", "play", { count: 1, rank: "Q" }),
      resolveVoicePath("scubby", "play", { count: 2, rank: "K" }),
      resolveVoicePath("scubby", "play", { count: 3, rank: "A" }),
    ];
    expect(scubbyVoicePaths.every((path) => path.startsWith("audio/cupcake/"))).toBe(
      true,
    );

    engine.playVoice("scubby", "challenge");
    const sharedFemaleVoice = FakeAudio.created[0];

    expect(sharedFemaleVoice.playbackRate).toBe(1.18);
    expect(sharedFemaleVoice.preservesPitch).toBe(false);
    expect(sharedFemaleVoice.webkitPreservesPitch).toBe(false);

    engine.playVoice("foxy", "challenge");

    expect(FakeAudio.created).toHaveLength(1);
    expect(sharedFemaleVoice.playbackRate).toBe(1);
    expect(sharedFemaleVoice.preservesPitch).toBe(true);
    expect(sharedFemaleVoice.webkitPreservesPitch).toBe(true);
  });

  it("озвучивает Дьявола только через отдельное событие вскрытия", () => {
    expect(resolveVoicePath("scubby", "play", { count: 1, rank: "Q" })).toBe(
      "audio/cupcake/queen.wav",
    );
    expect(resolveVoicePath("scubby", "devilRevealed")).toBe(
      "audio/cupcake/devil.wav",
    );
  });

  it("включает новую реплику Foxy только когда её поймали на лжи", () => {
    expect(resolveVoicePath("foxy", "caughtLying")).toBe(
      "audio/foxy/caught-lie.mp3",
    );
    expect(resolveVoicePath("scubby", "caughtLying")).toBe("");
  });

  it("подбирает форму номинала по числу заявленных карт", () => {
    expect(resolveVoicePath("cupcake", "play", { count: 1, rank: "K" })).toBe(
      "audio/gerk/king.wav",
    );
    expect(resolveVoicePath("cupcake", "play", { count: 2, rank: "K" })).toBe(
      "audio/gerk/kings.wav",
    );
    expect(resolveVoicePath("cupcake", "play", { count: 3, rank: "K" })).toBe(
      "audio/scubby/three-cards.wav",
    );
  });

  it("ограничивает число карт игровым диапазоном 1–3", () => {
    expect(resolveVoicePath(null, "play", { count: -10 })).toBe(
      "audio/generic/one.wav",
    );
    expect(resolveVoicePath(null, "play", { count: 99 })).toBe(
      "audio/generic/three.wav",
    );
  });

  it("использует резервную реплику для игрока без выбранного персонажа", () => {
    engine.playVoice(null, "play", { count: 2, rank: "K" });

    expect(FakeAudio.created).toHaveLength(1);
    expect(FakeAudio.created[0].src).toContain("audio/generic/two.wav");
    expect(FakeAudio.created[0].play).toHaveBeenCalledOnce();
  });

  it("кэширует аудиофайл и перезапускает его с начала", () => {
    engine.playVoice("cupcake", "challenge");
    const cached = FakeAudio.created[0];
    cached.currentTime = 1.5;

    engine.playVoice("cupcake", "challenge");

    expect(FakeAudio.created).toHaveLength(1);
    expect(cached.currentTime).toBe(0);
    expect(cached.play).toHaveBeenCalledTimes(2);
  });

  it("останавливает предыдущую реплику при запуске другой", () => {
    engine.playVoice("cupcake", "challenge");
    const previous = FakeAudio.created[0];
    previous.currentTime = 0.8;

    engine.playVoice("cupcake", "devilRevealed");

    expect(previous.pause).toHaveBeenCalledOnce();
    expect(previous.currentTime).toBe(0);
    expect(FakeAudio.created).toHaveLength(2);
    expect(FakeAudio.created[1].play).toHaveBeenCalledOnce();
  });

  it("отложенная реплика ждёт конца звучащей, а не обрывает её", () => {
    engine.playVoice("cupcake", "challenge");
    const shout = FakeAudio.created[0];

    engine.queueVoice("cupcake", "devilRevealed");
    expect(shout.pause).not.toHaveBeenCalled();
    expect(FakeAudio.created).toHaveLength(1);

    shout.onended?.();
    expect(FakeAudio.created).toHaveLength(2);
    expect(FakeAudio.created[1].src).toContain("audio/scubby/devil.wav");
    expect(FakeAudio.created[1].play).toHaveBeenCalledOnce();
  });

  it("останавливает голос и блокирует новые реплики без звука", () => {
    engine.playVoice("scubby", "devilRevealed");
    const active = FakeAudio.created[0];

    engine.setMuted(true);
    engine.playVoice("foxy", "devilRevealed");

    expect(active.pause).toHaveBeenCalledOnce();
    expect(active.currentTime).toBe(0);
    expect(FakeAudio.created).toHaveLength(1);
  });

  it("после включения звука переиспользует кэшированную реплику", () => {
    engine.playVoice("scubby", "challenge");
    const cached = FakeAudio.created[0];
    engine.setMuted(true);
    engine.setMuted(false);

    engine.playVoice("scubby", "challenge");

    expect(FakeAudio.created).toHaveLength(1);
    expect(cached.play).toHaveBeenCalledTimes(2);
  });

  it("играет эффекты без исключений, когда AudioContext недоступен", () => {
    expect(() => {
      engine.play("card");
      engine.play("flip");
      engine.play("heartbeat");
      engine.play("win");
      engine.play("lose");
      engine.play("uiClick");
    }).not.toThrow();
    expect(FakeAudio.created).toHaveLength(0);
  });
});

describe("оцифрованные звуки револьвера", () => {
  it("ключевые моменты сцены звучат записями первой версии", () => {
    expect(Object.keys(REVOLVER_SAMPLES).sort()).toEqual([
      "bang",
      "click",
      "cock",
    ]);
    expect(REVOLVER_SAMPLES.bang?.url).toBe("audio/sfx/gunshot.wav");
    expect(REVOLVER_SAMPLES.cock?.url).toBe("audio/sfx/cock.mp3");
    expect(REVOLVER_SAMPLES.click?.url).toBe("audio/sfx/dry-click.mp3");
    expect(REVOLVER_SAMPLES.click?.offsetSec).toBe(0.09);
    for (const gain of Object.values(REVOLVER_SAMPLES).map((s) => s?.gain)) {
      expect(gain).toBeGreaterThan(0);
      expect(gain).toBeLessThanOrEqual(1);
    }
  });

  it("файлы записей лежат в public/audio/sfx", () => {
    for (const spec of Object.values(REVOLVER_SAMPLES)) {
      const path = join(process.cwd(), "public", ...spec!.url.split("/"));
      expect(existsSync(path), `нет файла: ${spec!.url}`).toBe(true);
    }
  });
});

describe("голосовые реплики — сброс и ошибки", () => {
  let engine: SoundEngine;

  beforeAll(() => {
    globalThis.Audio = FakeAudio as unknown as typeof Audio;
  });

  afterAll(() => {
    globalThis.Audio = NativeAudio;
  });

  beforeEach(() => {
    FakeAudio.created = [];
    engine = new SoundEngine();
  });

  it("сбрасывает активную реплику после завершения и ошибки воспроизведения", async () => {
    engine.playVoice("cupcake", "challenge");
    const completed = FakeAudio.created[0];
    completed.onended?.();

    engine.playVoice("cupcake", "devilRevealed");
    const rejected = FakeAudio.created[1];
    rejected.play.mockRejectedValueOnce(new Error("autoplay blocked"));
    engine.playVoice("cupcake", "devilRevealed");
    await Promise.resolve();

    engine.setMuted(true);
    expect(rejected.pause).not.toHaveBeenCalled();
  });
});

describe("синхронизация звука револьвера", () => {
  it("не ждёт декодирования записи и звучит точно в момент удара", () => {
    const gun = new GunAudio();
    const internals = gun as unknown as {
      samplePromises: Map<string, Promise<AudioBuffer | null>>;
      playProcedural: (kind: string) => void;
    };
    const procedural = vi
      .spyOn(internals, "playProcedural")
      .mockImplementation(() => undefined);
    const stillLoading = new Promise<AudioBuffer | null>(() => undefined);

    internals.samplePromises.set("bang", stillLoading);
    internals.samplePromises.set("click", stillLoading);

    gun.play("bang");
    gun.play("click");

    expect(procedural).toHaveBeenNthCalledWith(1, "bang");
    expect(procedural).toHaveBeenNthCalledWith(2, "click");
  });

  it("пропускает начальную тишину в записи осечки", () => {
    const gun = new GunAudio();
    const fakeBuffer = { duration: 0.418 } as AudioBuffer;
    const internals = gun as unknown as {
      samples: Map<string, AudioBuffer | null>;
      startSample: (
        buffer: AudioBuffer,
        gain: number,
        offsetSec?: number,
      ) => void;
    };
    const startSample = vi
      .spyOn(internals, "startSample")
      .mockImplementation(() => undefined);
    internals.samples.set("click", fakeBuffer);

    gun.play("click");

    expect(startSample).toHaveBeenCalledWith(fakeBuffer, 0.85, 0.09);
  });
});
