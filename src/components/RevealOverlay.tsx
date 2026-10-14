import { AnimatePresence, motion } from "framer-motion";
import type { Card, Rank } from "../game/types";
import { rankName } from "../game/engine";
import { PlayingCard } from "./PlayingCard";

interface Props {
  open: boolean;
  cards: Card[];
  wasLie: boolean;
  devil: boolean;
  tableRank: Rank;
  accusedName: string;
  challengerName: string;
  shooterNames: string[];
}

export function RevealOverlay({
  open,
  cards,
  wasLie,
  devil,
  tableRank,
  accusedName,
  challengerName,
  shooterNames,
}: Props) {
  const shooters =
    shooterNames.length === 0
      ? "—"
      : shooterNames.length === 1
        ? shooterNames[0]
        : `${shooterNames.slice(0, -1).join(", ")} и ${shooterNames[shooterNames.length - 1]}`;
  const challengerAction =
    challengerName.trim().toLowerCase() === "вы"
      ? "Вы вскрываете"
      : `${challengerName} вскрывает`;
  const accusedPlay =
    accusedName.trim().toLowerCase() === "вы" ? "вашу выкладку" : `выкладку ${accusedName}`;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={`overlay overlay--reveal ${devil ? "is-devil-reveal" : ""}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="alertdialog"
          aria-label="Вскрытие выкладки"
        >
          <motion.div
            className={`reveal ${devil ? "is-devil-reveal" : ""}`}
            initial={{ scale: 0.85, y: 24 }}
            animate={{ scale: 1, y: 0 }}
          >
            {devil && (
              <motion.span
                className="reveal__devil-aura"
                initial={{ opacity: 0, scale: 0.35, rotate: -18 }}
                animate={{ opacity: [0, 0.82, 0.34], scale: [0.35, 1.18, 1], rotate: 0 }}
                transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                aria-hidden="true"
              />
            )}
            <p className="reveal__head">
              {challengerAction} {accusedPlay} · номинал раунда —{" "}
              <b>{rankName(tableRank).toLowerCase()}</b>
            </p>
            <div className="reveal__cards">
              {cards.map((card, i) => (
                <motion.div
                  key={card.id}
                  className="reveal__cardslot"
                  style={{
                    rotate: (i - (cards.length - 1) / 2) * 6,
                    transformStyle: "preserve-3d",
                  }}
                  initial={{ rotateY: 180, scale: 0.8, y: 20, opacity: 0 }}
                  animate={{ rotateY: 0, scale: 1, y: 0, opacity: 1 }}
                  transition={{
                    duration: 0.6,
                    delay: 0.15 + i * 0.12,
                    ease: [0.2, 0.9, 0.25, 1],
                  }}
                >
                  <PlayingCard
                    card={card}
                    faceUp
                    size="lg"
                    devil={devil && card.rank === tableRank && card.devilMark}
                    matchesTable={card.rank === tableRank || card.rank === "JKR"}
                  />
                </motion.div>
              ))}
            </div>

            <motion.p
              className={`reveal__verdict ${wasLie ? "is-lie" : devil ? "is-devil" : "is-truth"}`}
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{
                delay: 0.2 + cards.length * 0.12,
                type: "spring",
                stiffness: 300,
                damping: 16,
              }}
            >
              {wasLie ? "ЛОЖЬ!" : devil ? "ДЬЯВОЛ!" : "ПРАВДА"}
            </motion.p>

            <p className="reveal__shooter">
              {shooterNames.length > 1 ? "Курок спускают" : "К револьверу идёт"}: {" "}
              <b>{shooters}</b>
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
