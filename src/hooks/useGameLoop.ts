import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type {
  Action,
  CharacterId,
  Difficulty,
  GameState,
  GameVariant,
} from "../game/types";
import { MAX_PLAY_CARDS } from "../game/types";
import {
  canChallenge as canChallengeRule,
  getRng,
  isPlayAllowed,
  mustChallenge as mustChallengeRule,
  reducer,
  startGame,
} from "../game/engine";
import { decideBotAction } from "../game/ai";
import { ALL_CHARACTER_IDS, botLine } from "../game/characters";
import { sfx } from "../game/sounds";
import { rouletteHitOffsetMs, rouletteTotalMs } from "../game/roulettePresentation";

export interface GameSetup {
  playerName: string;
  characterId: CharacterId | null;
  difficulty: Difficulty;
  botCount: number;
  variant: GameVariant;
  timerEnabled: boolean;
  turnSeconds?: number;
}

const BOT_THINK_MIN = 1400;
const BOT_THINK_MAX = 2600;
const REVEAL_MS = 2800;
/** Сколько держится реплика над местом игрока. */
const TAUNT_MS = 3200;

/** Короткая реплика над местом игрока. */
export interface Taunt {
  id: number;
  seat: number;
  text: string;
}

function initGame(setup: GameSetup): GameState {
  const pool = ALL_CHARACTER_IDS.filter((id) => id !== setup.characterId);

  const rng = getRng();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const botCount = Math.max(1, Math.min(3, Math.floor(setup.botCount) || 3));

  return startGame({
    playerName: setup.playerName,
    playerCharacterId: setup.characterId,
    botCharacters: pool.slice(0, botCount),
    difficulty: setup.difficulty,
    variant: setup.variant,
  });
}

export interface GameApi {
  state: GameState;
  isMyTurn: boolean;
  canChallenge: boolean;
  /** Канон: последний игрок с картами обязан вскрывать. */
  mustChallenge: boolean;
  /** Сколько секунд осталось на ход; null — таймер выключен/не идёт. */
  secondsLeft: number | null;
  taunts: Taunt[];
  playCard: (cardIds: string[]) => void;
  challenge: () => void;
  /** Проверка допустимости набора перед отправкой. */
  isPlayAllowed: (cardIds: string[]) => boolean;
}

/**
 * Выбирает гарантированно допустимую выкладку при истечении таймера.
 * В частности, активного Дьявола нельзя отправлять вместе с другими картами.
 */
export function chooseTimeoutCardIds(state: GameState, seat: number): string[] {
  const hand = state.players[seat]?.hand ?? [];
  if (hand.length === 0) return [];

  const take = Math.min(MAX_PLAY_CARDS, hand.length);
  const preferred = hand.slice(0, take).map((card) => card.id);
  if (isPlayAllowed(state, seat, preferred)) return preferred;

  const legalSingle = hand.find((card) => isPlayAllowed(state, seat, [card.id]));
  return legalSingle ? [legalSingle.id] : [];
}

