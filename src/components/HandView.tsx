import { useEffect, useState, type CSSProperties } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { Card, Rank } from "../game/types";
import { MAX_PLAY_CARDS, RANK_LABELS } from "../game/types";
import { plural } from "../game/plural";
import { PlayingCard } from "./PlayingCard";

interface Props {
  hand: Card[];
  tableRank: Rank;
  /** Карта работает Дьяволом в этом раунде (её можно класть только одну). */
  isDevil: (card: Card) => boolean;
  canAct: boolean;
  canChallenge: boolean;
  mustChallenge: boolean;
  secondsLeft: number | null;
  /** Полное время хода — масштаб полосы таймера. */
  turnSeconds: number;
  /**
   * Меняется с каждым ходом, вскрытием и пересдачей. Выбор карт привязан к нему:
   * id карт постоянны между раундами, и старый выбор «оживал» в новой руке.
   */
  resetKey: string;
  /** Пояснение, почему сейчас нельзя ходить (ход соперника, пауза…). */
  waitingHint?: string | null;
  onPlay: (cardIds: string[]) => void;
  onChallenge: () => void;
}

/** Склонение: 1 карта / 2-4 карты / 5+ карт. */
function cardsWord(n: number): string {
  if (n === 1) return "1 карту";
  if (n >= 2 && n <= 4) return `${n} карты`;
  return `${n} карт`;
}

