import { reducer, startGame, mustChallenge } from "../src/game/engine";
import type { Action, GameState } from "../src/game/types";
import { MAX_PLAY_CARDS } from "../src/game/types";
import { decideBotAction } from "../src/game/ai";

function stepAction(s: GameState): Action | null {
  if (s.phase.kind !== "idle") return { type: "ADVANCE" };
  const seat = s.currentSeat;
  const p = s.players[seat];
  if (p.isHuman) {
    if (mustChallenge(s, seat)) return { type: "CHALLENGE", challenger: seat };
    if (s.pile.length > 0 && Math.random() < 0.35) {
      return { type: "CHALLENGE", challenger: seat };
    }
    // Дьявола нельзя класть вместе с другими картами.
    const devilIdx = p.hand.findIndex(
      (c) => c.devilMark && c.rank === s.tableRank,
    );
    let picked =
      devilIdx >= 0 && devilIdx < Math.min(MAX_PLAY_CARDS, p.hand.length)
        ? [p.hand[devilIdx]]
        : p.hand.slice(0, Math.min(MAX_PLAY_CARDS, p.hand.length));
    if (
      picked.length > 1 &&
      picked.some((c) => c.devilMark && c.rank === s.tableRank)
    ) {
      picked = [picked.find((c) => !(c.devilMark && c.rank === s.tableRank))!];
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

for (let g = 0; g < 200; g++) {
  let s = startGame({
    playerName: `Стресс${g}`,
    playerCharacterId: null,
    botCharacters: [["foxy"], ["foxy", "toar"], ["foxy", "toar", "bristle"]][g % 3],
    difficulty: ["easy", "normal", "hard"][g % 3],
    variant: g % 2 === 0 ? "classic" : "devil",
  });
  let guard = 5000;
  let last = "";
  while (s.phase.kind !== "gameover" && guard-- > 0) {
    const action = stepAction(s);
    if (!action) {
      throw new Error(
        `Партия ${g} остановилась до завершения: seat=${s.currentSeat}, round=${s.roundNumber}`,
      );
    }
    last = `${action.type} ${JSON.stringify("cardIds" in action ? action.cardIds?.length : "")} seat=${s.currentSeat} round=${s.roundNumber}`;
    s = reducer(s, action);
  }
  if (guard <= 0) {
    console.log(`STUCK game ${g}:`, last);
    console.log(JSON.stringify({ phase: s.phase, currentSeat: s.currentSeat, hands: s.players.map((p) => [p.name, p.alive, p.hand.length]), pile: s.pile.map((e) => e.cards.length), roundStarter: s.roundStarter }, null, 1));
    process.exit(1);
  }
}
console.log("all ok");
