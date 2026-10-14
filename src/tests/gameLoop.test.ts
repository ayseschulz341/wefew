import { describe, expect, it } from "vitest";
import { chooseTimeoutCardIds } from "../hooks/useGameLoop";
import { startGame } from "../game/engine";

describe("автоматический ход по таймеру", () => {
  it("никогда не кладёт Дьявола вместе с другими картами", () => {
    const state = startGame({
      playerName: "Вы",
      playerCharacterId: "foxy",
      botCharacters: ["scubby", "bristle"],
      difficulty: "normal",
      variant: "devil",
      firstSeat: 0,
    });

    state.tableRank = "Q";
    state.devilActive = true;
    state.players[0].hand = [
      { id: "Q0", rank: "Q", devilMark: true },
      { id: "K1", rank: "K" },
      { id: "A1", rank: "A" },
    ];

    expect(chooseTimeoutCardIds(state, 0)).toEqual(["Q0"]);
  });

  it("кладёт одну карту — минимальный ход, как и сетевой сервер", () => {
    const state = startGame({
      playerName: "Вы",
      playerCharacterId: "foxy",
      botCharacters: ["scubby"],
      difficulty: "normal",
      variant: "classic",
      firstSeat: 0,
    });

    expect(chooseTimeoutCardIds(state, 0)).toEqual([state.players[0].hand[0].id]);
  });

  it("ничего не кладёт, когда игрок обязан вскрывать", () => {
    const state = startGame({
      playerName: "Вы",
      playerCharacterId: "foxy",
      botCharacters: ["scubby"],
      difficulty: "normal",
      variant: "classic",
      firstSeat: 0,
    });
    state.players[1].hand = [];
    state.pile = [{ playerId: 1, cards: [{ id: "K5", rank: "K" }] }];

    expect(chooseTimeoutCardIds(state, 0)).toEqual([]);
  });
});
