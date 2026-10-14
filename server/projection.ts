import type { GameState, Phase } from "../src/game/types";

function rotateSeat(seat: number, viewer: number, count: number): number {
  return (seat - viewer + count) % count;
}

function rotatePhase(phase: Phase, viewer: number, count: number): Phase {
  if (phase.kind === "idle") return phase;
  if (phase.kind === "gameover") {
    return {
      ...phase,
      winner: phase.winner === null ? null : rotateSeat(phase.winner, viewer, count),
    };
  }
  if (phase.kind === "reveal") {
    return {
      ...phase,
      accused: rotateSeat(phase.accused, viewer, count),
      challenger: rotateSeat(phase.challenger, viewer, count),
      shooters: phase.shooters.map((seat) => rotateSeat(seat, viewer, count)),
    };
  }
  return {
    ...phase,
    shooter: rotateSeat(phase.shooter, viewer, count),
    queue: phase.queue.map((seat) => rotateSeat(seat, viewer, count)),
    accused: rotateSeat(phase.accused, viewer, count),
    challenger: rotateSeat(phase.challenger, viewer, count),
  };
}

/**
 * Строит персональное представление партии. Полное серверное состояние,
 * чужие карты и будущий порядок патронов никогда не пересекают эту границу.
 */
export function personalState(
  state: GameState,
  viewer: number,
  showRouletteResult = false,
): GameState {
  const count = state.players.length;
  const players = Array.from({ length: count }, (_, displayedSeat) => {
    const originalSeat = (displayedSeat + viewer) % count;
    const player = state.players[originalSeat];
    return {
      ...player,
      seat: displayedSeat,
      isHuman: displayedSeat === 0,
      hand:
        originalSeat === viewer
          ? player.hand.map((card) => ({ ...card }))
          : Array.from({ length: player.hand.length }, (_, index) => ({
              id: `hidden-${displayedSeat}-${index}`,
              rank: "Q" as const,
            })),
      chambers: Array(player.chambers.length).fill(false) as boolean[],
    };
  });

  return {
    ...state,
    players,
    deck: [],
    discard: [],
    pile: state.pile.map((entry, playIndex) => ({
      playerId: rotateSeat(entry.playerId, viewer, count),
      cards: Array.from({ length: entry.cards.length }, (_, cardIndex) => ({
        id: `pile-${playIndex}-${cardIndex}`,
        rank: "Q" as const,
      })),
    })),
    currentSeat: rotateSeat(state.currentSeat, viewer, count),
    roundStarter: rotateSeat(state.roundStarter, viewer, count),
    phase: (() => {
      const phase = rotatePhase(state.phase, viewer, count);
      if (phase.kind === "roulette" && !showRouletteResult) {
        return { ...phase, fired: false, resultPending: true };
      }
      return phase.kind === "roulette" ? { ...phase, resultPending: false } : phase;
    })(),
  };
}
