import {
  rouletteStageOfTime,
  rouletteTimes,
  type RouletteStage,
  type RouletteTimes,
} from "./roulettePresentation";

/**
 * Чистый таймлайн револьверной сцены: по времени возвращает позу револьвера.
 * Никакого DOM — только расчёт, поэтому хореография полностью тестируется.
 *
 * Порядок и длительности фаз 1-в-1 перенесены из оригинальной анимации:
 * защёлка → барабан откидывается → заряжание → барабан закрывается →
 * раскрутка уже внутри рамы (вид сбоку) → взвод курка → пауза → спуск.
 * Барабан после захлопывания остаётся закрытым до конца сцены.
 */

export { rouletteStageOfTime as stageOfTime };

export interface RevolverScenario {
  /** Слоты (0..5) в порядке вкладывания патронов. */
  loadOrder: readonly number[];
  /** Стартовый угол барабана в градусах, выровнен по каморам. */
  startAngle: number;
  /** Полный угол поворота барабана за раскрутку, градусы (> 0). */
  spinTravel: number;
  /** Выстрел (true) или осечка (false). */
  fired: boolean;
}

export interface RevolverPose {
  /** 0..1 степень нажатия защёлки барабана. */
  latch: number;
  /** 0 барабан закрыт (вид сбоку) .. 1 откинут (вид лицом) */
  cylOpen: number;
  /** Абсолютный угол поворота барабана, градусы. */
  spin: number;
  /** Мгновенная скорость, град/мс — для смазки. */
  spinVel: number;
  /** Прогресс укладки патрона по каждому слоту, 0..1. */
  bullets: number[];
  /** 0 курка спущен .. 1 взведён. */
  hammer: number;
  trigger: number;
  recoil: number;
  flash: number;
  smoke: number;
  /** -1..1 мелкая тряска при осечке. */
  shake: number;
  /** 0..1 наезд камеры. */
  zoom: number;
  /** Толчок рамы при захлопывании барабана. */
  jolt: number;
  /** Детерминированное зерно для мерцания вспышки. */
  seed: number;
}

export type RevolverSoundKind =
  | "latch"
  | "open"
  | "load"
  | "tick"
  | "close"
  | "cock"
  | "trigger"
  | "bang"
  | "click";

export interface RevolverSoundEvent {
  time: number;
  kind: RevolverSoundKind;
}

const CHAMBER_COUNT = 6;

const SPIN_POWER = 3.2;
/** Раскрутка: мощный разгон и долгое плавное затухание — как в оригинале. */
const spinEase = (x: number) => 1 - Math.pow(1 - x, SPIN_POWER);
const spinEaseDeriv = (x: number) => SPIN_POWER * Math.pow(1 - x, SPIN_POWER - 1);

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const seg = (t: number, start: number, dur: number) =>
  clamp01((t - start) / dur);

export const easeInOutCubic = (x: number) =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
export const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
export const easeInCubic = (x: number) => x * x * x;
export const easeInQuad = (x: number) => x * x;

/** Сетка времени сцены для данного числа патронов (обёртка презентации). */
export function buildRevolverTimes(pullNumber: number): RouletteTimes {
  return rouletteTimes(pullNumber);
}

/**
 * Случайный угол остановки барабана: целые обороты плюс непрерывный сдвиг.
 * Сдвиг всегда 15..45° — барабан никогда не останавливается ровно каморой
 * вверх, поэтому по положению патронов нельзя вычислить бойковое гнездо.
 */
export function makeSpinTravel(rng: () => number = Math.random): number {
  const turns = 4 + Math.floor(rng() * 3);
  const offset = 15 + rng() * 30;
  return turns * 360 + offset;
}

/** Опорные кадры для статичной отрисовки (reduced motion и QA-сцены). */
export function stageAnchor(
  stage: RouletteStage,
  T: RouletteTimes,
): number {
  switch (stage) {
    case "load":
      return T.loadAt + T.loadDur;
    case "close":
      return T.closeStart + T.closeDur + 200;
    case "spin":
      return T.spinStart + T.spinDur - 80;
    case "cock":
      return T.cockStart + T.cockDur + 120;
    case "fire":
      return T.hit + 160;
    case "result":
      return T.hit + 1200;
  }
}

