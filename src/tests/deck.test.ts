import { describe, it, expect } from "vitest";
import {
  CHAMBERS,
  COPIES_PER_RANK,
  DECK_SIZE,
  JOKER_COUNT,
  RANKS,
} from "../game/types";
import {
  createCylinder,
  createDeck,
  createTableDeck,
  hasDevil,
  isDevilCard,
  isTruthfulPlay,
  shuffle,
} from "../game/deck";

describe("Колода лжеца", () => {
  it("20 карт: по 6 Дам, Королей, Тузов и 2 Джокера", () => {
    const deck = createDeck();
    expect(deck).toHaveLength(DECK_SIZE);
    for (const rank of RANKS) {
      expect(deck.filter((c) => c.rank === rank)).toHaveLength(COPIES_PER_RANK);
    }
    expect(deck.filter((c) => c.rank === "JKR")).toHaveLength(JOKER_COUNT);
    expect(new Set(deck.map((c) => c.id)).size).toBe(DECK_SIZE);
  });

  it("ровно по одной карте каждого номинала помечено Дьяволом; джокеры без метки", () => {
    const deck = createDeck();
    for (const rank of RANKS) {
      expect(deck.filter((c) => c.rank === rank && c.devilMark)).toHaveLength(1);
    }
    expect(deck.filter((c) => c.devilMark)).toHaveLength(RANKS.length);
    expect(deck.filter((c) => c.rank === "JKR" && c.devilMark)).toHaveLength(0);
  });

  it("shuffle не теряет и не дублирует карты", () => {
    const deck = createDeck();
    const shuffled = shuffle(deck, Math.random);
    expect(shuffled).not.toBe(deck);
    expect(shuffled).toHaveLength(deck.length);
    expect(new Set(shuffled.map((c) => c.id)).size).toBe(deck.length);
  });

  it("джокер считается за любой номинал, чужой ранг — нет", () => {
    expect(isTruthfulPlay([{ id: "j1", rank: "JKR" }], "Q")).toBe(true);
    expect(isTruthfulPlay([{ id: "a1", rank: "A" }], "A")).toBe(true);
    expect(
      isTruthfulPlay([{ id: "j1", rank: "JKR" }, { id: "k1", rank: "K" }], "Q"),
    ).toBe(false);
  });
});

describe("Колода стола", () => {
  it("по одной карте каждого номинала — равные шансы 1/3", () => {
    const td = createTableDeck();
    expect(td).toHaveLength(RANKS.length);
    for (const rank of RANKS) {
      expect(td.filter((r) => r === rank)).toHaveLength(1);
    }
  });

  it("перемешивание не меняет состав", () => {
    const shuffled = shuffle(createTableDeck(), Math.random);
    expect([...shuffled].sort()).toEqual([...RANKS].sort());
  });
});

describe("Барабан револьвера", () => {
  it("1 боевой патрон на 6 гнёзд", () => {
    for (let i = 0; i < 60; i++) {
      const cyl = createCylinder(Math.random);
      expect(cyl).toHaveLength(CHAMBERS);
      expect(cyl.filter(Boolean)).toHaveLength(1);
    }
  });

  it("за много генераций боевой патрон бывает в каждом гнезде", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const idx = createCylinder(Math.random).indexOf(true);
      seen.add(idx);
    }
    expect(seen.size).toBe(CHAMBERS);
  });
});

describe("Дьявол", () => {
  const card = (rank: string, mark?: boolean) =>
    ({ id: `x-${rank}-${String(mark)}`, rank, devilMark: mark }) as never;

  it("помеченная карта номинала стола — Дьявол только при активном варианте", () => {
    const markedQ = card("Q", true);
    const plainQ = card("Q");
    expect(isDevilCard(markedQ, "Q", true)).toBe(true);
    expect(isDevilCard(markedQ, "Q", false)).toBe(false);
    expect(isDevilCard(markedQ, "K", true)).toBe(false);
    expect(isDevilCard(plainQ, "Q", true)).toBe(false);
  });

  it("джокер никогда не Дьявол", () => {
    expect(isDevilCard(card("JKR"), "Q", true)).toBe(false);
  });

  it("hasDevil находит Дьявола в наборе", () => {
    expect(hasDevil([card("K"), card("Q", true)], "Q", true)).toBe(true);
    expect(hasDevil([card("K")], "Q", true)).toBe(false);
  });
});
