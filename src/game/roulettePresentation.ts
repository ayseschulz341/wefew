/**
 * Тайминги презентации русской рулетки — 1-в-1 с оригинальной анимацией
 * револьвера: защёлка → откидной барабан → заряжание → захлопывание →
 * РАСКРУТКА (внутри рамы, вид сбоку) → взвод курка → пауза → спуск.
 *
 * Длительность загрузки зависит от числа патронов (номера спуска), поэтому
 * сетка времени вычисляется функциями от pullNumber. Эти же функции использует
 * сервер для авторитарного раскрытия исхода и завершения фазы.
 */

export type RouletteStage =
  | "load"
  | "close"
  | "spin"
  | "cock"
  | "fire"
  | "result";

/** Порядок стадий сцены. */
export const ROULETTE_STAGE_ORDER: readonly RouletteStage[] = [
  "load",
  "close",
  "spin",
  "cock",
  "fire",
  "result",
];

/** Внутренние метки сцены (мс от её начала). */
export interface RouletteTimes {
  /** Защёлка: нажатие. */
  latchAt: number;
  latchDur: number;
  /** Барабан откидывается. */
  openAt: number;
  openDur: number;
  /** Вкладывание патронов. */
  loadAt: number;
  loadStep: number;
  loadDur: number;
  /** Барабан идёт в раму. */
  closeStart: number;
  closeDur: number;
  /** Раскрутка внутри рамы. */
  spinStart: number;
  spinDur: number;
  /** Взвод курка. */
  cockStart: number;
  cockDur: number;
  /** Спуск. */
  fireStart: number;
  /** Удар курка: выстрел или осечка. */
  hit: number;
  /** Конец сцены. */
  end: number;
}

// Константы фаз — без изменений из оригинальной анимации.
const LATCH_AT = 500;
const LATCH_DUR = 350;
const OPEN_AT = 750;
const OPEN_DUR = 720;
const LOAD_AT = 1720;
const LOAD_STEP = 380;
const LOAD_DUR = 460;
const CLOSE_GAP = 350;
const CLOSE_DUR = 420;
const SPIN_GAP = 450;
const SPIN_DUR = 2600;
const COCK_GAP = 550;
const COCK_DUR = 380;
// Выдержанная пауза после полного взвода: игрок успевает почувствовать риск,
// но сцена не теряет темп перед нажатием на спуск.
const TENSION = 2300;
const HIT_OFFSET = 280;
/** Сколько после удара курка показываем стадию огня, до текста результата. */
const RESULT_LEAD = 520;
const TAIL = 2600;

const clampPull = (pullNumber: number) =>
  Math.max(1, Math.min(6, Math.round(pullNumber) || 1));

/** Полная сетка времени сцены для данного числа патронов. */
export function rouletteTimes(pullNumber: number): RouletteTimes {
  const rounds = clampPull(pullNumber);
  const closeStart = LOAD_AT + (rounds - 1) * LOAD_STEP + LOAD_DUR + CLOSE_GAP;
  const closeEnd = closeStart + CLOSE_DUR;
  const spinStart = closeEnd + SPIN_GAP;
  const spinEnd = spinStart + SPIN_DUR;
  const cockStart = spinEnd + COCK_GAP;
  const cockEnd = cockStart + COCK_DUR;
  const fireStart = cockEnd + TENSION;
  const hit = fireStart + HIT_OFFSET;
  return {
    latchAt: LATCH_AT,
    latchDur: LATCH_DUR,
    openAt: OPEN_AT,
    openDur: OPEN_DUR,
    loadAt: LOAD_AT,
    loadStep: LOAD_STEP,
    loadDur: LOAD_DUR,
    closeStart,
    closeDur: CLOSE_DUR,
    spinStart,
    spinDur: SPIN_DUR,
    cockStart,
    cockDur: COCK_DUR,
    fireStart,
    hit,
    end: hit + TAIL,
  };
}

/** Длительности стадий сцены (для секвенции и таймеров). */
export function rouletteStageMs(
  pullNumber: number,
): Record<RouletteStage, number> {
  const T = rouletteTimes(pullNumber);
  const fireEnd = T.hit + RESULT_LEAD;
  return {
    load: T.closeStart,
    close: T.spinStart - T.closeStart,
    spin: T.cockStart - T.spinStart,
    cock: T.fireStart - T.cockStart,
    fire: fireEnd - T.fireStart,
    result: T.end - fireEnd,
  };
}

/** Полная длительность сцены — момент смены фазы движком/сервером. */
export function rouletteTotalMs(pullNumber: number): number {
  return rouletteTimes(pullNumber).end;
}

/**
 * Момент раскрытия исхода (удар курка) от начала сцены: по нему сервер
 * снимает resultPending, а сцена играет финальный звук.
 */
export function rouletteHitOffsetMs(pullNumber: number): number {
  return rouletteTimes(pullNumber).hit;
}

/** Стадия сцены в данный момент времени. */
export function rouletteStageOfTime(
  t: number,
  T: RouletteTimes,
): RouletteStage {
  if (t < T.closeStart) return "load";
  if (t < T.spinStart) return "close";
  if (t < T.cockStart) return "spin";
  if (t < T.fireStart) return "cock";
  if (t < T.hit + RESULT_LEAD) return "fire";
  return "result";
}