export function useGameLoop(setup: GameSetup, paused = false): GameApi {
  const [state, dispatch] = useReducer(
    reducer as (s: GameState, a: Action) => GameState,
    setup,
    initGame,
  );

  const isMyTurn =
    !paused &&
    state.phase.kind === "idle" &&
    state.currentSeat === 0 &&
    state.players[0].alive;

  const mustCall = mustChallengeRule(state, 0);
  const canCall = canChallengeRule(state, 0) && isMyTurn;

  // --- Реплики персонажей -------------------------------------------------
  const [taunts, setTaunts] = useState<Taunt[]>([]);
  const tauntSeq = useRef(0);

  const say = useCallback((seat: number, text: string | null) => {
    if (!text) return;
    tauntSeq.current += 1;
    const id = tauntSeq.current;
    setTaunts((prev) => [...prev.filter((t) => t.seat !== seat), { id, seat, text }]);
    setTimeout(() => {
      setTaunts((prev) => prev.filter((t) => t.id !== id));
    }, TAUNT_MS);
  }, []);

  // --- Автопродвижение фаз с таймингами под анимации ----------------------
  useEffect(() => {
    if (paused) return;
    if (state.phase.kind === "reveal") {
      const t = setTimeout(() => dispatch({ type: "ADVANCE" }), REVEAL_MS);
      return () => clearTimeout(t);
    }
    if (state.phase.kind === "roulette") {
      // Длительность сцены зависит от числа патронов (номера спуска).
      const t = setTimeout(
        () => dispatch({ type: "ADVANCE" }),
        rouletteTotalMs(state.phase.pullNumber),
      );
      return () => clearTimeout(t);
    }
  }, [state.phase, paused]);

  // Реплики по итогам вскрытия и выстрела.
  const lastPhaseKey = useRef("");
  useEffect(() => {
    const phase = state.phase;
    if (phase.kind === "reveal") {
      const key = `reveal-${phase.accused}-${phase.challenger}-${state.roundNumber}`;
      if (lastPhaseKey.current === key) return;
      lastPhaseKey.current = key;
      const accused = state.players[phase.accused];
      sfx.play("flip");
      if (phase.devil) {
        sfx.playVoice(accused.characterId, "devilRevealed");
      }
      if (phase.wasLie && !phase.devil) {
        sfx.playVoice(accused.characterId, "caughtLying");
      }
      if (phase.wasLie && !accused.isHuman) {
        say(phase.accused, botLine(accused.characterId, "caught"));
      }
      return;
    }
    if (phase.kind === "roulette" && !phase.fired) {
      const key = `shot-${phase.shooter}-${phase.pullNumber}-${state.roundNumber}`;
      if (lastPhaseKey.current === key) return;
      lastPhaseKey.current = key;
      const shooter = state.players[phase.shooter];
      if (!shooter.isHuman) {
        // Реплика «выжил» звучит сразу после щелчка курка.
        setTimeout(
          () => say(phase.shooter, botLine(shooter.characterId, "survived")),
          rouletteHitOffsetMs(phase.pullNumber) + 600,
        );
      }
    }
  }, [state.phase, state.players, state.roundNumber, say]);

  // --- Ход бота -----------------------------------------------------------
  useEffect(() => {
    if (paused || state.phase.kind !== "idle") return;
    const p = state.players[state.currentSeat];
    if (!p || p.isHuman || !p.alive) return;

    const delay = BOT_THINK_MIN + Math.random() * (BOT_THINK_MAX - BOT_THINK_MIN);
    const t = setTimeout(() => {
      const seat = state.currentSeat;
      const a = decideBotAction(state, seat, state.difficulty, Math.random);
      if (!a) return;
      if (a.type === "challenge") {
        sfx.play("heartbeat");
        sfx.playVoice(p.characterId, "challenge");
        say(seat, botLine(p.characterId, "challenge"));
        dispatch({ type: "CHALLENGE", challenger: seat });
      } else {
        sfx.play("card");
        sfx.playVoice(p.characterId, "play", {
          count: a.cardIds.length,
          rank: state.tableRank,
        });
        // Реплика зависит от честности выкладки — но игроку она не выдаёт
        // правду: бот врёт и в словах тоже.
        say(seat, botLine(p.characterId, Math.random() < 0.5 ? "play" : "bluff"));
        dispatch({ type: "PLAY_CARDS", seat, cardIds: a.cardIds });
      }
    }, delay);
    return () => clearTimeout(t);
  }, [state, paused, say]);

  // --- Таймер хода (канон: 30 с) ------------------------------------------
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  // Ключ хода: меняется на каждом новом ходе, перезапуская отсчёт.
  const turnKey =
    state.phase.kind === "idle"
      ? `${state.roundNumber}-${state.currentSeat}-${state.pile.length}`
      : "";

  useEffect(() => {
    if (!setup.timerEnabled || paused || !isMyTurn) {
      setSecondsLeft(null);
      return;
    }
    const turnSeconds = Math.max(5, Math.floor(setup.turnSeconds ?? 30));
    setSecondsLeft(turnSeconds);
    const started = Date.now();
    const iv = setInterval(() => {
      const left = turnSeconds - Math.floor((Date.now() - started) / 1000);
      setSecondsLeft(left > 0 ? left : 0);
    }, 250);
    return () => clearInterval(iv);
  }, [turnKey, isMyTurn, paused, setup.timerEnabled, setup.turnSeconds]);

  // Истечение времени: обязан вскрывать — вскрываем, иначе кладём случайное.
  useEffect(() => {
    if (secondsLeft !== 0 || !isMyTurn || paused) return;
    const me = state.players[0];
    if (mustCall || (canCall && me.hand.length === 0)) {
      sfx.play("heartbeat");
      sfx.playVoice(me.characterId, "challenge");
      dispatch({ type: "CHALLENGE", challenger: 0 });
      return;
    }
    const ids = chooseTimeoutCardIds(state, 0);
    if (ids.length > 0) {
      sfx.play("card");
      sfx.playVoice(me.characterId, "play", {
        count: ids.length,
        rank: state.tableRank,
      });
      dispatch({ type: "PLAY_CARDS", seat: 0, cardIds: ids });
    }
  }, [
    secondsLeft,
    isMyTurn,
    paused,
    mustCall,
    canCall,
    state.players,
    state.tableRank,
    state.devilActive,
  ]);

  const playCards = useCallback(
    (cardIds: string[]) => {
      if (paused) return;
      if (!isPlayAllowed(state, 0, cardIds)) return;
      sfx.play("card");
      const me = state.players[0];
      sfx.playVoice(me.characterId, "play", {
        count: cardIds.length,
        rank: state.tableRank,
      });
      dispatch({ type: "PLAY_CARDS", seat: 0, cardIds });
    },
    [state, paused],
  );

  const challenge = useCallback(() => {
    if (paused) return;
    if (!canCall) return;
    sfx.play("heartbeat");
    sfx.playVoice(state.players[0].characterId, "challenge");
    dispatch({ type: "CHALLENGE", challenger: 0 });
  }, [canCall, paused, state.players]);

  const checkPlay = useCallback(
    (cardIds: string[]) => isPlayAllowed(state, 0, cardIds),
    [state],
  );

  return useMemo(
    () => ({
      state,
      isMyTurn,
      canChallenge: canCall,
      mustChallenge: mustCall,
      secondsLeft,
      taunts,
      playCard: playCards,
      challenge,
      isPlayAllowed: checkPlay,
    }),
    [
      state,
      isMyTurn,
      canCall,
      mustCall,
      secondsLeft,
      taunts,
      playCards,
      challenge,
      checkPlay,
    ],
  );
}
