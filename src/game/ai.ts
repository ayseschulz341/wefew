import type {
  BotAction,
  Difficulty,
  GameState,
  Personality,
} from "./types";
import {
  CHAMBERS,
  DECK_SIZE,
  HAND_SIZE,
  MAX_PLAY_CARDS,
  WILD_CAPACITY,
} from "./types";
import { isDevilCard, matchesTable } from "./deck";
import { mustChallenge } from "./engine";
import { CHARACTER_BY_ID, DEFAULT_PERSONA } from "./characters";

export {
  CHARACTERS,
  CHARACTER_BY_ID,
  ALL_CHARACTER_IDS,
  DEFAULT_PERSONA,
  botLine,
} from "./characters";

interface DifficultyTuning {
  /** Разброс оценки подозрительности (чем меньше, тем точнее счёт). */
  noise: number;
  /** Смещение порога обвинения: >0 — реже обвиняет. */
  thresholdShift: number;
  /** Насколько бот доверяет точной вероятностной модели (0..1). */
  rigor: number;
}

const TUNING: Record<Difficulty, DifficultyTuning> = {
  easy: { noise: 0.2, thresholdShift: 0.12, rigor: 0.45 },
  normal: { noise: 0.09, thresholdShift: 0, rigor: 0.8 },
  hard: { noise: 0.035, thresholdShift: -0.06, rigor: 1 },
};

/** Априорная вероятность того, что игрок в принципе играет честно. */
const PRIOR_TRUTH = 0.62;

// ---------------------------------------------------------------------------
// Вероятностные помощники
// ---------------------------------------------------------------------------

/** Число сочетаний C(n, r); для малых n без переполнения. */
function nCr(n: number, r: number): number {
  if (r < 0 || n < 0 || r > n) return 0;
  const k = Math.min(r, n - r);
  let res = 1;
  for (let i = 1; i <= k; i++) res = (res * (n - k + i)) / i;
  return res;
}

/**
 * Гипергеометрическая вероятность набрать не менее k «диких» карт в руку
 * размера hand из пула size, в котором wilds диких.
 */
function pAtLeastWilds(
  k: number,
  hand: number,
  wilds: number,
  size: number,
): number {
  if (k <= 0) return 1;
  if (hand <= 0 || size <= 0 || wilds < k) return 0;
  const h = Math.min(hand, size);
  const total = nCr(size, h);
  if (total <= 0) return 0;
  let cumulative = 0;
  for (let x = k; x <= Math.min(h, wilds); x++) {
    cumulative += (nCr(wilds, x) * nCr(size - wilds, h - x)) / total;
  }
  return Math.max(0, Math.min(1, cumulative));
}

// ---------------------------------------------------------------------------
// Знание бота: только публичная информация + собственная рука
// ---------------------------------------------------------------------------

export interface Knowledge {
  /** Диких карт (номинал стола или джокер) у меня на руках. */
  myWilds: number;
  /** Диких карт, которые я сам выложил. */
  myWildsPlayed: number;
  /** Сколько карт я выложил всего. */
  myPlayed: number;
  /** Диких карт, которые могут быть у остальных или в неразданном остатке. */
  wildsElsewhere: number;
  /** Карт, чьи ранги мне неизвестны. */
  unknownCards: number;
  /** Заявлено картами остальных игроков. */
  othersClaimed: number;
  /** Размер верхней выкладки. */
  topCount: number;
  /** Заявлено остальными без верхней выкладки. */
  othersClaimedBelowTop: number;
  /** Размер руки обвиняемого на момент его выкладки. */
  accusedHandAtPlay: number;
}

