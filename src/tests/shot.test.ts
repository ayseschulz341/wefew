import { describe, it, expect, beforeEach } from "vitest";
import { reducer, setRng, startGame } from "../game/engine";
import type { GameState, GameVariant, PlayerState } from "../game/types";
import { CHAMBERS, DECK_SIZE } from "../game/types";

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

/** Явный барабан: позиции боевых гнёзд (для детерминизма выстрелов). */
function setCylinder(p: PlayerState, lethalPositions: number[]): void {
  p.chambers = Array.from({ length: CHAMBERS }, (_, i) =>
    lethalPositions.includes(i),
  );
}

function totalCards(s: GameState): number {
  return (
    s.deck.length +
    s.discard.length +
    s.pile.reduce((n, e) => n + e.cards.length, 0) +
    s.players.reduce((n, p) => n + p.hand.length, 0)
  );
}

/**
 * Сценарий вскрытия: accused кладёт карту (честную или ложь), игрок
 * обвиняет; фазы прогоняются до конца раунда.
 */
function runCall(
  s: GameState,
  accusedSeat: number,
  truthful = false,
): GameState {
  s.tableRank = "Q";
  const hand = s.players[accusedSeat].hand;
  const card = hand.shift()!;
  card.rank = truthful ? "Q" : "K";
  s.pile.push({ playerId: accusedSeat, cards: [card] });
  s.currentSeat = 0;

  let st = reducer(s, { type: "CHALLENGE", challenger: 0 });
  if (st.phase.kind !== "reveal") throw new Error("expected reveal");
  st = reducer(st, { type: "ADVANCE" });
  if (st.phase.kind !== "roulette") throw new Error("expected roulette");
  while (st.phase.kind === "roulette") {
    st = reducer(st, { type: "ADVANCE" });
  }
  return st;
}

beforeEach(() => {
  setRng(Math.random);
});

describe("Обвинение: вскрывается только последняя выкладка", () => {
  it("обвиняется автор верхней выкладки, не более ранней", () => {
    const s = makeGame();
    s.tableRank = "Q";
    const honest = s.players[1].hand[0];
    honest.rank = "Q";
    const junk = s.players[2].hand[0];
    junk.rank = "K";
    s.pile.push({ playerId: 1, cards: [honest] });
    s.pile.push({ playerId: 2, cards: [junk] });
    s.currentSeat = 0;

    const st = reducer(s, { type: "CHALLENGE", challenger: 0 });
    if (st.phase.kind !== "reveal") throw new Error("expected reveal");
    expect(st.phase.accused).toBe(2);
    expect(st.phase.wasLie).toBe(true);
    expect(st.phase.shooters).toEqual([2]);
    expect(st.phase.cards.map((c) => c.id)).toEqual([junk.id]);
  });

  it("джокер-выкладка честна → стреляет обвинитель", () => {
    const s = makeGame();
    s.tableRank = "Q";
    const joker = s.players[1].hand[0];
    joker.rank = "JKR";
    s.pile.push({ playerId: 1, cards: [joker] });
    s.currentSeat = 0;

    let st = reducer(s, { type: "CHALLENGE", challenger: 0 });
    if (st.phase.kind !== "reveal") throw new Error("expected reveal");
    expect(st.phase.wasLie).toBe(false);
    expect(st.phase.shooters).toEqual([0]);

    // Осечка на первом спуске.
    setCylinder(st.players[0], [5]);
    st = reducer(st, { type: "ADVANCE" }); // → roulette
    st = reducer(st, { type: "ADVANCE" }); // спуск
    expect(st.players[0].alive).toBe(true);
    expect(st.players[0].falseCalls).toBe(1);
    expect(st.players[0].pullsSurvived).toBe(1);
  });

  it("нельзя обвинять при пустой груде, чужом ходе или свою выкладку", () => {
    const s = makeGame();
    const snap = JSON.stringify(s);
    expect(JSON.stringify(reducer(s, { type: "CHALLENGE", challenger: 0 }))).toBe(snap);

    s.pile.push({ playerId: 1, cards: [{ id: "zz", rank: "Q" }] });
    s.currentSeat = 2;
    expect(JSON.stringify(reducer(s, { type: "CHALLENGE", challenger: 0 }))).toBe(
      JSON.stringify({ ...s }),
    );

    s.currentSeat = 1; // верхняя выкладка — самого игрока 1
    expect(JSON.stringify(reducer(s, { type: "CHALLENGE", challenger: 1 }))).toBe(
      JSON.stringify({ ...s }),
    );
  });

  it("счётчики применяются ровно один раз", () => {
    let s = makeGame();
    setCylinder(s.players[1], [0]); // патрон в первом гнезде — выстрел сразу
    s = runCall(s, 1, false);
    // Живых осталось трое — партия продолжается новым раундом.
    expect(s.phase.kind).toBe("idle");
    expect(s.players[1].alive).toBe(false);
    expect(s.players[0].correctCalls).toBe(1);
    expect(s.players[1].bluffsCaught).toBe(1);
  });
});

