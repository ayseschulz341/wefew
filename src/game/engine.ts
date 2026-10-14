import type {
  Action,
  Card,
  CharacterId,
  Difficulty,
  GameState,
  GameVariant,
  LogTone,
  PlayerState,
  Rank,
} from "./types";
import {
  CHAMBERS,
  HAND_SIZE,
  MAX_PLAY_CARDS,
  RANK_LABELS,
  TABLE_LABELS,
} from "./types";
import {
  createCylinder,
  createDeck,
  createTableDeck,
  hasDevil,
  isDevilCard,
  isTruthfulPlay,
  shuffle,
} from "./deck";
import { CHARACTERS } from "./characters";

let rng: () => number = Math.random;

/** Подмена генератора случайности (для тестов). */
export function setRng(fn: () => number): void {
  rng = fn;
}

export function getRng(): () => number {
  return rng;
}

function log(state: GameState, text: string, tone: LogTone): void {
  state.logSeq += 1;
  state.log.push({ id: state.logSeq, round: state.roundNumber, text, tone });
  if (state.log.length > 140) state.log.splice(0, state.log.length - 140);
}

function makePlayer(
  seat: number,
  name: string,
  characterId: CharacterId | null,
  isHuman: boolean,
): PlayerState {
  return {
    seat,
    name,
    characterId,
    isHuman,
    hand: [],
    alive: true,
    chambers: createCylinder(rng),
    bluffsMade: 0,
    bluffsCaught: 0,
    correctCalls: 0,
    falseCalls: 0,
    pullsSurvived: 0,
  };
}

export function rankName(kind: string): string {
  return RANK_LABELS[kind as keyof typeof RANK_LABELS] ?? kind;
}

export function tableName(rank: Rank): string {
  return TABLE_LABELS[rank] ?? rankName(rank);
}

function cardsWord(n: number): string {
  if (n === 1) return "1 карту";
  if (n >= 2 && n <= 4) return `${n} карты`;
  return `${n} карт`;
}

function actorAction(player: PlayerState, thirdPerson: string, secondPerson: string): string {
  const verb = player.name.trim().toLowerCase() === "вы" ? secondPerson : thirdPerson;
  return `${player.name} ${verb}`;
}

// ---------------------------------------------------------------------------
// Старт партии
// ---------------------------------------------------------------------------

export interface StartOptions {
  playerName: string;
  playerCharacterId: CharacterId | null;
  botCharacters: CharacterId[];
  difficulty: Difficulty;
  variant?: GameVariant;
  /** Кто садится первым; по умолчанию выбирается случайно (канон). */
  firstSeat?: number;
}

/** A human player supplied by the authoritative network room. */
export interface NetworkPlayer {
  name: string;
  characterId: CharacterId | null;
}

/**
 * Starts the same rules engine used by the local game, but with an all-human
 * table. Keeping this here means network play cannot drift from local rules.
 */
export function startNetworkGame(
  playersInput: NetworkPlayer[],
  options: Pick<StartOptions, "difficulty" | "variant" | "firstSeat">,
): GameState {
  if (playersInput.length < 2) {
    throw new Error("Network game requires at least two players");
  }
  const players = playersInput.map((player, seat) =>
    makePlayer(seat, player.name.trim() || `Player ${seat + 1}`, player.characterId, true),
  );
  const firstSeat = options.firstSeat === undefined
    ? Math.floor(rng() * players.length)
    : Math.max(0, Math.min(players.length - 1, options.firstSeat));
  const state: GameState = {
    players,
    deck: [],
    discard: [],
    tableRank: "Q",
    devilActive: false,
    pile: [],
    currentSeat: firstSeat,
    roundNumber: 1,
    phase: { kind: "idle" },
    log: [],
    logSeq: 0,
    difficulty: options.difficulty,
    variant: options.variant ?? "classic",
    roundStarter: firstSeat,
  };
  dealRound(state, firstSeat);
  startRoundLog(state);
  return state;
}