export function gather(state: GameState, seat: number): Knowledge {
  const me = state.players[seat];
  const tableRank = state.tableRank;

  const myWilds = me.hand.filter((c) => matchesTable(c, tableRank)).length;

  let myWildsPlayed = 0;
  let myPlayed = 0;
  let othersClaimed = 0;
  for (const entry of state.pile) {
    if (entry.playerId === seat) {
      myPlayed += entry.cards.length;
      myWildsPlayed += entry.cards.filter((c) =>
        matchesTable(c, tableRank),
      ).length;
    } else {
      othersClaimed += entry.cards.length;
    }
  }

  const top = state.pile[state.pile.length - 1];
  const topCount = top ? top.cards.length : 0;
  const topIsMine = top ? top.playerId === seat : false;
  const accusedHandAtPlay = top
    ? state.players[top.playerId].hand.length + topCount
    : HAND_SIZE;

  return {
    myWilds,
    myWildsPlayed,
    myPlayed,
    wildsElsewhere: Math.max(0, WILD_CAPACITY - myWilds - myWildsPlayed),
    unknownCards: Math.max(1, DECK_SIZE - me.hand.length - myPlayed),
    othersClaimed,
    topCount,
    othersClaimedBelowTop: Math.max(
      0,
      othersClaimed - (topIsMine ? 0 : topCount),
    ),
    accusedHandAtPlay,
  };
}

/**
 * Подозрительность верхней выкладки: 0 — верю, 1 — ложь доказана.
 *
 * Используется только публичная информация (кто сколько карт заявил) и своя
 * рука — бот не подглядывает в чужие карты. Основа — байесовская смесь:
 *
 *   P(ложь) = w_lie / (w_lie + w_truth),
 *   w_truth = P(честен) · P(у него набралось k диких карт),
 *   w_lie   = P(лжёт),
 *
 * где вторая вероятность считается гипергеометрически. Сверху накладываются
 * два жёстких факта: столько диких карт вообще не существует (доказанная
 * ложь) и переполнение суммарной вместимости номинала.
 */
export function suspicionOfTop(
  state: GameState,
  seat: number,
  k: Knowledge = gather(state, seat),
): number {
  const { topCount } = k;
  if (topCount === 0) return 0;

  // Доказанная ложь: столько диких карт вне моей руки не существует.
  // Перебор вместе с нижними заявками доказательством не является: соврать мог
  // и кто-то раньше, а вскрывается только верхняя выкладка. Этот случай
  // учитывается ниже как сильное подозрение, а не как уверенность.
  if (topCount > k.wildsElsewhere) return 1;

  const feasible = pAtLeastWilds(
    topCount,
    Math.min(k.accusedHandAtPlay, k.unknownCards),
    k.wildsElsewhere,
    k.unknownCards,
  );

  const wTruth = PRIOR_TRUTH * feasible;
  const wLie = 1 - PRIOR_TRUTH;
  let suspicion = wTruth + wLie > 0 ? wLie / (wTruth + wLie) : 0.5;

  // Переполнение вместимости: кто-то точно соврал. Если перебор возник
  // именно на верхней выкладке — она главный подозреваемый.
  if (k.othersClaimed > k.wildsElsewhere) {
    const overflowAtTop = k.othersClaimedBelowTop <= k.wildsElsewhere;
    suspicion = Math.max(suspicion, overflowAtTop ? 0.93 : 0.62);
  }

  return Math.min(1, suspicion);
}

// ---------------------------------------------------------------------------
// Решение бота
// ---------------------------------------------------------------------------

