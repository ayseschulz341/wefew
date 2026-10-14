import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  claimGameRecord,
  loadSettings,
  loadStats,
} from "../game/storage";

class MemoryStorage implements Storage {
  private data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe("настройки", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("восстанавливает безопасные значения после повреждения localStorage", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "liars-bar:settings:v1",
      JSON.stringify({
        playerName: { invalid: true },
        characterId: "unknown-character",
        difficulty: "impossible",
        botCount: 99,
      }),
    );
    vi.stubGlobal("localStorage", storage);

    expect(loadSettings()).toMatchObject({
      playerName: DEFAULT_SETTINGS.playerName,
      characterId: DEFAULT_SETTINGS.characterId,
      difficulty: "normal",
      botCount: 3,
    });
  });
});

describe("статистика", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("читает сохранённое, даже когда запись запрещена (переполнена квота)", () => {
    const storage = new MemoryStorage();
    storage.setItem("liars-bar:stats:v1", JSON.stringify({ games: 7, wins: 3 }));
    storage.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
    vi.stubGlobal("localStorage", storage);

    expect(loadStats()).toMatchObject({ games: 7, wins: 3 });
  });

  it("засчитывает одну и ту же сетевую партию только один раз", () => {
    vi.stubGlobal("localStorage", new MemoryStorage());

    expect(claimGameRecord("ROOM42:game-1")).toBe(true);
    expect(claimGameRecord("ROOM42:game-1")).toBe(false);
    expect(claimGameRecord("ROOM42:game-2")).toBe(true);
  });
});