export function startGame(opts: StartOptions): GameState {
  const {
    playerName,
    playerCharacterId,
    botCharacters,
    difficulty,
    variant = "classic",
  } = opts;

  const players: PlayerState[] = [
    makePlayer(0, playerName.trim() || "Вы", playerCharacterId, true),
    ...botCharacters.map((id, i) =>
      makePlayer(
        i + 1,
        CHARACTERS.find((c) => c.id === id)?.name ?? id,
        id,
        false,
      ),
    ),
  ];

  const firstSeat =
    opts.firstSeat !== undefined
      ? Math.max(0, Math.min(players.length - 1, opts.firstSeat))
      : Math.floor(rng() * players.length);

  const state: GameState = {
    players,
    deck: [],
    discard: [],
    tableRank: "Q",
    devilActive: false,
    pile: [],
    currentSeat: firstSeat,
    roundNumber: 1,
    phase: { kind: "idle" },
    log: [],
    logSeq: 0,
    difficulty,
    variant,
    roundStarter: firstSeat,
  };

  dealRound(state, firstSeat);
  startRoundLog(state);
  return state;
}

// ---------------------------------------------------------------------------
// Вспомогательные правила
// ---------------------------------------------------------------------------

function nextAliveSeat(players: PlayerState[], fromSeat: number): number {
  const n = players.length;
  for (let step = 1; step <= n; step++) {
    const seat = (fromSeat + step) % n;
    if (players[seat].alive) return seat;
  }
  return fromSeat;
}

/** Следующий игрок с картами на руках; -1, если карт нет ни у кого. */
function nextActor(state: GameState, fromSeat: number): number {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const seat = (fromSeat + step) % n;
    const p = state.players[seat];
    if (p.alive && p.hand.length > 0) return seat;
  }
  return -1;
}

/** Живые игроки, у которых ещё остались карты. */
function seatsWithCards(state: GameState): number[] {
  return state.players
    .filter((p) => p.alive && p.hand.length > 0)
    .map((p) => p.seat);
}

/**
 * Канон: если карты остались лишь у одного игрока, он обязан вскрыть
 * предыдущую выкладку — выкладывать больше нельзя.
 */
export function mustChallenge(state: GameState, seat: number): boolean {
  if (state.phase.kind !== "idle") return false;
  if (state.currentSeat !== seat) return false;
  if (state.pile.length === 0) return false;
  // Обвинять собственную выкладку нельзя ни при каких условиях.
  if (state.pile[state.pile.length - 1].playerId === seat) return false;
  const withCards = seatsWithCards(state);
  return withCards.length === 1 && withCards[0] === seat;
}

export function canChallenge(state: GameState, seat: number): boolean {
  return (
    state.phase.kind === "idle" &&
    state.currentSeat === seat &&
    state.pile.length > 0 &&
    state.pile[state.pile.length - 1].playerId !== seat
  );
}

/** Разрешена ли выкладка этого набора карт (без учёта владения). */
export function isLegalPlaySize(n: number): boolean {
  return n >= 1 && n <= MAX_PLAY_CARDS;
}

/**
 * Полная пересдача: все карты собираются, перетасовываются, колода стола
 * выбирает новый номинал, каждому живому сдаётся по 5 карт.
 */
function dealRound(state: GameState, starterSeat: number): void {
  const pool: Card[] = [];
  for (const p of state.players) {
    pool.push(...p.hand);
    p.hand = [];
  }
  for (const entry of state.pile) pool.push(...entry.cards);
  state.pile = [];
  pool.push(...state.discard);
  state.discard = [];
  pool.push(...state.deck);
  state.deck = [];

  // Колода стола — отдельная: по одной карте каждого номинала, шанс 1/3.
  const tableDeck = shuffle(createTableDeck(), rng);
  state.tableRank = tableDeck[0];

  const aliveCount = state.players.filter((p) => p.alive).length;
  state.devilActive = state.variant === "devil" && aliveCount >= 3;

  state.deck = shuffle(pool.length > 0 ? pool : createDeck(), rng);

  // Сдаём по кругу, начиная со стартующего игрока.
  const order: PlayerState[] = [];
  for (let step = 0; step < state.players.length; step++) {
    const seat = (starterSeat + step) % state.players.length;
    const p = state.players[seat];
    if (p.alive) order.push(p);
  }
  for (const p of order) p.hand = state.deck.splice(0, HAND_SIZE);

  state.currentSeat = state.players[starterSeat].alive
    ? starterSeat
    : nextAliveSeat(state.players, starterSeat);
  state.roundStarter = state.currentSeat;
}

