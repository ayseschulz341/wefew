import type { Card, CardKind, Rank } from "./types";
import { CHAMBERS, COPIES_PER_RANK, JOKER_COUNT, RANKS } from "./types";

/**
 * Колода лжеца: 6 Дам, 6 Королей, 6 Тузов и 2 Джокера.
 * Ровно одна карта каждого номинала несёт метку дьявола (индекс 0) —
 * она работает как «Дьявол» только в варианте «Дьявол» и только в раунде,
 * где её номинал стал номиналом стола.
 */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const rank of RANKS) {
    for (let i = 0; i < COPIES_PER_RANK; i++) {
      deck.push({ id: `${rank}${i}`, rank, devilMark: i === 0 });
    }
  }
  for (let i = 0; i < JOKER_COUNT; i++) {
    deck.push({ id: `JKR${i}`, rank: "JKR" as CardKind });
  }
  return deck;
}

/** Колода стола: по одной карте каждого номинала — равные шансы 1/3. */
export function createTableDeck(): Rank[] {
  return [...RANKS];
}

/**
 * Барабан револьвера: 1 боевой патрон и 5 пустых гнёзд, перемешанные
 * один раз. Спуск снимает гнездо с начала очереди — барабан больше
 * не вращается, поэтому каждая осечка приближает выстрел.
 */
export function createCylinder(rng: () => number): boolean[] {
  const chambers = Array.from({ length: CHAMBERS }, (_, i) => i === 0);
  return shuffle(chambers, rng);
}

export function shuffle<T>(items: T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Джокер считается за любой номинал. */
export function matchesTable(card: Card, tableRank: Rank): boolean {
  return card.rank === "JKR" || card.rank === tableRank;
}

/** Вся выкладка честна, если каждая её карта — номинал стола или джокер. */
export function isTruthfulPlay(cards: Card[], tableRank: Rank): boolean {
  return cards.every((c) => matchesTable(c, tableRank));
}

/**
 * Карта работает «Дьяволом»: помечена, её номинал — номинал стола,
 * и вариант «Дьявол» активен в этом раунде.
 */
export function isDevilCard(
  card: Card,
  tableRank: Rank,
  devilActive: boolean,
): boolean {
  return devilActive && card.rank === tableRank && card.devilMark === true;
}

/** Есть ли «Дьявол» в наборе карт. */
export function hasDevil(
  cards: Card[],
  tableRank: Rank,
  devilActive: boolean,
): boolean {
  return cards.some((c) => isDevilCard(c, tableRank, devilActive));
}

export function rankCount(cards: Card[], rank: CardKind): number {
  return cards.filter((c) => c.rank === rank).length;
}
