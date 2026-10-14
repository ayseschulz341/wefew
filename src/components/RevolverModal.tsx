import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CHAMBERS } from "../game/types";
import {
  ROULETTE_STAGE_ORDER,
  rouletteStageMs,
  type RouletteStage,
  type RouletteTimes,
} from "../game/roulettePresentation";
import { GunAudio } from "../game/gunAudio";
import {
  buildRevolverTimes,
  makeSpinTravel,
  poseAt,
  revolverSoundEvents,
  stageAnchor,
  stageOfTime,
  type RevolverScenario,
} from "../game/revolverTimeline";
import {
  cartridgeCountForPull,
  createCartridgeLayout,
} from "../game/revolverVisual";
import { RevolverStage } from "./RevolverStage";

interface Props {
  open: boolean;
  paused?: boolean;
  shooterName: string;
  fired: boolean;
  outcomePending?: boolean;
  /** Номер спуска для стрелка (1..6). */
  pullNumber: number;
  /** Гнёзд оставалось до спуска (6..1): шанс выстрела 1 из N. */
  remainingChambers: number;
  /** Порядок в серии выстрелов (вариант «Дьявол»). */
  index: number;
  total: number;
  /** Только для детерминированной локальной QA-сцены. */
  stageOverride?: RouletteStage;
}

const mod = (value: number, divisor: number) =>
  ((value % divisor) + divisor) % divisor;

const NOTCH = 360 / CHAMBERS;

const BLOOD_DROPS = [
  [16, 24, 13, -18, -34, 20],
  [23, 35, 8, -42, -6, 45],
  [30, 18, 10, 12, -48, 70],
  [38, 29, 6, 48, -20, 95],
  [19, 51, 7, -35, 42, 115],
  [33, 58, 11, 28, 54, 135],
  [46, 43, 5, 64, 18, 155],
  [11, 66, 8, -24, 70, 175],
  [52, 23, 6, 78, -38, 195],
] as const;

/**
 * Кинематографическая сцена русской рулетки на таймлайне оригинальной
 * анимации револьвера: защёлка, откидной барабан, вкладывание патронов,
 * захлопывание, раскрутка внутри рамы, взвод курка, пауза и выстрел.
 *
 * Механика честная, но нечитаемая: барабан останавливается по случайному
 * непрерывному углу, а указателя бойкового гнезда на анимации нет, поэтому
 * по положению патронов нельзя заранее вычислить исход.
 */
