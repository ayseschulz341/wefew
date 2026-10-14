import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import type { PlayerState } from "../game/types";
import { CHAMBERS } from "../game/types";
import { CHARACTER_BY_ID } from "../game/characters";
import { Avatar } from "./Avatar";

interface Props {
  winnerName: string | null;
  humanWon: boolean;
  players: PlayerState[];
  playerName: string;
  rounds: number;
  onRestart?: () => void;
  onExit: () => void;
}

export function ResultScreen({
  winnerName,
  humanWon,
  players,
  playerName,
  rounds,
  onRestart,
  onExit,
}: Props) {
  const first = useRef<HTMLButtonElement>(null);
  const winner = winnerName
    ? players.find((player) => player.name === winnerName) ?? null
    : null;
  const winnerCharacter = winner?.characterId
    ? CHARACTER_BY_ID.get(winner.characterId) ?? null
    : null;
  useEffect(() => {
    first.current?.focus();
  }, []);

  return (
    <motion.div
      className={`overlay overlay--result ${humanWon ? "is-win" : "is-lose"}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="result-winner"
      aria-describedby="result-summary"
    >
      <motion.div
        className="result"
        initial={{ scale: 0.9, y: 30 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ delay: 0.2, type: "spring", stiffness: 200, damping: 20 }}
      >
        <section className="result__winnercard" aria-label="Победитель партии">
          <motion.div
            className="result__winnerportrait"
            initial={{ opacity: 0, scale: 0.45, rotate: -12 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ delay: 0.34, type: "spring", stiffness: 260, damping: 18 }}
          >
            {winnerCharacter ? (
              <Avatar characterId={winnerCharacter.id} size={86} />
            ) : (
              <span aria-hidden="true">☠</span>
            )}
          </motion.div>
          <div className="result__winnercopy">
            <p className="result__eyebrow">
              {winnerName ? "Победитель партии" : "Победителей нет"}
            </p>
            <h2 id="result-winner" className="result__winnername">
              {winnerName ?? "За столом никого не осталось"}
            </h2>
            <p className="result__verdict">
              {winnerName
                ? humanWon
                  ? "Вы пережили последнюю ночь в баре"
                  : `${winnerCharacter?.title ?? "последний выживший"} забирает победу`
                : "Бармен гасит свет"}
            </p>
          </div>
        </section>

        <p id="result-summary" className="result__sub">
          {humanWon
            ? "Остальные места за столом опустели."
            : winnerName === null
              ? "За столом не осталось живых. Бармен гасит свет."
              : `Ваше место пустует до утра. Победа уходит к ${winnerName}.`}
          {" "}Раундов сыграно: {rounds}.
        </p>

        <details className="result__details">
          <summary>Статистика партии</summary>
          <div className="result__tablewrap">
            <table className="result__stats">
              <thead>
                <tr>
                <th scope="col">Игрок</th>
                <th scope="col">Статус</th>
                <th scope="col">Блефов</th>
                <th scope="col">Пойман</th>
                <th scope="col">Верных вскрытий</th>
                <th scope="col">Ошибочных</th>
                <th scope="col">Осечек</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p, i) => (
                  <motion.tr
                  key={p.seat}
                  className={p.isHuman ? "is-me" : ""}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.35 + i * 0.09, duration: 0.35 }}
                >
                  <td>{p.name}</td>
                  <td>
                    {p.alive
                      ? `жив · гнёзд ${Math.max(1, p.chambers.length)} из ${CHAMBERS}`
                      : "мёртв"}
                  </td>
                  <td>{p.bluffsMade}</td>
                  <td>{p.bluffsCaught}</td>
                  <td>{p.correctCalls}</td>
                  <td>{p.falseCalls}</td>
                  <td>{p.pullsSurvived}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>

        <div className="result__actions">
          {onRestart && (
            <button
              ref={first}
              type="button"
              className="btn btn--primary btn--big"
              onClick={onRestart}
            >
              Сыграть ещё раз, {playerName}
            </button>
          )}
          <button ref={onRestart ? undefined : first} type="button" className="btn" onClick={onExit}>
            В меню
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