export function HandView({
  hand,
  tableRank,
  isDevil,
  canAct,
  canChallenge,
  mustChallenge,
  secondsLeft,
  turnSeconds,
  resetKey,
  waitingHint = null,
  onPlay,
  onChallenge,
}: Props) {
  const [selection, setSelection] = useState<{ key: string; ids: string[] }>({
    key: resetKey,
    ids: [],
  });
  const selected = selection.key === resetKey ? selection.ids : [];
  const setSelected = (update: string[] | ((prev: string[]) => string[])) =>
    setSelection((prev) => {
      const current = prev.key === resetKey ? prev.ids : [];
      return {
        key: resetKey,
        ids: typeof update === "function" ? update(current) : update,
      };
    });
  const [warn, setWarn] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();

  // Выбор протухает, если карты ушли из руки (пересдача раунда).
  const handIds = new Set(hand.map((c) => c.id));
  const picked = selected.filter((id) => handIds.has(id));

  const flash = (text: string) => {
    setWarn(text);
    setTimeout(() => setWarn((w) => (w === text ? null : w)), 2200);
  };

  const toggle = (cardId: string) => {
    if (!canAct || mustChallenge) return;
    const card = hand.find((c) => c.id === cardId);
    if (!card) return;

    setSelected((prev) => {
      const current = prev.filter((id) => handIds.has(id));
      if (current.includes(cardId)) {
        return current.filter((id) => id !== cardId);
      }
      // Дьявола можно класть только одного.
      if (isDevil(card)) {
        if (current.length > 0) flash("Дьявола кладут только одного");
        return [cardId];
      }
      if (current.some((id) => {
        const c = hand.find((x) => x.id === id);
        return c && isDevil(c);
      })) {
        flash("Дьявола кладут только одного");
        return current;
      }
      if (current.length >= MAX_PLAY_CARDS) {
        flash(`За ход можно выложить не больше ${MAX_PLAY_CARDS} карт`);
        return current;
      }
      return [...current, cardId];
    });
  };

  const play = () => {
    if (!canAct || mustChallenge || picked.length === 0) return;
    onPlay(picked);
    setSelected([]);
  };

  // --- Клавиатура: 1-5 выбирают карты, Enter кладёт, L обвиняет -----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key >= "1" && e.key <= "9") {
        const idx = Number(e.key) - 1;
        if (idx < hand.length) {
          e.preventDefault();
          toggle(hand[idx].id);
        }
        return;
      }
      if (e.key === "Enter") {
        // Enter на кнопке нажимает саму кнопку («Обвинить» и т. п.).
        if (target?.closest("button, a")) return;
        if (canAct && !mustChallenge && picked.length > 0) {
          e.preventDefault();
          play();
        }
        return;
      }
      if (e.key.toLowerCase() === "l" || e.key.toLowerCase() === "д") {
        if (canChallenge) {
          e.preventDefault();
          onChallenge();
        }
        return;
      }
      if (e.key === "Escape" && picked.length > 0) {
        e.preventDefault();
        setSelected([]);
      }
    };
    // Фаза перехвата: Esc сначала снимает выбор карт и не открывает паузу.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const label = RANK_LABELS[tableRank] ?? tableRank;
  const timerHot = secondsLeft !== null && secondsLeft <= 10;

  return (
    <div className="hand">
      <div className="hand__cards" role="group" aria-label="Ваши карты">
        <AnimatePresence mode="popLayout">
          {hand.map((card, i) => {
            const angle = (i - (hand.length - 1) / 2) * 5;
            const devil = isDevil(card);
            const isPicked = picked.includes(card.id);
            const matches = card.rank === tableRank || card.rank === "JKR";
            return (
              <motion.div
                layout="position"
                key={card.id}
                className={`hand__slot ${isPicked ? "is-selected" : ""}`}
                style={{ "--i": i } as CSSProperties}
                initial={
                  reduceMotion
                    ? { opacity: 0 }
                    : { y: -90, opacity: 0, rotate: angle * 3, scale: 0.88 }
                }
                animate={{
                  y: reduceMotion ? 0 : isPicked ? -22 : 0,
                  opacity: 1,
                  rotate: angle,
                  scale: reduceMotion ? 1 : isPicked ? 1.045 : 1,
                }}
                exit={
                  reduceMotion
                    ? { opacity: 0 }
                    : { y: -150, opacity: 0, rotate: angle * 0.35, scale: 0.72 }
                }
                transition={{
                  delay: Math.min(i * 0.055, 0.36),
                  type: "spring",
                  stiffness: isPicked ? 420 : 260,
                  damping: isPicked ? 22 : 24,
                  layout: { type: "spring", stiffness: 340, damping: 28 },
                }}
              >
                <PlayingCard
                  card={card}
                  faceUp
                  devil={devil}
                  matchesTable={matches}
                  selected={isPicked}
                  disabled={!canAct || mustChallenge}
                  index={i + 1}
                  onClick={() => toggle(card.id)}
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
        {hand.length === 0 && <p className="hand__empty">Рука пуста</p>}
      </div>

      <div className="hand__actions">
        <p className="hand__hint" aria-live="polite">
          {warn ? (
            <span className="hand__warn">{warn}</span>
          ) : mustChallenge ? (
            <span className="hand__warn">
              Карты остались только у вас — по правилам вы обязаны вскрыть
              выкладку соседа
            </span>
          ) : (
            <>
              Номинал раунда: <b>{label}</b> · джокер подходит к любому номиналу · за ход от 1
              до {MAX_PLAY_CARDS} карт
              {waitingHint && <span> · {waitingHint}</span>}
            </>
          )}
        </p>

        <div className="hand__buttons">
          <button
            type="button"
            className={`btn btn--danger ${mustChallenge ? "is-required" : ""}`}
            disabled={!canChallenge}
            onClick={onChallenge}
          >
            Обвинить во лжи!
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!canAct || mustChallenge || picked.length === 0}
            onClick={play}
          >
            Положить{" "}
            {picked.length > 0 ? cardsWord(picked.length).toLowerCase() : "карты"}
          </button>
        </div>

        {secondsLeft !== null && (
          <div
            className={`hand__timer ${timerHot ? "is-hot" : ""}`}
            role="timer"
            aria-label={`Осталось ${secondsLeft} ${plural(secondsLeft, "секунда", "секунды", "секунд")}`}
          >
            <div className="hand__timer-bar">
              <i
                style={{
                  width: `${Math.min(100, (secondsLeft / Math.max(1, turnSeconds)) * 100)}%`,
                }}
              />
            </div>
            <span>{secondsLeft} с</span>
          </div>
        )}
      </div>
    </div>
  );
}