export function RevolverModal({
  open,
  paused = false,
  shooterName,
  fired,
  outcomePending = false,
  pullNumber,
  remainingChambers,
  index,
  total,
  stageOverride,
}: Props) {
  const sceneId = `${shooterName}-${pullNumber}-${index}`;
  const firedRef = useRef(fired);
  firedRef.current = fired;
  const pendingRef = useRef(outcomePending);
  pendingRef.current = outcomePending;
  const gunRef = useRef<GunAudio | null>(null);
  const scenarioRef = useRef<RevolverScenario | null>(null);
  const [scene, setScene] = useState<{ id: string; stage: RouletteStage }>({
    id: "",
    stage: "load",
  });
  const [clock, setClock] = useState(0);
  const [lite, setLite] = useState(false);
  const reduceMotion = useReducedMotion();
  const stage: RouletteStage =
    stageOverride ?? (scene.id === sceneId ? scene.stage : "load");
  // Сетка времени зависит от числа патронов (номера спуска).
  const T: RouletteTimes = useMemo(
    () => buildRevolverTimes(pullNumber),
    [pullNumber],
  );

  // На сенсорных устройствах отключаем тяжёлые drop-shadow фильтры SVG.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(pointer: coarse)");
    const update = () => setLite(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  const buildScenario = (): RevolverScenario => {
    const spent = CHAMBERS - remainingChambers;
    const startAngle = spent * NOTCH;
    const spinTravel = makeSpinTravel();
    const finalRotation = startAngle + spinTravel;
    const activeSlot = mod(Math.round(-finalRotation / NOTCH), CHAMBERS);
    const layout = createCartridgeLayout({
      pullNumber,
      activeSlot,
      fired: firedRef.current,
      afterImpact: false,
    });
    const loadOrder = layout
      .map((state, slot) => (state === "live" ? slot : -1))
      .filter((slot) => slot >= 0);
    return { loadOrder, startAngle, spinTravel, fired: firedRef.current };
  };

  useEffect(() => {
    if (stageOverride) {
      scenarioRef.current = buildScenario();
      setScene({ id: sceneId, stage: stageOverride });
      setClock(stageAnchor(stageOverride, T));
      return;
    }
    if (!open || paused) {
      setScene({ id: "", stage: "load" });
      setClock(0);
      return;
    }

    scenarioRef.current = buildScenario();
    setScene({ id: sceneId, stage: "load" });
    setClock(0);

    const events = revolverSoundEvents(scenarioRef.current, T);
    if (!gunRef.current) gunRef.current = new GunAudio();
    const gun = gunRef.current;
    let terminalPlayed = false;
    const playTerminal = () => {
      if (terminalPlayed) return;
      terminalPlayed = true;
      gun.play(firedRef.current ? "bang" : "click");
    };

    if (reduceMotion) {
      // Статичные позы по опорным кадрам стадий, звуки — по таймаутам.
      const stageMs = rouletteStageMs(pullNumber);
      const timers: number[] = [];
      let elapsed = 0;
      for (const nextStage of ROULETTE_STAGE_ORDER) {
        if (nextStage !== "load") {
          timers.push(
            window.setTimeout(() => {
              setScene({ id: sceneId, stage: nextStage });
              setClock(stageAnchor(nextStage, T));
            }, elapsed),
          );
        }
        elapsed += stageMs[nextStage];
      }
      for (const ev of events) {
        timers.push(window.setTimeout(() => gun.play(ev.kind), ev.time));
      }
      // Терминальный звук ждёт исхода: в онлайне он может прийти позже удара.
      timers.push(
        window.setTimeout(() => {
          if (!pendingRef.current) {
            playTerminal();
            return;
          }
          const poll = window.setInterval(() => {
            if (!pendingRef.current) {
              playTerminal();
              window.clearInterval(poll);
            }
          }, 60);
          timers.push(poll);
        }, T.hit),
      );
      return () => timers.forEach(window.clearTimeout);
    }

    // Полная анимация: единый rAF-таймер ведёт и позу, и стадию, и звук.
    // Часы сцены следуют за стенными временем без ограничения шага: на
    // троттлящейся вкладке сцена догоняет одним кадром, а не отстаёт от
    // сервера, который ведёт фазу по настенным часам.
    let raf = 0;
    let t = 0;
    let last = performance.now();
    let evIdx = 0;
    const loop = (now: number) => {
      const dt = Math.max(0, now - last);
      last = now;
      // Клиффхэнгер: пока исход неизвестен, часы замирают за миг до удара.
      const frozen = pendingRef.current && t >= T.hit - 40;
      if (!frozen) {
        t = Math.min(T.end, t + dt);
        while (evIdx < events.length && events[evIdx].time <= t) {
          gun.play(events[evIdx].kind);
          evIdx += 1;
        }
        if (t >= T.hit) playTerminal();
        const nextStage = stageOfTime(t, T);
        setScene((prev) =>
          prev.id === sceneId && prev.stage !== nextStage
            ? { id: sceneId, stage: nextStage }
            : prev,
        );
        setClock(t);
      }
      if (t < T.end) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, paused, sceneId, stageOverride, reduceMotion, pullNumber, remainingChambers, T]);

  const scenario = scenarioRef.current ?? (scenarioRef.current = buildScenario());
  const finalRotation = scenario.startAngle + scenario.spinTravel;
  const activeSlot = mod(Math.round(-finalRotation / NOTCH), CHAMBERS);
  const cartridgeCount = cartridgeCountForPull(pullNumber);
  const afterImpact = stage === "fire" || stage === "result";
  // Раскладка честная: при осечке бойковое гнездо пусто, после выстрела в нём гильза.
  const layout = createCartridgeLayout({
    pullNumber,
    activeSlot,
    fired,
    afterImpact,
  });
  const pose = useMemo(
    () => poseAt(clock, { ...scenario, fired }, T),
    [clock, scenario, fired, T],
  );
  // К раскрутке все показанные патроны уже сидят в гнёздах.
  const drop = layout.map((state, slot) =>
    state === "empty"
      ? 0
      : Math.max(pose.bullets[slot] ?? 0, clock >= T.spinStart ? 1 : 0),
  );

  const showFlash = fired && stage === "fire";
  const showBlood = fired && afterImpact;
  // Слово «ЩЁЛК» держится до конца сцены — это финальная обратная связь осечки.
  const showDryPulse = !fired && (stage === "fire" || stage === "result");
  const showReticle = stage === "cock" || stage === "fire";

  const gunMotion = reduceMotion
    ? { x: 0, y: 0, rotate: 0, scale: 1, opacity: 1 }
    : stage === "load"
      ? { x: 58, y: 34, rotate: 4, scale: 0.9, opacity: 1 }
      : stage === "close"
        ? { x: [58, -12, -6], y: [34, -20, -16], rotate: [4, -9, -7], scale: [0.9, 1.06, 1.03], opacity: 1 }
        : stage === "spin"
          ? { x: [-6, -13, 2, -9, -6], y: -16, rotate: [-7, -10, -4, -8, -7], scale: 1.03, opacity: 1 }
          : stage === "cock"
            ? { x: [-6, -18, -8], y: [-16, -30, -23], rotate: [-7, -11, -8], scale: [1.03, 1.06, 1.04], opacity: 1 }
            : stage === "fire"
              ? { x: [-8, 10, -14, -8], y: [-23, -34, -18, -23], rotate: [-8, -14, -5, -8], scale: [1.04, 1.1, 1.02, 1.04], opacity: 1 }
              : { x: -8, y: -23, rotate: -8, scale: 1.04, opacity: 1 };
  const gunDuration =
    stage === "spin" ? 0.6 : stage === "close" ? 0.48 : stage === "fire" ? 0.4 : 0.52;

  return (
    <AnimatePresence>
      {open && !paused && (
        <motion.div
          className={`overlay overlay--roulette ${showFlash ? "is-bang" : ""} ${showDryPulse ? "is-dry" : ""}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          data-stage={stage}
          data-outcome={outcomePending ? "pending" : fired ? "fired" : "dry"}
          data-pull={pullNumber}
          data-reduced-motion={reduceMotion ? "true" : "false"}
          role="alertdialog"
          aria-label="Русская рулетка"
        >
          <AnimatePresence>
            {showBlood && (
              <motion.div
                key={`blood-${sceneId}`}
                className="roulette__blood"
                aria-hidden="true"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <span className="roulette__blood-splash" />
                {BLOOD_DROPS.map(([left, top, size, x, y, delay], dropIndex) => (
                  <i
                    key={dropIndex}
                    className="roulette__blood-drop"
                    style={
                      {
                        "--blood-left": `${left}%`,
                        "--blood-top": `${top}%`,
                        "--blood-size": `${size}px`,
                        "--blood-x": `${x}px`,
                        "--blood-y": `${y}px`,
                        "--blood-delay": `${delay}ms`,
                      } as CSSProperties
                    }
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
          <motion.div className="roulette" initial={{ scale: 0.92, y: 18 }} animate={{ scale: 1, y: 0 }}>
            <p className="roulette__title">
              Русская рулетка
              {total > 1 && <span className="roulette__series"> · спуск {index} из {total}</span>}
            </p>
            <p className="roulette__who">У револьвера: <b>{shooterName}</b></p>
            <motion.p
              key={`${pullNumber}-${index}`}
              className={`roulette__bullets ${remainingChambers <= 3 ? "is-hot" : ""}`}
              initial={{ scale: 0.72, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 18 }}
            >
              Спуск №{pullNumber} · патронов в барабане — {cartridgeCount} из {CHAMBERS}
            </motion.p>

            <div className="roulette__scene">
              <div className={`roulette__reticle ${showReticle ? "is-visible" : ""}`} aria-hidden="true" />
              <motion.div
                key={sceneId}
                className="revolver-wrap"
                initial={reduceMotion ? { scale: 0.96, opacity: 0 } : { x: 250, y: 94, rotate: 20, scale: 0.62, opacity: 0 }}
                animate={gunMotion}
                transition={{ duration: reduceMotion ? 0.24 : gunDuration, ease: [0.2, 0.85, 0.25, 1] }}
              >
                <RevolverStage
                  pose={pose}
                  cartridges={layout}
                  drop={drop}
                  lite={lite}
                  className="revolver"
                />
                {showDryPulse && <span className="revolver__dry-ring" aria-hidden="true" />}
                {showDryPulse && <span className="revolver__dry-word" aria-hidden="true">ЩЁЛК</span>}
              </motion.div>

              <AnimatePresence>
                {stage === "result" && (
                  <motion.p key={fired ? "bang" : "click"} className={`roulette__result ${fired ? "is-fired" : "is-safe"}`} initial={{ opacity: 0, scale: 0.58, letterSpacing: "0.2em" }} animate={{ opacity: 1, scale: 1, letterSpacing: "0.1em" }} transition={{ type: "spring", stiffness: 320, damping: 17 }}>
                    {fired ? "ВЫСТРЕЛ." : "ЩЁЛК. ПУСТО."}
                    <span>{fired ? "Боевой патрон был в активном гнезде." : "Под ударником было пустое гнездо."}</span>
                  </motion.p>
                )}
              </AnimatePresence>
            </div>

          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
