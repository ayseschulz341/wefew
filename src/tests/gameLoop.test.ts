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

  it("выбирает до трёх обычных карт", () => {
    const state = startGame({
      playerName: "Вы",
      playerCharacterId: "foxy",
      botCharacters: ["scubby"],
      difficulty: "normal",
      variant: "classic",
      firstSeat: 0,
    });

    expect(chooseTimeoutCardIds(state, 0)).toEqual(
      state.players[0].hand.slice(0, 3).map((card) => card.id),
    );
  });
});