/** Финальная уборка перед экраном победы: все карты — в отбой. */
function sweepToDiscard(state: GameState): void {
  for (const p of state.players) {
    state.discard.push(...p.hand);
    p.hand = [];
  }
  for (const entry of state.pile) state.discard.push(...entry.cards);
  state.pile = [];
  state.discard.push(...state.deck);
  state.deck = [];
}

function startRoundLog(state: GameState): void {
  log(
    state,
    `Раунд ${state.roundNumber}. ${tableName(state.tableRank)}. Начинает ${state.players[state.currentSeat].name}.`,
    "info",
  );
  if (state.devilActive) {
    log(
      state,
      `Среди ${rankName(state.tableRank).toLowerCase()} этого раунда затаился Дьявол.`,
      "devil",
    );
  }
}

// ---------------------------------------------------------------------------
// Редьюсер. Чистая функция: вход не мутируется.
// ---------------------------------------------------------------------------

function cloneState(s: GameState): GameState {
  if (typeof structuredClone === "function") {
    return structuredClone(s);
  }
  return JSON.parse(JSON.stringify(s)) as GameState;
}

export function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case "PLAY_CARDS":
      return playCards(cloneState(state), action.seat, action.cardIds);
    case "CHALLENGE":
      return challenge(cloneState(state), action.challenger);
    case "ADVANCE":
      return advance(cloneState(state));
    default:
      return state;
  }
}

function playCards(
  state: GameState,
  seat: number,
  cardIds: string[],
): GameState {
  if (state.phase.kind !== "idle" || state.currentSeat !== seat) return state;
  // Канон: от 1 до 3 карт за ход.
  if (!isLegalPlaySize(cardIds.length)) return state;
  // Последний игрок с картами обязан вскрывать, а не выкладывать.
  if (mustChallenge(state, seat)) return state;

  const player = state.players[seat];
  if (!player.alive) return state;

  const ids = new Set(cardIds);
  if (ids.size !== cardIds.length) return state;

  const played: Card[] = [];
  const rest: Card[] = [];
  for (const c of player.hand) {
    if (ids.has(c.id)) played.push(c);
    else rest.push(c);
  }
  if (played.length !== cardIds.length) return state;

  // Канон варианта «Дьявол»: Дьявола можно класть только одного.
  if (
    played.length > 1 &&
    hasDevil(played, state.tableRank, state.devilActive)
  ) {
    return state;
  }

  player.hand = rest;
  const isLie = !isTruthfulPlay(played, state.tableRank);
  if (isLie) player.bluffsMade += 1;

  state.pile.push({ playerId: seat, cards: played });

  // ВАЖНО: тон записи нейтральный для всех игроков. Подсветка лжи в журнале
  // до вскрытия выдавала бы блеф ботов человеку бесплатно.
  log(
    state,
    `${actorAction(player, "кладёт", "кладёте")} ${cardsWord(played.length)}. Заявлено на столе: ${pileClaimCount(state)}.`,
    "info",
  );

  advanceTurn(state, seat);
  return state;
}

function pileClaimCount(state: GameState): number {
  return state.pile.reduce((sum, e) => sum + e.cards.length, 0);
}

/**
 * Передача хода. Если карт не осталось ни у кого (последний игрок выложил
 * всё, не будучи обязан вскрывать) — раунд пересдаётся.
 */
