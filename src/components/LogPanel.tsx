import { useEffect, useRef } from "react";
import type { GameState } from "../game/types";

const TONE_CLASS: Record<string, string> = {
  info: "log__item--info",
  lie: "log__item--lie",
  truth: "log__item--truth",
  shot: "log__item--shot",
  death: "log__item--death",
  survive: "log__item--survive",
  redeal: "log__item--redeal",
  devil: "log__item--devil",
};

interface Props {
  state: GameState;
  /** Управляет видимостью на мобильных (на десктопе всегда виден). */
  open?: boolean;
}

export function LogPanel({ state, open = false }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.log.length]);

  return (
    <aside className={`log ${open ? "is-open" : ""}`} aria-label="Журнал игры">
      <h3 className="log__title">Хроника бара</h3>
      <div
        className="log__scroll"
        ref={ref}
        role="log"
        aria-live="polite"
        tabIndex={0}
      >
        {state.log.map((entry) => (
          <p key={entry.id} className={`log__item ${TONE_CLASS[entry.tone] ?? ""}`}>
            <span className="log__round">Р{entry.round}</span>
            {entry.text}
          </p>
        ))}
      </div>
    </aside>
  );
}
