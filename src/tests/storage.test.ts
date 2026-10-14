import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, loadSettings } from "../game/storage";

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
