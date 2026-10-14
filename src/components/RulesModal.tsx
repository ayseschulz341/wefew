import { useEffect, useRef } from "react";
import type { GameVariant } from "../game/types";
import { CHAMBERS, HAND_SIZE, MAX_PLAY_CARDS, TURN_SECONDS } from "../game/types";

interface Props {
  variant?: GameVariant;
  /** Время на ход из настроек партии; null — без ограничения. */
  turnSeconds?: number | null;
  onClose: () => void;
}

const ODDS = [
  { n: 1, odds: "1 из 6" },
  { n: 2, odds: "1 из 5" },
  { n: 3, odds: "1 из 4" },
  { n: 4, odds: "1 из 3" },
  { n: 5, odds: "1 из 2" },
  { n: 6, odds: "выстрел неизбежен" },
];

export function RulesModal({ variant = "classic", turnSeconds = TURN_SECONDS, onClose }: Props) {
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeBtn.current?.focus();
    // Фаза перехвата и preventDefault: Esc закрывает только правила, а не
    // открывает следом меню паузы стола.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="overlay overlay--menu" onClick={onClose}>
      <div
        className="modal rules"
        role="dialog"
        aria-modal="true"
        aria-label="Правила"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="rules__title">Карты лжеца — правила</h2>

        <section className="rules__section">
          <h3>Цель</h3>
          <p>
            В партии участвуют от двух до четырёх игроков. Цель — остаться последним живым.
            У каждого — свой шестизарядный револьвер: <b>1 боевой патрон</b> и
            5 пустых гнёзд, перемешанных <b>один раз</b> перед партией. Барабан
            больше не крутится, поэтому каждая осечка приближает выстрел.
          </p>
        </section>

        <section className="rules__section">
          <h3>Раунд</h3>
          <p>
            Колода лжеца — 20 карт: <b>6 Дам, 6 Королей, 6 Тузов и 2 Джокера</b>.
            Отдельная колода стола вскрывает <b>номинал раунда</b> (Дама, Король
            или Туз) — шанс каждого равен. Затем колода тасуется и каждому живому
            сдаётся по {HAND_SIZE} карт.
          </p>
          <p>
            Карты номинала стола и джокеры считаются <b>честными</b>, все
            остальные — <b>ложью</b>.
          </p>
        </section>

        <section className="rules__section">
          <h3>Ход</h3>
          <p>
            {turnSeconds ? `За ${turnSeconds} секунд нужно` : "В свой ход нужно"} либо выложить{" "}
            <b>от 1 до {MAX_PLAY_CARDS} карт</b> рубашкой вверх, заявляя номинал
            стола, либо <b>крикнуть «Лжец»</b> на предыдущего игрока. Первым
            ходом обвинять некого.
          </p>
          <ul className="rules__list">
            <li>
              Кто остался <b>без карт</b> — пропускает ходы до конца раунда.
            </li>
            <li>
              Если карты остались <b>только у одного</b> игрока, он <b>обязан</b>{" "}
              крикнуть «Лжец» — выкладывать больше нельзя.
            </li>
          </ul>
        </section>

        <section className="rules__section">
          <h3>Вскрытие</h3>
          <p>
            Вскрывается <b>только последняя выкладка</b> обвинённого:
          </p>
          <ul className="rules__list">
            <li>
              есть хоть одна лживая карта → к револьверу идёт{" "}
              <b>обвинённый</b>;
            </li>
            <li>
              все карты честны → к револьверу идёт <b>обвинитель</b>.
            </li>
          </ul>
        </section>

        <section className="rules__section">
          <h3>Риск выстрела</h3>
          <div className="rules__bullets">
            {ODDS.map((o) => (
              <span key={o.n} className={o.n >= 4 ? "is-hot" : ""}>
                Спуск №{o.n} — {o.odds}
              </span>
            ))}
          </div>
          <p>
            После каждой осечки пустых гнёзд становится меньше. На {CHAMBERS}-м
            спуске выстрел неизбежен.
          </p>
        </section>

        <section className="rules__section">
          <h3>После выстрела</h3>
          <p>
            Погибшие выбывают. Если живых больше одного — карты сдаются заново
            и выбирается новый номинал стола. Новый раунд начинает{" "}
            <b>пойманный лжец</b>, а при ошибочном обвинении —{" "}
            <b>сам обвинитель</b>. Если он погиб, начинает следующий живой.
          </p>
        </section>

        {variant === "devil" && (
          <section className="rules__section rules__section--devil">
            <h3>Вариант «Дьявол»</h3>
            <p>
              По одной карте каждого номинала помечена. Если её номинал стал
              номиналом стола <b>и за столом ещё трое или больше</b>, эта карта
              становится <b>Дьяволом</b>.
            </p>
            <ul className="rules__list">
              <li>
                Дьявола можно выложить <b>только одного</b>, без других карт.
              </li>
              <li>
                Дьявол считается честной картой. Обвинитель идёт к револьверу,
                а вместе с ним курок спускают <b>все, у кого остались карты</b>, —
                кроме обвинённого.
              </li>
            </ul>
          </section>
        )}

        <p className="rules__hint">
          Пример: Свин положил одну карту при номинале «Дама». Пёс потребовал
          вскрытия, но карта оказалась честной. Поэтому Пёс спускает курок:
          сначала риск выстрела равен 1 из 6, после осечки — уже 1 из 5.
        </p>

        <p className="rules__keys">
          Горячие клавиши: <b>1–5</b> выбрать карту · <b>Enter</b> положить ·{" "}
          <b>L</b> обвинить · <b>Esc</b> пауза
        </p>

        <button
          ref={closeBtn}
          type="button"
          className="btn btn--primary"
          onClick={onClose}
        >
          Понятно
        </button>
      </div>
    </div>
  );
}