describe("Барабан без переспина", () => {
  it("шанс растёт: 1/6 → 1/5 → … → верный спуск", () => {
    let s = makeGame();
    setCylinder(s.players[1], []); // все гнёзда пустые — все осечки

    for (let i = 0; i < CHAMBERS - 1; i++) {
      s.tableRank = "Q";
      const card = s.players[1].hand.shift()!;
      card.rank = "K";
      s.pile.push({ playerId: 1, cards: [card] });
      s.currentSeat = 0;
      let st = reducer(s, { type: "CHALLENGE", challenger: 0 });
      if (st.phase.kind !== "reveal") throw new Error("expected reveal");
      st = reducer(st, { type: "ADVANCE" });
      if (st.phase.kind !== "roulette") throw new Error("expected roulette");
      expect(st.phase.remainingChambers).toBe(CHAMBERS - i);
      expect(st.phase.pullNumber).toBe(i + 1);
      st = reducer(st, { type: "ADVANCE" });
      s = st as GameState;
      expect(s.players[1].alive).toBe(true);
      expect(s.players[1].pullsSurvived).toBe(i + 1);

      // После раунда карты пересданы.
      expect(s.roundNumber).toBe(i + 2);
    }

    // Последний (шестой) спуск — верный.
    s.tableRank = "Q";
    setCylinder(s.players[1], [0]);
    const card = s.players[1].hand.shift()!;
    card.rank = "K";
    s.pile.push({ playerId: 1, cards: [card] });
    s.currentSeat = 0;
    let st = reducer(s, { type: "CHALLENGE", challenger: 0 });
    st = reducer(st, { type: "ADVANCE" });
    st = reducer(st, { type: "ADVANCE" });
    expect(st.players[1].alive).toBe(false);
  });

  it("после гибели предпоследнего партия завершается победой живого", () => {
    const duo = startGame({
      playerName: "Вы",
      playerCharacterId: null,
      botCharacters: ["foxy"],
      difficulty: "normal",
      firstSeat: 0,
    });
    setCylinder(duo.players[1], [0]); // первый же спуск смертелен
    const s = runCall(duo, 1, false);
    expect(s.players[1].alive).toBe(false);
    expect(s.phase.kind).toBe("gameover");
    if (s.phase.kind !== "gameover") return;
    expect(s.phase.winner).toBe(0);
    expect(totalCards(s)).toBe(DECK_SIZE); // всё в отбой
  });
});

describe("Кто начинает следующий раунд", () => {
  it("пойманный лжец начинает сам, а не сосед", () => {
    let s = makeGame();
    setCylinder(s.players[1], [5]); // осечка
    s = runCall(s, 1, false);
    expect(s.roundNumber).toBe(2);
    expect(s.roundStarter).toBe(1);
    expect(s.currentSeat).toBe(1);
    expect(s.pile).toHaveLength(0);
    for (const p of s.players.filter((p) => p.alive)) {
      expect(p.hand).toHaveLength(5);
    }
  });

  it("при ошибочном обвинении раунд начинает сам обвинитель", () => {
    let s = makeGame();
    setCylinder(s.players[0], [5]); // обвинитель выживает
    s = runCall(s, 1, true); // обвинение ошибочно
    expect(s.roundStarter).toBe(0);
    expect(s.currentSeat).toBe(0);
  });

  it("если стартующий погиб — начинает следующий живой по кругу", () => {
    let s = makeGame();
    setCylinder(s.players[1], [0]); // пойманный лжец погибает
    s = runCall(s, 1, false);
    expect(s.players[1].alive).toBe(false);
    expect(s.roundStarter).toBe(2); // следующий живой после 1
    expect(s.currentSeat).toBe(2);
  });
});

