import type { CharacterId, Difficulty, GameVariant } from "./types";
import { ALL_CHARACTER_IDS } from "./characters";

const SETTINGS_KEY = "liars-bar:settings:v1";
const STATS_KEY = "liars-bar:stats:v1";

export interface Settings {
  playerName: string;
  characterId: CharacterId;
  difficulty: Difficulty;
  botCount: number;
  variant: GameVariant;
  muted: boolean;
  /** Ограничение времени на ход (канон: 30 с). */
  timerEnabled: boolean;
  /** Выбранная длительность хода для локальной и сетевой партии. */
  turnSeconds: 15 | 30 | 45 | 60;
  /** Быстрый запуск текущей одиночной партии вместо создания комнаты. */
  playWithBots: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  playerName: "Вы",
  characterId: "foxy",
  difficulty: "normal",
  botCount: 3,
  variant: "classic",
  muted: false,
  timerEnabled: true,
  turnSeconds: 30,
  playWithBots: false,
};

export interface Stats {
  games: number;
  wins: number;
  bluffsMade: number;
  bluffsCaught: number;
  correctCalls: number;
  falseCalls: number;
  pullsSurvived: number;
  /** Лучшая серия побед подряд. */
  bestStreak: number;
  /** Текущая серия побед. */
  streak: number;
}

export const EMPTY_STATS: Stats = {
  games: 0,
  wins: 0,
  bluffsMade: 0,
  bluffsCaught: 0,
  correctCalls: 0,
  falseCalls: 0,
  pullsSurvived: 0,
  bestStreak: 0,
  streak: 0,
};

function storage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    // Проверка доступности: в приватном режиме запись может бросать.
    const probe = "__lb_probe__";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

function readJson<T>(key: string, fallback: T): T {
  const store = storage();
  if (!store) return fallback;
  try {
    const raw = store.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return fallback;
    return { ...fallback, ...(parsed as Partial<T>) };
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // Переполнение или запрет записи — молча игнорируем.
  }
}

// --- Настройки -------------------------------------------------------------

export function loadSettings(): Settings {
  const s = readJson<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS);
  const playerName =
    typeof s.playerName === "string" && s.playerName.trim().length > 0
      ? s.playerName.slice(0, 16)
      : DEFAULT_SETTINGS.playerName;
  const characterId = ALL_CHARACTER_IDS.includes(s.characterId)
    ? s.characterId
    : DEFAULT_SETTINGS.characterId;
  const botCount =
    typeof s.botCount === "number" && Number.isFinite(s.botCount)
      ? Math.max(1, Math.min(3, Math.floor(s.botCount)))
      : DEFAULT_SETTINGS.botCount;

  return {
    ...s,
    playerName,
    characterId,
    botCount,
    difficulty: (["easy", "normal", "hard"] as Difficulty[]).includes(s.difficulty)
      ? s.difficulty
      : "normal",
    variant: (["classic", "devil"] as GameVariant[]).includes(s.variant)
      ? s.variant
      : "classic",
    muted: !!s.muted,
    timerEnabled: s.timerEnabled !== false,
    turnSeconds: ([15, 30, 45, 60] as const).includes(s.turnSeconds as 15 | 30 | 45 | 60)
      ? s.turnSeconds
      : 30,
    playWithBots: s.playWithBots === true,
  };
}

export function saveSettings(s: Settings): void {
  writeJson(SETTINGS_KEY, s);
}

// --- Статистика ------------------------------------------------------------

export function loadStats(): Stats {
  const s = readJson<Stats>(STATS_KEY, EMPTY_STATS);
  const clean: Stats = { ...EMPTY_STATS };
  for (const key of Object.keys(EMPTY_STATS) as (keyof Stats)[]) {
    const v = s[key];
    clean[key] = typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
  }
  return clean;
}

export function saveStats(s: Stats): void {
  writeJson(STATS_KEY, s);
}

export interface GameOutcome {
  won: boolean;
  bluffsMade: number;
  bluffsCaught: number;
  correctCalls: number;
  falseCalls: number;
  pullsSurvived: number;
}

/** Приписывает итог партии к накопленной статистике. */
export function applyOutcome(stats: Stats, outcome: GameOutcome): Stats {
  const streak = outcome.won ? stats.streak + 1 : 0;
  return {
    games: stats.games + 1,
    wins: stats.wins + (outcome.won ? 1 : 0),
    bluffsMade: stats.bluffsMade + outcome.bluffsMade,
    bluffsCaught: stats.bluffsCaught + outcome.bluffsCaught,
    correctCalls: stats.correctCalls + outcome.correctCalls,
    falseCalls: stats.falseCalls + outcome.falseCalls,
    pullsSurvived: stats.pullsSurvived + outcome.pullsSurvived,
    streak,
    bestStreak: Math.max(stats.bestStreak, streak),
  };
}

export function resetStats(): Stats {
  writeJson(STATS_KEY, EMPTY_STATS);
  return { ...EMPTY_STATS };
}
