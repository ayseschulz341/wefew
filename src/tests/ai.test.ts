import { describe, it, expect, beforeEach } from "vitest";
import { reducer, setRng, startGame } from "../game/engine";
import type {
  Action,
  CardKind,
  CharacterId,
  GameState,
  GameVariant,
  PlayerState,
} from "../game/types";
import { CHAMBERS, DECK_SIZE, MAX_PLAY_CARDS } from "../game/types";
import { decideBotAction, gather, suspicionOfTop, _internals } from "../game/ai";
import { mustChallenge } from "../game/engine";

function makeGame(variant: GameVariant = "classic"): GameState {
  return startGame({
    playerName: "Вы",
    playerCharacterId: null,
    botCharacters: ["foxy", "toar", "bristle"],
    difficulty: "normal",
    variant,
    firstSeat: 0,
  });
}

function setCylinder(p: PlayerState, lethalPositions: number[]): void {
  p.chambers = Array.from({ length: CHAMBERS }, (_, i) =>
    lethalPositions.includes(i),
  );
}

function pileFrom(state: GameState, counts: number[], rank: CardKind): void {
  let n = 0;
  state.pile = counts.map((c) => ({
    playerId: 1,
    cards: Array.from({ length: c }, () => ({ id: `x${n++}`, rank })),
  }));
}

/** Все карты партии: колода + отбой + груда + руки. */
function totalCards(s: GameState): number {
  return (
    s.deck.length +
    s.discard.length +
    s.pile.reduce((n, e) => n + e.cards.length, 0) +
    s.players.reduce((n, p) => n + p.hand.length, 0)
  );
}

beforeEach(() => {
  setRng(Math.random);
});

describe("Вероятностная модель", () => {
  it("C(n,r) корректна", () => {
    expect(_internals.nCr(6, 2)).toBe(15);
    expect(_internals.nCr(20, 5)).toBe(15504);
    expect(_internals.nCr(4, 0)).toBe(1);
    expect(_internals.nCr(4, 5)).toBe(0);
  });

  it("гипергеометрия: невозможное событие даёт 0, гарантированное — 1", () => {
    // wilds < k — невозможно.
    expect(_internals.pAtLeastWilds(3, 5, 2, 20)).toBe(0);
    // Все карты пула дикие.
    expect(_internals.pAtLeastWilds(2, 3, 3, 3)).toBe(1);
  });

  it("одиночная заявка на пустом столе почти не подозрительна", () => {
    const s = makeGame();
    s.tableRank = "Q";
    pileFrom(s, [1], "Q");
    s.currentSeat = 2;
    const k = gather(s, 2);
    expect(suspicionOfTop(s, 2, k)).toBeLessThan(0.45);
  });

  it("заявка трёх карт подозрительнее одиночной", () => {
    const s = makeGame();
    s.tableRank = "Q";
    const one = structuredClone(s);
    const three = structuredClone(s);
    pileFrom(one, [1], "Q");
    pileFrom(three, [3], "Q");
    const s1 = suspicionOfTop(one, 2, gather(one, 2));
    const s3 = suspicionOfTop(three, 2, gather(three, 2));
    expect(s3).toBeGreaterThan(s1);
  });

  it("доказанная ложь: заявка превышает число существующих диких карт", () => {
    const s = makeGame();
    s.tableRank = "A";
    // У бота 4 туза на руках → вне его руки максимум 8 − 4 = 4 диких.
    s.players[3].hand = [
      { id: "b1", rank: "A" },
      { id: "b2", rank: "A" },
      { id: "b3", rank: "A" },
      { id: "b4", rank: "A" },
      { id: "b5", rank: "K" },
    ];
    pileFrom(s, [2, 3], "A"); // остальные заявили 5 > 4
    s.currentSeat = 3;
    expect(suspicionOfTop(s, 3)).toBe(1);
  });

  it("модель не видит чужие ранги: знание строится только из своей руки", () => {
    const s = makeGame();
    s.tableRank = "K";
    pileFrom(s, [2], "K");
    const k = gather(s, 2);
    expect(k.unknownCards).toBe(DECK_SIZE - s.players[2].hand.length);
    expect(k.othersClaimed).toBe(2);
    // Своя рука учтена.
    const myWilds = s.players[2].hand.filter(
      (c) => c.rank === "K" || c.rank === "JKR",
    ).length;
    expect(k.myWilds).toBe(myWilds);
  });
});

