import { describe, expect, it } from "vitest";
import { personalState } from "../../server/projection";
import { setRng, startNetworkGame } from "../game/engine";

describe("персональное сетевое состояние", () => {
  it("не раскрывает чужие руки, колоду, закрытую стопку и порядок патронов", () => {
    setRng(() => 0.37);
    const full = startNetworkGame(
      [
        { name: "Аня", characterId: "cupcake" },
        { name: "Борис", characterId: "toar" },
        { name: "Вера", characterId: "foxy" },
        { name: "Глеб", characterId: "gerk" },
      ],
      { difficulty: "normal", variant: "devil", firstSeat: 2 },
    );
    const ownIds = new Set(full.players[2].hand.map((card) => card.id));
    const foreignIds = full.players
      .filter((player) => player.seat !== 2)
      .flatMap((player) => player.hand.map((card) => card.id));
    const deckIds = full.deck.map((card) => card.id);
    full.pile = [{ playerId: 1, cards: [{ id: "private-pile-card", rank: "A", devilMark: true }] }];

    const view = personalState(full, 2);
    const serialized = JSON.stringify(view);

    expect(view.players[0].name).toBe("Вера");
    expect(view.players[0].hand.every((card) => ownIds.has(card.id))).toBe(true);
    expect(view.currentSeat).toBe(0);
    expect(view.roundStarter).toBe(0);
    expect(view.deck).toEqual([]);
    expect(view.discard).toEqual([]);
    expect(view.pile[0].playerId).toBe(3);
    expect(serialized).not.toContain("private-pile-card");
    for (const id of [...foreignIds, ...deckIds]) expect(serialized).not.toContain(id);
    for (const player of view.players) {
      expect(player.chambers.every((chamber) => chamber === false)).toBe(true);
    }
  });

  it("перенумеровывает всех участников фазы относительно получателя", () => {
    setRng(() => 0.21);
    const full = startNetworkGame(
      [
        { name: "1", characterId: "scubby" },
        { name: "2", characterId: "foxy" },
        { name: "3", characterId: "bristle" },
        { name: "4", characterId: "gerk" },
      ],
      { difficulty: "normal", variant: "classic", firstSeat: 0 },
    );
    full.phase = {
      kind: "reveal",
      accused: 1,
      challenger: 2,
      cards: [{ id: "revealed", rank: "K" }],
      wasLie: true,
      devil: false,
      shooters: [1, 3],
    };

    const view = personalState(full, 2);
    expect(view.phase).toMatchObject({
      kind: "reveal",
      accused: 3,
      challenger: 0,
      shooters: [3, 1],
    });
    expect(view.phase.kind === "reveal" && view.phase.cards[0].id).toBe("revealed");
  });

  it("не раскрывает результат рулетки до разрешённого сервером момента", () => {
    setRng(() => 0.51);
    const full = startNetworkGame(
      [
        { name: "1", characterId: "scubby" },
        { name: "2", characterId: "foxy" },
      ],
      { difficulty: "normal", variant: "classic", firstSeat: 0 },
    );
    full.phase = {
      kind: "roulette",
      shooter: 1,
      pullNumber: 2,
      remainingChambers: 5,
      fired: true,
      index: 1,
      total: 1,
      queue: [],
      accused: 1,
      challenger: 0,
      wasLie: true,
      devil: false,
    };

    const pending = personalState(full, 0, false);
    const revealed = personalState(full, 0, true);
    expect(pending.phase).toMatchObject({ kind: "roulette", fired: false, resultPending: true });
    expect(revealed.phase).toMatchObject({ kind: "roulette", fired: true, resultPending: false });
  });
});
