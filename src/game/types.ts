export type Rank = "Q" | "K" | "A";

/** Ранг карты; "JKR" — джокер (считается за любой номинал). */
export type CardKind = Rank | "JKR";

export interface Card {
  id: string;
  rank: CardKind;
  /**
   * Метка дьявола (вариант «Дьявол»). Ровно по одной карте каждого номинала
   * помечено. Метка сама по себе ничего не меняет: карта становится
   * «Дьяволом» только в раунде, где её номинал выбран номиналом стола.
   */
  devilMark?: boolean;
}

export function isJoker(card: Card): boolean {
  return card.rank === "JKR";
}

export const RANKS: Rank[] = ["Q", "K", "A"];

export const RANK_LABELS: Record<CardKind, string> = {
  Q: "Дама",
  K: "Король",
  A: "Туз",
  JKR: "Джокер",
};

/** Название стола раунда: «Стол Дам» и т. п. */
export const TABLE_LABELS: Record<Rank, string> = {
  Q: "Стол Дам",
  K: "Стол Королей",
  A: "Стол Тузов",
};

export const RANK_SHORT: Record<CardKind, string> = {
  Q: "Q",
  K: "K",
  A: "A",
  JKR: "★",
};

export const COPIES_PER_RANK = 6;
export const JOKER_COUNT = 2;
/** Всего карт в колоде лжеца: 6×3 номинала + 2 джокера. */
export const DECK_SIZE = COPIES_PER_RANK * RANKS.length + JOKER_COUNT;

/** Карт в руке игрока в начале раунда. */
export const HAND_SIZE = 5;

/** Максимум карт в одной выкладке (канон: от 1 до 3). */
export const MAX_PLAY_CARDS = 3;

/** Гнёзд в барабане револьвера: 1 боевой + 5 пустых. */
export const CHAMBERS = 6;

/** Секунд на ход (канон: 30). */
export const TURN_SECONDS = 30;

/**
 * Карт, которые могут честно претендовать на номинал стола:
 * 6 карт номинала + 2 джокера.
 */
export const WILD_CAPACITY = COPIES_PER_RANK + JOKER_COUNT;

export type Difficulty = "easy" | "normal" | "hard";

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "Новичок",
  normal: "Завсегдатай",
  hard: "Акула бара",
};

/** Режим игры: классический или официальный вариант «Дьявол». */
export type GameVariant = "classic" | "devil";

export const VARIANT_LABELS: Record<GameVariant, string> = {
  classic: "Классика",
  devil: "Дьявол",
};

export type CharacterKind =
  | "rabbit"
  | "fox"
  | "boar"
  | "bull"
  | "pig"
  | "rat"
  | "wolf"
  | "cat"
  | "goat";

export interface Personality {
  /** 0..1 — насколько охотно обвиняет соседей. */
  aggression: number;
  /** 0..1 — насколько честно играет при наличии нужных карт. */
  honesty: number;
  /** 0..1 — непредсказуемость решений. */
  chaos: number;
  /** 0..1 — насколько крупные блефы предпочитает. */
  bravado: number;
}

export type CharacterId =
  | "scubby"
  | "foxy"
  | "bristle"
  | "toar"
  | "cupcake"
  | "gerk";

/** Короткие реплики персонажа по поводам. */
export interface CharacterLines {
  play: string[];
  bluff: string[];
  challenge: string[];
  caught: string[];
  survived: string[];
}

export interface CharacterDef {
  id: CharacterId;
  name: string;
  title: string;
  kind: CharacterKind;
  persona: Personality;
  lines: CharacterLines;
}

export interface PlayerState {
  seat: number;
  name: string;
  characterId: CharacterId | null;
  isHuman: boolean;
  hand: Card[];
  alive: boolean;
  /**
   * Барабан: очередь гнёзд. true — боевое. Заряжается один раз в начале
   * партии (1 боевой на 6) и перемешивается один раз. Каждый спуск снимает
   * гнездо с начала очереди — поэтому осечки приближают выстрел.
   */
  chambers: boolean[];
  /** Всего раз сыграл лживую выкладку. */
  bluffsMade: number;
  /** Раз пойман на лжи. */
  bluffsCaught: number;
  /** Верных вскрытий чужого блефа. */
  correctCalls: number;
  /** Ложное обвинение (сам тянул курок зря). */
  falseCalls: number;
  /** Число пережитых спусков курка (осечек). */
  pullsSurvived: number;
}

/** Сколько спусков уже сделано из револьвера игрока. */
export function pullsMade(p: PlayerState): number {
  return CHAMBERS - p.chambers.length;
}

/** Гнёзд под курком до следующего спуска: шанс выстрела 1 из N. */
export function chambersLeft(p: PlayerState): number {
  return Math.max(1, p.chambers.length);
}

/** Одна выкладка: игрок положил несколько карт рубашкой вверх за раз. */
export interface PileEntry {
  playerId: number;
  cards: Card[];
}

/** Итог одного спуска курка. */
export interface ShotResult {
  seat: number;
  pullNumber: number;
  remainingChambers: number;
  fired: boolean;
}

export type Phase =
  | { kind: "idle" }
  | {
      kind: "reveal";
      accused: number;
      challenger: number;
      cards: Card[];
      wasLie: boolean;
      /** Вскрыт «Дьявол» — стреляются все, кроме обвинённого. */
      devil: boolean;
      /** Очередь стрелков: обычно один, в варианте «Дьявол» — несколько. */
      shooters: number[];
    }
  | {
      kind: "roulette";
      /** Текущий стрелок. */
      shooter: number;
      /** Номер спуска для стрелка (1..6). */
      pullNumber: number;
      /** Гнёзд оставалось под курок до спуска (6..1). */
      remainingChambers: number;
      fired: boolean;
      /** Онлайн: сервер ещё не раскрыл результат текущего спуска. */
      resultPending?: boolean;
      /** Порядковый номер выстрела в серии (1..total). */
      index: number;
      total: number;
      /** Оставшиеся стрелки после текущего. */
      queue: number[];
      accused: number;
      challenger: number;
      wasLie: boolean;
      devil: boolean;
    }
  | { kind: "gameover"; winner: number | null };

export type LogTone =
  | "info"
  | "lie"
  | "truth"
  | "shot"
  | "death"
  | "survive"
  | "redeal"
  | "devil";

export interface LogEntry {
  id: number;
  round: number;
  text: string;
  tone: LogTone;
}

export interface GameState {
  players: PlayerState[];
  /** Неразданный остаток колоды лжеца. */
  deck: Card[];
  discard: Card[];
  /** Номинал стола на раунд. */
  tableRank: Rank;
  /** В этом раунде помеченная карта номинала стола работает как «Дьявол». */
  devilActive: boolean;
  pile: PileEntry[];
  currentSeat: number;
  roundNumber: number;
  phase: Phase;
  log: LogEntry[];
  logSeq: number;
  difficulty: Difficulty;
  variant: GameVariant;
  /** Кто начинал текущий раунд. */
  roundStarter: number;
}

export type BotAction =
  | { type: "play"; cardIds: string[] }
  | { type: "challenge" };

export type Action =
  | { type: "PLAY_CARDS"; seat: number; cardIds: string[] }
  | { type: "CHALLENGE"; challenger: number }
  | { type: "ADVANCE" };