describe("Решения бота", () => {
  it("доказанная ложь — обвинение почти наверняка", () => {
    const s = makeGame();
    s.tableRank = "A";
    s.players[3].hand = [
      { id: "b1", rank: "A" },
      { id: "b2", rank: "A" },
      { id: "b3", rank: "A" },
      { id: "b4", rank: "A" },
      { id: "b5", rank: "K" },
    ];
    pileFrom(s, [2, 2, 2], "A");
    s.currentSeat = 3;

    let challenges = 0;
    for (let i = 0; i < 200; i++) {
      if (decideBotAction(s, 3, "easy", Math.random)?.type === "challenge") {
        challenges++;
      }
    }
    expect(challenges / 200).toBeGreaterThan(0.9);
  });

  it("обычную первую заявку бот принимает, а не проверяет каждую", () => {
    const s = makeGame();
    s.players[1].characterId = "toar";
    s.tableRank = "A";
    s.players[1].hand = [
      { id: "t1", rank: "A" },
      { id: "t2", rank: "K" },
      { id: "t3", rank: "K" },
      { id: "t4", rank: "K" },
      { id: "t5", rank: "K" },
    ];
    pileFrom(s, [1], "A");
    s.currentSeat = 1;

    let challenges = 0;
    for (let i = 0; i < 300; i++) {
      if (decideBotAction(s, 1, "normal", Math.random)?.type === "challenge") {
        challenges++;
      }
    }
    expect(challenges / 300).toBeLessThan(0.25);
  });

  it("при верном следующем спуске бот перестаёт вскрывать — тянет время", () => {
    function scenario(): GameState {
      const s = makeGame();
      s.players[2].characterId = "toar";
      s.tableRank = "A";
      s.players[2].hand = [
        { id: "s1", rank: "A" },
        { id: "s2", rank: "A" },
        { id: "s3", rank: "K" },
        { id: "s4", rank: "K" },
        { id: "s5", rank: "K" },
      ];
      pileFrom(s, [1, 1], "A");
      s.currentSeat = 2;
      return s;
    }

    const calm = scenario();
    const doomed = scenario();
    doomed.players[2].chambers = [false]; // следующий спуск — смерть

    let calmCalls = 0;
    let doomedCalls = 0;
    for (let i = 0; i < 300; i++) {
      if (decideBotAction(calm, 2, "hard", Math.random)?.type === "challenge") {
        calmCalls++;
      }
      if (decideBotAction(doomed, 2, "hard", Math.random)?.type === "challenge") {
        doomedCalls++;
      }
    }
    expect(calmCalls).toBeGreaterThan(60);
    expect(doomedCalls / 300).toBeLessThan(0.05);
  });

  it("обвиняемый на грани (1 гнездо) провоцирует больше вскрытий", () => {
    function scenario(accusedChambers: number[]): GameState {
      const s = makeGame();
      s.tableRank = "A";
      pileFrom(s, [2], "A");
      s.players[3].characterId = "toar";
      s.players[3].hand = [
        { id: "g1", rank: "K" },
        { id: "g2", rank: "K" },
        { id: "g3", rank: "K" },
        { id: "g4", rank: "K" },
        { id: "g5", rank: "JKR" },
      ];
      setCylinder(s.players[1], accusedChambers);
      s.currentSeat = 3;
      return s;
    }

    const safe = scenario([5]);
    const cornered = scenario([0]);

    let safeCalls = 0;
    let corneredCalls = 0;
    for (let i = 0; i < 400; i++) {
      if (decideBotAction(safe, 3, "hard", Math.random)?.type === "challenge") {
        safeCalls++;
      }
      if (
        decideBotAction(cornered, 3, "hard", Math.random)?.type === "challenge"
      ) {
        corneredCalls++;
      }
    }
    expect(corneredCalls).toBeGreaterThanOrEqual(safeCalls);
  });

  it("бот никогда не играет больше трёх карт и уважает обязанность вскрытия", () => {
    const s = makeGame();
    s.tableRank = "Q";
    pileFrom(s, [1], "Q");
    // Карты остались только у бота → он обязан вскрыть.
    s.players[0].hand = [];
    s.players[1].hand = [];
    s.players[2].hand = [];
    s.currentSeat = 3;

    for (let i = 0; i < 50; i++) {
      const a = decideBotAction(s, 3, "hard", Math.random);
      expect(a?.type).toBe("challenge");
    }

    // Обычная ситуация: выкладки в пределах лимита.
    const normal = makeGame();
    normal.tableRank = "Q";
    for (let seat of [1, 2, 3]) {
      normal.pile = [];
      normal.currentSeat = seat;
      for (let i = 0; i < 100; i++) {
        const a = decideBotAction(normal, seat, "normal", Math.random);
        if (!a) continue;
        if (a.type === "play") {
          expect(a.cardIds.length).toBeGreaterThanOrEqual(1);
          expect(a.cardIds.length).toBeLessThanOrEqual(MAX_PLAY_CARDS);
        }
      }
    }
  });
});

