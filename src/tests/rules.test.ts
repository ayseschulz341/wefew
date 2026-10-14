import { describe, it, expect, beforeEach } from "vitest";
import {
  mustChallenge,
  reducer,
  setRng,
  startGame,
  tableName,
} from "../game/engine";
import type { CardKind, GameVariant } from "../game/types";
import { CHAMBERS, DECK_SIZE, HAND_SIZE, MAX_PLAY_CARDS } from "../game/types";

function queueRng(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i += 1;
    return v;
  };
}

function makeGame(variant: GameVariant = "classic"): ReturnType<typeof startGame> {
  return startGame({
    playerName: "Вы",
    playerCharacterId: null,
    botCharacters: ["foxy", "toar", "bristle"],
    difficulty: "normal",
    variant,
    firstSeat: 0,
  });
}

/** Все карты партии: колода + отбой + груда + руки. */
function totalCards(s: ReturnType<typeof startGame>): number {
  return (
    s.deck.length +
    s.discard.length +
    s.pile.reduce((n, e) => n + e.cards.length, 0) +
    s.players.reduce((n, p) => n + p.hand.length, 0)
  );
}

/**
 * Форсирует выкладку: первые N карт руки получают заданные ранги
 * и играются одним действием.
 */
function forcePlay(
  s: ReturnType<typeof startGame>,
  seat: number,
  ranks: CardKind[],
) {
  const hand = s.players[seat].hand;
  for (let i = 0; i < ranks.length && i < hand.length; i++) {
    hand[i].rank = ranks[i];
  }
  const cardIds = hand.slice(0, ranks.length).map((c) => c.id);
  s.currentSeat = seat;
  s.phase = { kind: "idle" };
  return reducer(s, { type: "PLAY_CARDS", seat, cardIds });
}

beforeEach(() => {
  setRng(Math.random);
});

describe("Начало партии", () => {
  it("раздаёт по 5 карт живым, номинал из отдельной колоды стола", () => {
    const s = makeGame();
    expect(s.players).toHaveLength(4);
    expect(s.players[0].isHuman).toBe(true);
    for (const p of s.players) {
      expect(p.hand).toHaveLength(HAND_SIZE);
      expect(p.alive).toBe(true);
      expect(p.chambers.filter(Boolean)).toHaveLength(1);
    }
    expect(totalCards(s)).toBe(DECK_SIZE);
    expect(["Q", "K", "A"]).toContain(s.tableRank);
    expect(s.currentSeat).toBe(0);
    expect(tableName(s.tableRank)).toMatch(/Стол/);
  });

  it("без явного firstSeat стартующий выбирается случайно", () => {
    setRng(queueRng([0.99]));
    const s = startGame({
      playerName: "Вы",
      playerCharacterId: null,
      botCharacters: ["foxy"],
      difficulty: "normal",
    });
    expect([0, 1]).toContain(s.currentSeat);
  });

  it("в классике Дьявол не активен; в варианте — только при трёх живых", () => {
    expect(makeGame("classic").devilActive).toBe(false);
    expect(makeGame("devil").devilActive).toBe(true);

    const duo = startGame({
      playerName: "Вы",
      playerCharacterId: null,
      botCharacters: ["foxy"],
      difficulty: "normal",
      variant: "devil",
      firstSeat: 0,
    });
    expect(duo.devilActive).toBe(false);
  });
});

describe("Лимит выкладки: от 1 до 3 карт (канон)", () => {
  it("принимает 1, 2 и 3 карты за ход", () => {
    for (const n of [1, 2, 3]) {
      const st = forcePlay(makeGame(), 0, Array(n).fill("Q") as CardKind[]);
      expect(st.pile[0].cards).toHaveLength(n);
      expect(st.currentSeat).toBe(1);
    }
  });

  it("отвергает 4 и 5 карт за один ход — состояние не меняется", () => {
    for (const n of [4, 5]) {
      const s = makeGame();
      const ids = s.players[0].hand.slice(0, n).map((c) => c.id);
      const snap = JSON.stringify(s);
      const st = reducer(s, { type: "PLAY_CARDS", seat: 0, cardIds: ids });
      expect(st.pile).toHaveLength(0);
      expect(JSON.stringify(st)).toBe(snap);
    }
  });

  it("MAX_PLAY_CARDS равен трём", () => {
    expect(MAX_PLAY_CARDS).toBe(3);
  });

  it("пустой список, чужие id, дубликаты и чужой ход отклоняются", () => {
    const s = makeGame();
    const snap = JSON.stringify(s);

    expect(JSON.stringify(reducer(s, { type: "PLAY_CARDS", seat: 0, cardIds: [] }))).toBe(snap);
    expect(JSON.stringify(reducer(s, { type: "PLAY_CARDS", seat: 0, cardIds: ["nope"] }))).toBe(snap);

    const id = s.players[0].hand[0].id;
    expect(
      JSON.stringify(reducer(s, { type: "PLAY_CARDS", seat: 0, cardIds: [id, id] })),
    ).toBe(snap);

    expect(
      JSON.stringify(
        reducer(s, {
          type: "PLAY_CARDS",
          seat: 2,
          cardIds: [s.players[2].hand[0].id],
        }),
      ),
    ).toBe(snap);
  });

  it("лживая выкладка считается блефом, чистый джокер — нет", () => {
    const g1 = makeGame();
    g1.tableRank = "Q";
    expect(forcePlay(g1, 0, ["K"]).players[0].bluffsMade).toBe(1);

    const g2 = makeGame();
    g2.tableRank = "Q";
    expect(forcePlay(g2, 0, ["JKR"]).players[0].bluffsMade).toBe(0);

    const g3 = makeGame();
    g3.tableRank = "Q";
    expect(forcePlay(g3, 0, ["JKR", "K"]).players[0].bluffsMade).toBe(1);
  });
});