export function poseAt(
  t: number,
  s: RevolverScenario,
  T: RouletteTimes = buildRevolverTimes(1),
): RevolverPose {
  // Защёлка: нажать и отпустить перед откидыванием барабана.
  const lp = seg(t, T.latchAt, T.latchDur);
  const latch =
    lp < 0.4 ? easeOutCubic(lp / 0.4) : 1 - easeInOutCubic((lp - 0.4) / 0.6);

  // Барабан откидывается на заряжании и захлопывается перед раскруткой.
  let cylOpen = easeInOutCubic(seg(t, T.openAt, T.openDur));
  if (t >= T.closeStart) cylOpen = 1 - easeInCubic(seg(t, T.closeStart, T.closeDur));

  // Толчок рамы при защёлкивании барабана.
  const jp = seg(t, T.closeStart + T.closeDur, 260);
  const jolt = jp >= 1 ? 0 : (1 - jp) * Math.sin(jp * Math.PI * 3);

  // Патроны укладываются по одному в порядке loadOrder.
  const bullets = Array.from({ length: CHAMBER_COUNT }, (_, slot) => {
    const order = s.loadOrder.indexOf(slot);
    if (order < 0) return 0;
    return seg(t, T.loadAt + order * T.loadStep, T.loadDur);
  });

  // Раскрутка с затуханием — внутри рамы, после захлопывания.
  const sx = seg(t, T.spinStart, T.spinDur);
  const spin = s.startAngle + s.spinTravel * spinEase(sx);
  const spinVel =
    t >= T.spinStart && t < T.spinStart + T.spinDur
      ? (s.spinTravel * spinEaseDeriv(sx)) / T.spinDur
      : 0;

  // Курок: взводится после раскрутки и падает непосредственно перед ударом.
  let hammer = easeOutCubic(seg(t, T.cockStart, T.cockDur));
  const fallStart = T.hit - 70;
  if (t >= fallStart) hammer = 1 - easeInQuad(seg(t, fallStart, 70));

  // Спусковой крючок нажимается и плавно отпускается после удара.
  let trigger = easeInOutCubic(seg(t, T.fireStart, 240));
  trigger *= 1 - easeInOutCubic(seg(t, T.hit + 700, 500));

  // Наезд камеры на взводе и паузе, плавный отъезд после выстрела.
  let zoom = easeInOutCubic(seg(t, T.cockStart, T.fireStart - T.cockStart + 100));
  if (t >= T.hit + 120) zoom *= 1 - easeInOutCubic(seg(t, T.hit + 120, 700));

  // Эффекты выстрела или осечки.
  let recoil = 0;
  let flash = 0;
  let smoke = 0;
  let shake = 0;
  if (t >= T.hit) {
    if (s.fired) {
      const r = seg(t, T.hit, 900);
      if (r < 0.08) recoil = easeOutCubic(r / 0.08);
      else {
        const q = (r - 0.08) / 0.92;
        recoil = Math.exp(-4.5 * q) * Math.cos(q * Math.PI * 2.2);
        if (q > 0.995) recoil = 0;
      }
      const f = seg(t, T.hit, 170);
      flash = f >= 1 ? 0 : Math.pow(1 - f, 1.6);
      smoke = seg(t, T.hit + 40, 2200);
    } else {
      const sp = seg(t, T.hit, 260);
      shake = sp >= 1 ? 0 : (1 - sp) * Math.sin(sp * Math.PI * 5);
    }
  }

  return {
    latch,
    cylOpen,
    spin,
    spinVel,
    bullets,
    hammer,
    trigger,
    recoil,
    flash,
    smoke,
    shake,
    zoom,
    jolt,
    seed: Math.floor(t / 16),
  };
}

/**
 * Все звуковые реплики сцены, кроме финальной (bang/click): исход в онлайне
 * может стать известен позже, поэтому терминальный звук играет отдельным
 * вызовом в момент, когда часам сцены разрешено дойти до удара.
 */
export function revolverSoundEvents(
  s: RevolverScenario,
  T: RouletteTimes,
): RevolverSoundEvent[] {
  const ev: RevolverSoundEvent[] = [
    { time: T.latchAt + 80, kind: "latch" },
    { time: T.openAt + T.openDur * 0.9, kind: "open" },
  ];
  s.loadOrder.forEach((_slot, order) => {
    ev.push({
      time: T.loadAt + order * T.loadStep + T.loadDur * 0.72,
      kind: "load",
    });
  });
  // Трещотка: щелчок на каждые 60° поворота, но не чаще 28 мс.
  let last = -Infinity;
  const total = Math.floor(s.spinTravel / 60);
  for (let k = 1; k <= total; k++) {
    const frac = (k * 60) / s.spinTravel;
    const x = 1 - Math.pow(1 - frac, 1 / SPIN_POWER);
    const time = T.spinStart + x * T.spinDur;
    if (time - last >= 28) {
      ev.push({ time, kind: "tick" });
      last = time;
    }
  }
  ev.push({ time: T.closeStart + T.closeDur, kind: "close" });
  ev.push({ time: T.cockStart + 60, kind: "cock" });
  ev.push({ time: T.cockStart + 230, kind: "cock" });
  ev.push({ time: T.fireStart + 120, kind: "trigger" });
  return ev.sort((a, b) => a.time - b.time);
}