export function decideBotAction(
  state: GameState,
  seat: number,
  difficulty: Difficulty,
  rng: () => number,
): BotAction | null {
  if (state.phase.kind !== "idle" || state.currentSeat !== seat) return null;
  const me = state.players[seat];
  if (!me.alive) return null;

  // Канон: последний игрок с картами обязан вскрывать.
  if (mustChallenge(state, seat)) return { type: "challenge" };
  if (me.hand.length === 0) return null;

  const character = me.characterId
    ? CHARACTER_BY_ID.get(me.characterId)
    : undefined;
  const persona = character?.persona ?? DEFAULT_PERSONA;
  const tuning = TUNING[difficulty];
  const knowledge = gather(state, seat);

  const top = state.pile[state.pile.length - 1];
  const canCall = !!top && top.playerId !== seat;

  if (canCall) {
    const exact = suspicionOfTop(state, seat, knowledge);
    // Слабая сложность «смазывает» точную модель к неуверенным 0.5.
    let suspicion = 0.5 + (exact - 0.5) * tuning.rigor;

    // Длинная груда без вскрытий давит на всех.
    suspicion += Math.min(0.1, Math.max(0, knowledge.othersClaimed - 2) * 0.03);

    // Шум восприятия и непредсказуемость характера.
    suspicion += rng() * tuning.noise * 2 - tuning.noise;
    suspicion += (rng() - 0.5) * persona.chaos * 0.16;

    let threshold = 0.52 - persona.aggression * 0.14 + tuning.thresholdShift;

    // Первой скромной заявке обычно верят.
    if (state.pile.length === 1 && knowledge.topCount <= 2) threshold += 0.08;

    // Чем страшнее мой барабан, тем неохотнее вскрываю чужие карты…
    const myChambers = Math.max(1, me.chambers.length);
    threshold += (CHAMBERS - myChambers) * 0.05;
    // …а при гарантированной смерти вскрывать вообще бессмысленно.
    if (myChambers <= 1) threshold += 0.45;

    // Обвиняемый на грани — поймать его особенно выгодно.
    const accusedChambers = Math.max(
      1,
      state.players[top.playerId].chambers.length,
    );
    if (accusedChambers <= 2) threshold -= 0.08;

    // Вариант «Дьявол»: вскрытие одиночки может обернуться залпом по всем,
    // кроме обвинённого, — проверяем одиночные выкладки осторожнее.
    if (state.devilActive && knowledge.topCount === 1) {
      threshold += 0.1 * tuning.rigor;
    }

    if (suspicion > threshold) return { type: "challenge" };
  }

  return choosePlay(state, seat, persona, rng);
}

function choosePlay(
  state: GameState,
  seat: number,
  persona: Personality,
  rng: () => number,
): BotAction {
  const me = state.players[seat];
  const tableRank = state.tableRank;
  const hand = me.hand;

  const devil = hand.find((c) => isDevilCard(c, tableRank, state.devilActive));
  const matching = hand.filter(
    (c) => matchesTable(c, tableRank) && c.id !== devil?.id,
  );
  const junk = hand.filter((c) => !matchesTable(c, tableRank));

  // Дьявол — честная карта, которую можно класть только одну. Если её
  // вскроют, стреляются все с картами, кроме меня: сильнейший ход в игре.
  if (devil && rng() < 0.8) {
    return { type: "play", cardIds: [devil.id] };
  }

  // Иногда блефуем, даже имея честные карты: давление и маскировка.
  const mindGame = junk.length > 0 && rng() < (1 - persona.honesty) * 0.32;

  if (matching.length > 0 && !mindGame) {
    const maxTake = Math.min(MAX_PLAY_CARDS, matching.length);
    const greed = persona.bravado * 0.6 + rng() * 0.4;
    let take = Math.max(1, Math.min(maxTake, 1 + Math.floor(greed * maxTake)));
    // Не сбрасываем весь запас честных карт разом: пустая рука лишает
    // права хода, а последний с картами обязан идти на вскрытие.
    if (take === matching.length && matching.length > 1 && rng() < 0.4) {
      take -= 1;
    }
    const chosen = shuffleSafe(matching, rng).slice(0, take);
    return { type: "play", cardIds: chosen.map((c) => c.id) };
  }

  // Блеф: мелкие заявки труднее опровергнуть подсчётом.
  const pool = junk.length > 0 ? junk : hand.filter((c) => c.id !== devil?.id);
  const source = pool.length > 0 ? pool : hand;
  const maxBluff = Math.min(MAX_PLAY_CARDS, source.length);
  const boldness = persona.bravado * 0.55 + rng() * 0.45;
  const size = Math.max(
    1,
    Math.min(maxBluff, 1 + Math.floor(boldness * maxBluff * 0.8)),
  );
  const chosen = shuffleSafe(source, rng).slice(0, size);
  return { type: "play", cardIds: chosen.map((c) => c.id) };
}

function shuffleSafe<T>(arr: T[], rng: () => number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Экспортируется для тестов вероятностной модели. */
export const _internals = { nCr, pAtLeastWilds };
