import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { GameApi, GameSetup } from "../hooks/useGameLoop";
import { cardIsDevil, rankName, tableName } from "../game/engine";
import { VARIANT_LABELS } from "../game/types";
import { CHAMBERS } from "../game/types";
import { sfx } from "../game/sounds";
import { PlayerSeat } from "./PlayerSeat";
import { PlayingCard, CardFace } from "./PlayingCard";
import { HandView } from "./HandView";
import { LogPanel } from "./LogPanel";
import { RevealOverlay } from "./RevealOverlay";
import { RevolverModal } from "./RevolverModal";
import { ResultScreen } from "./ResultScreen";
import { RulesModal } from "./RulesModal";
import { PauseModal } from "./PauseModal";

interface Props {
  api: GameApi;
  setup: GameSetup;
  muted: boolean;
  onToggleMute: () => void;
  onExit: () => void;
  onRestart?: () => void;
  online?: boolean;
  paused: boolean;
  onPause: (paused: boolean) => void;
}

export function GameTable({
  api,
  setup,
  muted,
  onToggleMute,
  onExit,
  onRestart,
  online = false,
  paused,
  onPause,
}: Props) {
  const {
    state,
    isMyTurn,
    canChallenge,
    mustChallenge,
    secondsLeft,
    taunts,
    playCard,
    challenge,
  } = api;
  const phase = state.phase;
  const me = state.players[0];
  const tableRank = state.tableRank;

  const [logOpen, setLogOpen] = useState(false);
  const [menu, setMenu] = useState<null | "rules" | "pause">(null);

  // Любое модальное окно ставит партию на паузу.
  useEffect(() => {
    onPause(menu !== null);
  }, [menu, onPause]);

  useEffect(() => {
    if (phase.kind === "gameover") {
      sfx.play(phase.winner === 0 ? "win" : "lose");
    }
  }, [phase]);

  // Esc открывает/закрывает паузу.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (phase.kind === "gameover") return;
      setMenu((m) => (m === null ? "pause" : null));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase.kind]);

  const claimed = state.pile.reduce((n, e) => n + e.cards.length, 0);
  const lastEntry = state.pile[state.pile.length - 1];

  // Свой барабан дублируется в топбар: на телефоне своё место за столом
  // скрыто, а счётчик патронов должен оставаться перед глазами.
  const myPullsMade = CHAMBERS - me.chambers.length;
  const myChambersLeft = Math.max(1, me.chambers.length);
  const drumOdds = !me.alive
    ? "Вы выбыли из игры"
    : myChambersLeft > 1
      ? `Следующий спуск — 1 из ${myChambersLeft}`
      : "Следующий спуск — выстрел неизбежен";

  const statusText = (() => {
    if (paused) return "Пауза";
    if (phase.kind === "reveal") return "Вскрытие выкладки…";
    if (phase.kind === "roulette") {
      const shooter = state.players[phase.shooter];
      const series = phase.total > 1 ? ` (${phase.index} из ${phase.total})` : "";
      return `${shooter.name} смотрит в дуло…${series}`;
    }
    if (phase.kind === "gameover") return "Ночь закончена";
    if (!me.alive) return "Вы выбыли. Стол доигрывает без вас.";
    if (isMyTurn) {
      if (mustChallenge) return "Вы единственный с картами — обязаны вскрыть!";
      return canChallenge
        ? "Ваш ход: выложите 1–3 карты или обвините предыдущего игрока"
        : "Ваш ход: выложите 1–3 карты";
    }
    const p = state.players[state.currentSeat];
    return p ? `${p.name} обдумывает ход…` : "";
  })();

  const reveal = phase.kind === "reveal" ? phase : null;
  const roulette = phase.kind === "roulette" ? phase : null;

  return (
    <div className="game">
      <header className="topbar">
        <div className="topbar__left">
          <span className="topbar__brand">БАР ЛЖЕЦОВ</span>
          <span className="topbar__round">Раунд {state.roundNumber}</span>
          <span className="topbar__rank">
            <b>{tableName(tableRank)}</b>
          </span>
          {state.devilActive && (
            <span className="topbar__devil" title="В раунде есть Дьявол">
              ☠ Дьявол
            </span>
          )}
          {setup.variant !== "classic" && (
            <span className="topbar__variant">{VARIANT_LABELS[setup.variant]}</span>
          )}
        </div>
        <div className="topbar__center">
          <div
            className={[
              "topbar__drum",
              !me.alive ? "is-dead" : "",
              me.alive && myChambersLeft <= 1 ? "is-doomed" : "",
            ].join(" ")}
            title={drumOdds}
            role="img"
            aria-label={`Ваш барабан: ${drumOdds}`}
          >
            <svg className="topbar__drum-icon" viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="10" cy="10" r="8.6" className="topbar__drum-body" />
              <circle cx="10" cy="10" r="1.9" className="topbar__drum-pin" />
              <circle cx="14.5" cy="7.4" r="1.55" className="topbar__drum-chamber" />
              <circle cx="10" cy="4.8" r="1.55" className="topbar__drum-chamber" />
              <circle cx="5.5" cy="7.4" r="1.55" className="topbar__drum-chamber" />
              <circle cx="5.5" cy="12.6" r="1.55" className="topbar__drum-chamber" />
              <circle cx="10" cy="15.2" r="1.55" className="topbar__drum-chamber" />
              <circle cx="14.5" cy="12.6" r="1.55" className="topbar__drum-chamber" />
            </svg>
            {Array.from({ length: CHAMBERS }).map((_, i) => (
              <span
                key={i}
                className={`topbar__bullet ${i < myPullsMade ? "is-spent" : ""}`}
              />
            ))}
          </div>
        </div>
        <div className="topbar__right">
          <button
            type="button"
            className="btn btn--ghost sound-btn"
            aria-pressed={muted}
            aria-label={muted ? "Включить звук" : "Выключить звук"}
            title={muted ? "Включить звук" : "Выключить звук"}
            onClick={onToggleMute}
          >
            <span aria-hidden="true">{muted ? "🔇" : "🔊"}</span>
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setMenu("rules")}
            title="Правила (пауза)"
            aria-label="Правила"
          >
            ?
          </button>
          <button
            type="button"
            className="btn btn--ghost log-toggle"
            aria-expanded={logOpen}
            onClick={() => setLogOpen((v) => !v)}
          >
            {logOpen ? "Скрыть журнал" : "Журнал"}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setMenu("pause")}
          >
            Пауза
          </button>
        </div>
      </header>

      <div className="game__main">
        <section className="scene" aria-label="Игровой стол">
          <div className="scene__seats scene__seats--top">
            {[1, 2, 3]
              .filter((seat) => state.players[seat])
              .map((seat) => (
                <PlayerSeat
                  key={seat}
                  player={state.players[seat]}
                  active={phase.kind === "idle" && state.currentSeat === seat}
                  isStarter={state.roundStarter === seat}
                  lastPlayCount={
                    lastEntry?.playerId === seat ? lastEntry.cards.length : 0
                  }
                  taunt={taunts.find((t) => t.seat === seat)?.text ?? null}
                />
              ))}
          </div>

          <div className="felt" aria-hidden="true" />

          <div className="center">
            <div className="center__pile" aria-label="Карты на столе">
              <p className="center__label">
                Сыгранные карты{claimed > 0 ? ` · ${claimed}` : ""}
              </p>
              <div className="center__pile-stack">
                {state.pile.length === 0 ? (
                  <p className="center__empty">Первая выкладка появится здесь</p>
                ) : (
                  <AnimatePresence>
                    {state.pile.map((entry, i) => (
                      <motion.div
                        key={entry.cards.map((c) => c.id).join("-") + "-" + i}
                        className={`center__pile-card ${entry.cards.length > 1 ? "is-multi" : ""} ${
                          i === state.pile.length - 1 ? "is-top" : ""
                        }`}
                        initial={{ y: -82, opacity: 0, scale: 0.72, rotate: entryRotation(i) + 14 }}
                        animate={{
                          y: [0, 7, 0],
                          opacity: 1,
                          scale: [0.9, 1.055, 1],
                          rotate: [entryRotation(i) + 7, entryRotation(i) - 2, entryRotation(i)],
                        }}
                        exit={{ y: 90, opacity: 0, transition: { duration: 0.35 } }}
                        transition={{ duration: 0.48, times: [0, 0.68, 1], ease: [0.16, 1, 0.3, 1] }}
                      >
                        <PlayingCard size="md" />
                        {entry.cards.length > 1 && (
                          <motion.span
                            className="pile-count"
                            initial={{ opacity: 0, scale: 0, rotate: -22 }}
                            animate={{ opacity: 1, scale: [0, 1.22, 1], rotate: 0 }}
                            transition={{ delay: 0.25, duration: 0.38 }}
                          >
                            ×{entry.cards.length}
                          </motion.span>
                        )}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                )}
              </div>
              {lastEntry && (
                <p className="center__last">
                  {state.players[lastEntry.playerId].name}: {lastEntry.cards.length}{" "}
                  {lastEntry.cards.length === 1 ? "карта" : "карты"} ·{" "}
                  заявлены <b>{rankName(tableRank).toLowerCase()}</b>
                </p>
              )}
            </div>

            <div className="center__tablecard">
              <p className="center__label">Номинал раунда</p>
              <motion.div
                className="playing-card playing-card--sm center__tablecard-inner"
                key={`${state.tableRank}-${state.roundNumber}`}
                initial={{ rotateY: -90, scale: 0.7, opacity: 0 }}
                animate={{ rotateY: 0, scale: 1, opacity: 1 }}
                transition={{ duration: 0.55, ease: [0.2, 0.9, 0.25, 1] }}
                style={{ transformStyle: "preserve-3d" }}
              >
                <CardFace rank={state.tableRank} size="sm" />
              </motion.div>
            </div>

            <AnimatePresence mode="wait">
              <motion.p
                key={statusText}
                className={`status ${isMyTurn ? "status--me" : ""}`}
                role="status"
                aria-live="polite"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
              >
                {statusText}
              </motion.p>
            </AnimatePresence>
          </div>

          <div className={`scene__me ${!me.alive ? "is-dead" : ""}`}>
            <PlayerSeat
              player={me}
              active={isMyTurn}
              isStarter={state.roundStarter === 0}
              lastPlayCount={
                lastEntry?.playerId === 0 ? lastEntry.cards.length : 0
              }
              taunt={taunts.find((t) => t.seat === 0)?.text ?? null}
            />
          </div>
        </section>

        <LogPanel state={state} open={logOpen} />
      </div>

      <HandView
        hand={me.hand}
        tableRank={tableRank}
        isDevil={(card) => cardIsDevil(state, card)}
        canAct={isMyTurn}
        canChallenge={canChallenge}
        mustChallenge={mustChallenge}
        secondsLeft={secondsLeft}
        onPlay={playCard}
        onChallenge={challenge}
      />

      <RevealOverlay
        open={!!reveal}
        cards={reveal?.cards ?? []}
        wasLie={reveal?.wasLie ?? false}
        devil={reveal?.devil ?? false}
        tableRank={tableRank}
        accusedName={reveal ? state.players[reveal.accused].name : ""}
        challengerName={reveal ? state.players[reveal.challenger].name : ""}
        shooterNames={
          reveal ? reveal.shooters.map((s) => state.players[s].name) : []
        }
      />

      <RevolverModal
        open={!!roulette}
        paused={paused}
        shooterName={roulette ? state.players[roulette.shooter].name : ""}
        fired={roulette?.fired ?? false}
        outcomePending={roulette?.resultPending ?? false}
        pullNumber={roulette?.pullNumber ?? 1}
        remainingChambers={roulette?.remainingChambers ?? 6}
        index={roulette?.index ?? 1}
        total={roulette?.total ?? 1}
      />

      {phase.kind === "gameover" && (
        <ResultScreen
          winnerName={
            phase.winner !== null ? state.players[phase.winner].name : null
          }
          humanWon={phase.winner === 0}
          players={state.players}
          playerName={setup.playerName}
          rounds={state.roundNumber}
          onRestart={onRestart}
          onExit={onExit}
        />
      )}

      {menu === "rules" && (
        <RulesModal variant={setup.variant} onClose={() => setMenu(null)} />
      )}
      {menu === "pause" && (
        <PauseModal
          onResume={() => setMenu(null)}
          onRules={() => setMenu("rules")}
          onRestart={online || !onRestart ? undefined : () => {
            setMenu(null);
            onRestart();
          }}
          onExit={onExit}
          online={online}
        />
      )}
    </div>
  );
}

function entryRotation(i: number): number {
  const angles = [-7, 5, -3, 9, -11, 3, 7, -5];
  return angles[i % angles.length];
}