function advanceTurn(state: GameState, fromSeat: number): void {
  const next = nextActor(state, fromSeat);
  if (next !== -1) {
    state.currentSeat = next;
    return;
  }
  log(state, "Карты закончились, и никто не потребовал вскрытия. Пересдача.", "redeal");
  state.roundNumber += 1;
  dealRound(state, fromSeat);
  startRoundLog(state);
}

function challenge(state: GameState, challenger: number): GameState {
  if (!canChallenge(state, challenger)) return state;
  const top = state.pile[state.pile.length - 1];
  const accused = top.playerId;
  const wasLie = !isTruthfulPlay(top.cards, state.tableRank);
  const devil =
    !wasLie && hasDevil(top.cards, state.tableRank, state.devilActive);

  let shooters: number[];
  if (wasLie) {
    shooters = [accused];
  } else if (devil) {
    // Канон: вскрыт Дьявол — стреляется обвинитель и все, у кого ещё есть
    // карты, кроме самого обвинённого.
    const extra = state.players
      .filter(
        (p) =>
          p.alive &&
          p.hand.length > 0 &&
          p.seat !== accused &&
          p.seat !== challenger,
      )
      .map((p) => p.seat);
    shooters = [challenger, ...extra];
  } else {
    shooters = [challenger];
  }

  state.phase = {
    kind: "reveal",
    accused,
    challenger,
    cards: top.cards,
    wasLie,
    devil,
    shooters,
  };
  return state;
}

function advance(state: GameState): GameState {
  if (state.phase.kind === "reveal") return resolveReveal(state);
  if (state.phase.kind === "roulette") return resolveRoulette(state);
  return state;
}

function resolveReveal(state: GameState): GameState {
  if (state.phase.kind !== "reveal") return state;
  const { accused, challenger, wasLie, devil, cards, shooters } = state.phase;
  const accusedPlayer = state.players[accused];
  const challengerPlayer = state.players[challenger];

  // Счётчики применяем один раз — на вскрытии.
  if (wasLie) {
    challengerPlayer.correctCalls += 1;
    accusedPlayer.bluffsCaught += 1;
  } else {
    challengerPlayer.falseCalls += 1;
  }

  const shown = cards.map((c) => rankName(c.rank)).join(", ");
  if (wasLie) {
    log(
      state,
      `${actorAction(challengerPlayer, "вскрывает", "вскрываете")} выкладку ${accusedPlayer.name} (${shown}): ЛОЖЬ!`,
      "lie",
    );
  } else {
    log(
      state,
      `${actorAction(challengerPlayer, "вскрывает", "вскрываете")} выкладку ${accusedPlayer.name} (${shown}): правда. Обвинение ошибочно.`,
      "truth",
    );
  }
  if (devil) {
    log(
      state,
      `Это ДЬЯВОЛ. К стволу идут все, у кого остались карты, — кроме ${accusedPlayer.name}.`,
      "devil",
    );
  }

  return beginShot(state, shooters, 0, shooters.length, {
    accused,
    challenger,
    wasLie,
    devil,
  });
}

interface ShotContext {
  accused: number;
  challenger: number;
  wasLie: boolean;
  devil: boolean;
}

/**
 * Готовит спуск курка для очередного стрелка. Гнездо не снимается —
 * только подглядывается, чтобы анимация знала исход. Снятие происходит
 * в resolveRoulette.
 */
function beginShot(
  state: GameState,
  queue: number[],
  doneCount: number,
  total: number,
  ctx: ShotContext,
): GameState {
  const pending = queue.filter((seat) => state.players[seat].alive);
  if (pending.length === 0) {
    return finishRound(state, ctx);
  }

  const shooter = pending[0];
  const rest = pending.slice(1);
  const shooterPlayer = state.players[shooter];
  const remainingChambers = Math.max(1, shooterPlayer.chambers.length);
  const pullNumber = CHAMBERS - remainingChambers + 1;
  const fired = shooterPlayer.chambers[0] === true;

  log(
    state,
    `${actorAction(shooterPlayer, "берёт", "берёте")} свой револьвер. Спуск №${pullNumber}: шанс выстрела ${remainingChambers > 1 ? `1 из ${remainingChambers}` : "верный"}.`,
    "shot",
  );

  state.phase = {
    kind: "roulette",
    shooter,
    pullNumber,
    remainingChambers,
    fired,
    index: doneCount + 1,
    total,
    queue: rest,
    accused: ctx.accused,
    challenger: ctx.challenger,
    wasLie: ctx.wasLie,
    devil: ctx.devil,
  };
  return state;
}