describe("Вариант «Дьявол»", () => {
  /** Игрок 1 кладёт одну Даму с меткой; игрок 0 вскрывает. */
  function devilPlay(s: GameState): GameState {
    s.tableRank = "Q";
    const card = s.players[1].hand[0];
    card.rank = "Q";
    card.devilMark = true;
    s.pile.push({ playerId: 1, cards: [card] });
    s.currentSeat = 0;
    return reducer(s, { type: "CHALLENGE", challenger: 0 });
  }

  it("вскрытый Дьявол честен, но стреляются все с картами кроме обвинённого", () => {
    const s = makeGame("devil");
    const st = devilPlay(s);
    if (st.phase.kind !== "reveal") throw new Error("expected reveal");
    expect(st.phase.devil).toBe(true);
    expect(st.phase.wasLie).toBe(false);
    // Обвинитель + остальные с картами; обвинённого нет.
    expect(st.phase.shooters.sort()).toEqual([0, 2, 3]);
  });

  it("пустые руки спасают от залпа", () => {
    const s = makeGame("devil");
    s.players[2].hand = []; // пустая рука — вне очереди стрелков
    const st = devilPlay(s);
    if (st.phase.kind !== "reveal") throw new Error("expected reveal");
    expect(st.phase.shooters.sort()).toEqual([0, 3]);
  });

  it("в классике тот же расклад — обычное вскрытие без залпа", () => {
    const s = makeGame("classic");
    const st = devilPlay(s);
    if (st.phase.kind !== "reveal") throw new Error("expected reveal");
    expect(st.phase.devil).toBe(false);
    expect(st.phase.shooters).toEqual([0]);
  });

  it("редьюсер запрещает класть Дьявола вместе с другими картами", () => {
    const s = makeGame("devil");
    s.tableRank = "Q";
    const hand = s.players[0].hand;
    const marked = hand[0];
    marked.rank = "Q";
    marked.devilMark = true;
    const other = hand[1];
    s.currentSeat = 0;
    const snap = JSON.stringify(s);
    const st = reducer(s, {
      type: "PLAY_CARDS",
      seat: 0,
      cardIds: [marked.id, other.id],
    });
    expect(JSON.stringify(st)).toBe(snap);

    // А один Дьявол положить можно.
    const ok = reducer(s, { type: "PLAY_CARDS", seat: 0, cardIds: [marked.id] });
    expect(ok.pile).toHaveLength(1);
    expect(ok.currentSeat).toBe(1);
  });
});

describe("Журнал для игрока «Вы»", () => {
  it("гибель и ошибочное обвинение — во втором лице", () => {
    const s = makeGame();
    setCylinder(s.players[0], [0]);
    const st = runCall(s, 1, true); // выкладка честная — стреляет обвинитель «Вы»
    const text = st.log.map((entry) => entry.text).join("\n");
    expect(text).toContain("Вы вскрываете выкладку Foxy");
    expect(text).toContain("Вы погибаете.");
    expect(text).not.toContain("Вы погибает.");
  });

  it("вскрытие выкладки игрока — «вашу выкладку»", () => {
    const s = makeGame();
    s.tableRank = "Q";
    const card = s.players[0].hand.shift()!;
    card.rank = "K";
    s.pile.push({ playerId: 0, cards: [card] });
    s.currentSeat = 1;

    const st = reducer(reducer(s, { type: "CHALLENGE", challenger: 1 }), { type: "ADVANCE" });
    const text = st.log.map((entry) => entry.text).join("\n");
    expect(text).toContain("Foxy вскрывает вашу выкладку");
    expect(text).not.toContain("выкладку Вы");
  });
});
