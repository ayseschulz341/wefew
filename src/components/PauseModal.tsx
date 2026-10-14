import { useEffect, useRef } from "react";
import { motion } from "framer-motion";

interface Props {
  onResume: () => void;
  onRules: () => void;
  onRestart?: () => void;
  onExit: () => void;
  online?: boolean;
}

export function PauseModal({ onResume, onRules, onRestart, onExit, online = false }: Props) {
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, []);

  return (
    <div className="overlay overlay--menu" onClick={onResume}>
      <motion.div
        className="modal modal--pause"
        role="dialog"
        aria-modal="true"
        aria-label="Пауза"
        onClick={(e) => e.stopPropagation()}
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.2 }}
      >
        <h2 className="pause__title">Пауза</h2>
        <p className="pause__hint">
          {online
            ? "Меню открыто только у вас. Онлайн-партия и таймер продолжаются."
            : "Стол ждёт. Боты не ходят, время не идёт."}
        </p>
        <div className="pause__actions">
          <button
            ref={first}
            type="button"
            className="btn btn--primary btn--big"
            onClick={onResume}
          >
            Продолжить
          </button>
          <button type="button" className="btn" onClick={onRules}>
            Правила
          </button>
          {onRestart && (
            <button type="button" className="btn" onClick={onRestart}>
              Новая партия
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={onExit}>
            Покинуть бар
          </button>
        </div>
        <p className="pause__keys">
          <b>1–5</b> выбрать карту · <b>Enter</b> положить · <b>L</b> обвинить ·{" "}
          <b>Esc</b> пауза
        </p>
      </motion.div>
    </div>
  );
}