describe("Обязательное вскрытие: последний игрок с картами", () => {
  /** Оставляет карты только у seat, у остальных пусто; груда от игрока 1. */
  function soloWithCards(s: ReturnType<typeof startGame>, seat: number): void {
    s.tableRank = "Q";
    s.pile.push({ playerId: 1, cards: [{ id: "z1", rank: "K" }] });
    for (const p of s.players) p.hand = [];
    s.players[seat].hand = [
      { id: `solo-${seat}-a`, rank: "Q" },
      { id: `solo-${seat}-b`, rank: "K" },
    ];
    s.players[1].alive = true;
    s.currentSeat = seat;
  }

  it("mustChallenge истинен, когда карты только у текущего игрока", () => {
    const s = makeGame();
    soloWithCards(s, 0);
    expect(mustChallenge(s, 0)).toBe(true);
  });

  it("не срабатывает при пустой груде или нескольких игроках с картами", () => {
    const emptyPile = makeGame();
    expect(mustChallenge(emptyPile, 0)).toBe(false);

    const many = makeGame();
    many.tableRank = "Q";
    many.pile.push({ playerId: 1, cards: [{ id: "z1", rank: "Q" }] });
    expect(mustChallenge(many, 0)).toBe(false);
  });

  it("нельзя обязать вскрывать собственную выкладку", () => {
    const s = makeGame();
    s.tableRank = "Q";
    // Единственный с картами — игрок 0, но верх груды своя.
    s.players[1].hand = [];
    s.players[2].hand = [];
    s.players[3].hand = [];
    s.pile.push({ playerId: 0, cards: [{ id: "own", rank: "K" }] });
    s.currentSeat = 0;
    expect(mustChallenge(s, 0)).toBe(false);
  });

  it("редьюсер блокирует выкладку последнего игрока с картами", () => {
    const s = makeGame();
    soloWithCards(s, 0);

    const snap = JSON.stringify(s);
    const ids = s.players[0].hand.map((c) => c.id);
    const st = reducer(s, { type: "PLAY_CARDS", seat: 0, cardIds: ids });
    expect(st.pile).toHaveLength(1); // осталась прежней
    expect(JSON.stringify(st)).toBe(snap);

    // А вскрытие проходит.
    const called = reducer(s, { type: "CHALLENGE", challenger: 0 });
    expect(called.phase.kind).toBe("reveal");
  });
});

describe("Передача хода", () => {
  it("ход переходит через игроков без карт", () => {
    const s = makeGame();
    s.players[1].hand = [];
    s.players[3].hand = [];
    const st = reducer(structuredClone(s), {
      type: "PLAY_CARDS",
      seat: 0,
      cardIds: [s.players[0].hand[0].id],
    });
    expect(st.currentSeat).toBe(2);
  });

  /**
   * Круг выкладок без вскрытий. По канону последний игрок с картами обязан
   * вскрывать, поэтому «тихий» конец раунда возможен только когда он сам
   * автор верхней выкладки — редкий случай; проверяем, что раунд в любом
   * случае завершается пересдачей без потери карт.
   */
  it("раунд всегда доигрывается до пересдачи или вскрытия", () => {
    let s = makeGame();
    let guard = 40;
    while (s.roundNumber === 1 && guard-- > 0) {
      if (s.phase.kind !== "idle") throw new Error("unexpected phase");
      const seat = s.currentSeat;
      const p = s.players[seat];
      if (mustChallenge(s, seat)) {
        s = reducer(s, { type: "CHALLENGE", challenger: seat });
        break;
      }
      const take = Math.min(p.hand.length, MAX_PLAY_CARDS);
      const ids = p.hand.slice(0, take).map((c) => c.id);
      s = reducer(s, { type: "PLAY_CARDS", seat, cardIds: ids });
    }
    expect(guard).toBeGreaterThan(0);
    // Раунд сменился (пересдача) либо кто-то пошёл на вскрытие.
    const advanced =
      s.roundNumber === 2 || s.phase.kind === "reveal";
    expect(advanced).toBe(true);
    if (s.roundNumber === 2) {
      expect(s.pile).toHaveLength(0);
      for (const p of s.players) expect(p.hand).toHaveLength(HAND_SIZE);
      expect(totalCards(s)).toBe(DECK_SIZE);
    }
  });
});

describe("Иммутабельность редьюсера", () => {
  it("PLAY_CARDS возвращает новый объект и не портит вход", () => {
    const s = makeGame();
    const snap = JSON.stringify(s);
    const next = reducer(s, {
      type: "PLAY_CARDS",
      seat: 0,
      cardIds: [s.players[0].hand[0].id],
    });
    expect(next).not.toBe(s);
    expect(next.pile).toHaveLength(1);
    expect(JSON.stringify(s)).toBe(snap);
  });

  it("барабан задаётся один раз на партию и не перегенерируется", () => {
    const s = makeGame();
    const before = s.players.map((p) => p.chambers.join(","));
    forcePlay(s, 0, ["K"]);
    const after = s.players.map((p) => p.chambers.join(","));
    expect(after).toEqual(before);
    expect(s.players[0].chambers).toHaveLength(CHAMBERS);
  });
});