function resolveRoulette(state: GameState): GameState {
  if (state.phase.kind !== "roulette") return state;
  const {
    shooter,
    pullNumber,
    queue,
    index,
    total,
    accused,
    challenger,
    wasLie,
    devil,
  } = state.phase;
  const victim = state.players[shooter];

  // Снимаем гнездо с барабана — он не вращается заново.
  const chamber = victim.chambers.shift();
  const fired = chamber === true;

  if (fired) {
    victim.alive = false;
    state.discard.push(...victim.hand);
    victim.hand = [];
    log(state, `Спуск №${pullNumber}... ВЫСТРЕЛ. ${victim.name} погибает.`, "death");
  } else {
    victim.pullsSurvived += 1;
    const left = victim.chambers.length;
    log(
      state,
      `Спуск №${pullNumber}... щёлк. Осечка.${
        left > 0
          ? ` Следующий спуск — шанс ${left > 1 ? `1 из ${left}` : "верный"}.`
          : ""
      }`,
      "survive",
    );
  }

  const ctx: ShotContext = { accused, challenger, wasLie, devil };
  const alive = state.players.filter((p) => p.alive);
  if (alive.length <= 1) {
    return endGame(state);
  }
  if (queue.length > 0) {
    return beginShot(state, queue, index, total, ctx);
  }
  return finishRound(state, ctx);
}

/**
 * Раунд закончен. Канон: новый раунд начинает пойманный лжец, а при
 * ошибочном обвинении — обвинитель. Если он погиб — следующий живой.
 */
function finishRound(state: GameState, ctx: ShotContext): GameState {
  const alive = state.players.filter((p) => p.alive);
  if (alive.length <= 1) return endGame(state);

  const preferred = ctx.wasLie ? ctx.accused : ctx.challenger;
  const starter = state.players[preferred].alive
    ? preferred
    : nextAliveSeat(state.players, preferred);

  state.roundNumber += 1;
  dealRound(state, starter);
  state.phase = { kind: "idle" };
  startRoundLog(state);
  return state;
}

function endGame(state: GameState): GameState {
  sweepToDiscard(state);
  const alive = state.players.filter((p) => p.alive);
  const winner = alive.length === 1 ? alive[0].seat : null;
  state.phase = { kind: "gameover", winner };
  if (winner !== null) {
    log(
      state,
      `${state.players[winner].name} — последний живой за столом. Победа!`,
      "info",
    );
  } else {
    log(state, "За столом не осталось живых. Бар закрывается.", "death");
  }
  return state;
}

// ---------------------------------------------------------------------------
// Публичные помощники для UI/ИИ
// ---------------------------------------------------------------------------

/** Можно ли положить именно этот набор карт (полная проверка правил). */
export function isPlayAllowed(
  state: GameState,
  seat: number,
  cardIds: string[],
): boolean {
  if (state.phase.kind !== "idle" || state.currentSeat !== seat) return false;
  if (!isLegalPlaySize(cardIds.length)) return false;
  if (mustChallenge(state, seat)) return false;
  const player = state.players[seat];
  if (!player.alive) return false;
  const ids = new Set(cardIds);
  if (ids.size !== cardIds.length) return false;
  const picked = player.hand.filter((c) => ids.has(c.id));
  if (picked.length !== cardIds.length) return false;
  if (picked.length > 1 && hasDevil(picked, state.tableRank, state.devilActive)) {
    return false;
  }
  return true;
}

/** Является ли карта Дьяволом в текущем раунде. */
export function cardIsDevil(state: GameState, card: Card): boolean {
  return isDevilCard(card, state.tableRank, state.devilActive);
}