describe("Стресс: случайные партии без потери инвариантов", () => {
  function stepAction(s: GameState): Action | null {
    if (s.phase.kind !== "idle") return { type: "ADVANCE" };
    const seat = s.currentSeat;
    const p = s.players[seat];
    if (p.isHuman) {
      // Канон: последний игрок с картами обязан вскрыть.
      if (mustChallenge(s, seat)) {
        return { type: "CHALLENGE", challenger: seat };
      }
      if (s.pile.length > 0 && Math.random() < 0.35) {
        return { type: "CHALLENGE", challenger: seat };
      }
      // Дьявола нельзя класть вместе с другими картами.
      const isDevilCard = (c: (typeof p.hand)[number]) =>
        c.devilMark === true && c.rank === s.tableRank && s.devilActive;
      const devilIdx = p.hand.findIndex(isDevilCard);
      let picked = p.hand.slice(0, Math.min(MAX_PLAY_CARDS, p.hand.length));
      if (picked.some(isDevilCard)) {
        picked = [devilIdx >= 0 ? p.hand[devilIdx] : picked[0]];
      }
      const ids = picked.map((c) => c.id);
      return { type: "PLAY_CARDS", seat, cardIds: ids };
    }
    const a = decideBotAction(s, seat, s.difficulty, Math.random);
    if (!a) return null;
    return a.type === "challenge"
      ? { type: "CHALLENGE", challenger: seat }
      : { type: "PLAY_CARDS", seat, cardIds: a.cardIds };
  }

  it("40 партий в двух вариантах завершаются без потери карт", () => {
    for (let g = 0; g < 40; g++) {
      const variant = g % 2 === 0 ? "classic" : "devil";
      let s = startGame({
        playerName: `Стресс${g}`,
        playerCharacterId: null,
        botCharacters: ([["foxy"], ["foxy", "toar"], ["foxy", "toar", "bristle"]][g % 3]) as CharacterId[],
        difficulty: (["easy", "normal", "hard"] as const)[g % 3],
        variant,
      });
      let guard = 5000;
      while (s.phase.kind !== "gameover" && guard-- > 0) {
        expect(totalCards(s)).toBe(DECK_SIZE);
        for (const p of s.players) {
          expect(p.hand.length).toBeLessThanOrEqual(5);
          if (!p.alive) expect(p.hand).toHaveLength(0);
        }
        if (s.phase.kind === "idle") {
          const actor = s.players[s.currentSeat];
          expect(actor.alive).toBe(true);
          // Активный игрок либо с картами, либо обязан вскрыть (карты есть).
          expect(actor.hand.length).toBeGreaterThan(0);
        }
        const action = stepAction(s);
        if (!action) break;
        s = reducer(s, action);
      }
      expect(guard).toBeGreaterThan(0);
      expect(s.phase.kind).toBe("gameover");
      expect(totalCards(s)).toBe(DECK_SIZE);
    }
  });

  it("в варианте «Дьявол» залпы не ломают очередь стрелков", () => {
    for (let g = 0; g < 10; g++) {
      let s = startGame({
        playerName: "Дьявол",
        playerCharacterId: null,
        botCharacters: ["cupcake", "gerk", "bristle"],
        difficulty: "normal",
        variant: "devil",
      });
      let guard = 5000;
      while (s.phase.kind !== "gameover" && guard-- > 0) {
        const action = stepAction(s);
        if (!action) break;
        s = reducer(s, action);
      }
      expect(guard).toBeGreaterThan(0);
      expect(s.phase.kind).toBe("gameover");
      const alive = s.players.filter((p) => p.alive);
      expect(alive.length).toBeLessThanOrEqual(1);
    }
  });
});
