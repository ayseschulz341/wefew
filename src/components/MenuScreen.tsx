import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { CharacterId, Difficulty, GameVariant } from "../game/types";
import { DIFFICULTY_LABELS, VARIANT_LABELS } from "../game/types";
import { CHARACTERS } from "../game/characters";
import type { Settings, Stats } from "../game/storage";
import { Avatar } from "./Avatar";
import { extractRoomCode } from "../network/roomLinks";

interface Props {
  settings: Settings;
  stats: Stats;
  onChange: (s: Settings) => void;
  onStart: (s: Settings) => void;
  onCreateRoom: (s: Settings) => void;
  onJoinRoom: (roomCode: string, s: Settings) => void;
  onlineBusy?: boolean;
  onlineError?: string | null;
  onShowRules: () => void;
  onResetStats: () => void;
}

const DIFFICULTY_HINTS: Record<Difficulty, string> = {
  easy: "Больше права на ошибку",
  normal: "Честный вызов",
  hard: "Боты читают игру",
};

const VARIANT_HINTS: Record<GameVariant, string> = {
  classic: "Знакомые правила и чистый блеф",
  devil: "Дьявольские карты меняют раунд",
};

export function MenuScreen({
  settings,
  stats,
  onChange,
  onStart,
  onCreateRoom,
  onJoinRoom,
  onlineBusy = false,
  onlineError = null,
  onShowRules,
  onResetStats,
}: Props) {
  const [showStats, setShowStats] = useState(false);
  const [roomCode, setRoomCode] = useState("");
  const statsDialogRef = useRef<HTMLElement>(null);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    onChange({ ...settings, [key]: value });

  const selectedCharacter =
    CHARACTERS.find((character) => character.id === settings.characterId) ?? CHARACTERS[0];
  const winRate = stats.games > 0 ? Math.round((stats.wins / stats.games) * 100) : 0;

  useEffect(() => {
    if (!showStats) return;

    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const dialog = statsDialogRef.current;
    const focusable = () => Array.from(
      dialog?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex='-1'])") ?? [],
    );
    focusable()[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setShowStats(false);
        return;
      }
      if (event.key !== "Tab") return;

      const controls = focusable();
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [showStats]);

  return (
    <main className="menu">
      <div className="menu__glow" aria-hidden="true" />
      <div className="menu__grain" aria-hidden="true" />

      <motion.div
        className="menu__inner"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      >
        <aside className="menu__hero">
          <div className="menu__brand">
            <div className="menu__brandline">
              <span className="menu__eyebrow">Liar&apos;s Deck</span>
              <span className="menu__edition">01 / подпольный клуб</span>
            </div>
            <h1 className="menu__title">
              <span>Бар</span>
              <strong>лжецов</strong>
            </h1>
            <p className="menu__subtitle">
              Здесь верят не словам, а выдержке. Блефуйте, вскрывайте ложь и не
              теряйте самообладание у револьвера.
            </p>
          </div>

          <div className="menu__portrait" aria-label={`Выбран персонаж: ${selectedCharacter.name}`}>
            <div className="menu__portrait-halo" aria-hidden="true" />
            <Avatar characterId={selectedCharacter.id} size={220} />
            <div className="menu__portrait-copy">
              <span>Ваш персонаж</span>
              <b>{selectedCharacter.name}</b>
              <small>{selectedCharacter.title}</small>
            </div>
          </div>

          <div className="menu__hero-footer">
            <div className="menu__ruleline" aria-label="Кратко об игре">
              <span><b>20</b> карт</span>
              <span><b>6</b> камор</span>
              <span><b>1</b> шанс</span>
            </div>
            <p>За ложь отвечают у револьвера.</p>
          </div>
        </aside>

        <section className="menu__panel" aria-labelledby="setup-title">
          <header className="menu__panel-head">
            <div>
              <span className="menu__step">Новая партия</span>
              <h2 id="setup-title">Займите место за столом</h2>
            </div>
            <div className="menu__quick-actions">
              <button type="button" className="menu__text-action" onClick={onShowRules}>
                Правила
              </button>
              <button
                type="button"
                className="menu__text-action"
                aria-expanded={showStats}
                onClick={() => setShowStats((value) => !value)}
              >
                Статистика
              </button>
            </div>
          </header>

          <div className="menu__play-modes" role="radiogroup" aria-label="Формат партии">
            <label className={`menu__mode-card menu__check--mode ${settings.playWithBots ? "is-active" : ""}`}>
              <input
                type="radio"
                name="play-mode"
                checked={settings.playWithBots}
                onPointerDown={(event) => event.currentTarget.focus({ preventScroll: true })}
                onChange={() => set("playWithBots", true)}
              />
              <span className="menu__mode-icon" aria-hidden="true">◆</span>
              <span>
                <b>С ботами</b>
                <small>Начать сразу на этом устройстве</small>
              </span>
              <i aria-hidden="true" />
            </label>
            <label className={`menu__mode-card ${!settings.playWithBots ? "is-active" : ""}`}>
              <input
                type="radio"
                name="play-mode"
                checked={!settings.playWithBots}
                onPointerDown={(event) => event.currentTarget.focus({ preventScroll: true })}
                onChange={() => set("playWithBots", false)}
              />
              <span className="menu__mode-icon" aria-hidden="true">◎</span>
              <span>
                <b>По сети</b>
                <small>Создать комнату или войти по коду</small>
              </span>
              <i aria-hidden="true" />
            </label>
          </div>

          <section className="menu__section menu__section--characters" aria-labelledby="char-label">
            <div className="menu__section-head">
              <h3 id="char-label">Выберите персонажа</h3>
              <span>{selectedCharacter.name} · {selectedCharacter.title}</span>
            </div>
            <div className="menu__chars" role="radiogroup" aria-labelledby="char-label">
              {CHARACTERS.map((character) => (
                <button
                  key={character.id}
                  type="button"
                  role="radio"
                  aria-checked={settings.characterId === character.id}
                  className={`menu__char ${settings.characterId === character.id ? "is-active" : ""}`}
                  onClick={() => set("characterId", character.id as CharacterId)}
                  title={character.title}
                >
                  <Avatar characterId={character.id} size={64} />
                  <span className="menu__char-name">{character.name}</span>
                  <span className="menu__char-check" aria-hidden="true">✓</span>
                </button>
              ))}
            </div>
          </section>

          <div className={`menu__row ${settings.playWithBots ? "menu__row--local" : "menu__row--online"}`}>
            <label className="menu__field menu__field--name">
              <span>Ваше имя</span>
              <input
                value={settings.playerName}
                maxLength={16}
                placeholder="Как к вам обращаться?"
                onChange={(event) => set("playerName", event.target.value)}
              />
            </label>

            {settings.playWithBots && (
              <div className="menu__field menu__field--difficulty">
                <span id="diff-label">Сложность</span>
                <div className="menu__diff" role="radiogroup" aria-labelledby="diff-label">
                  {(Object.keys(DIFFICULTY_LABELS) as Difficulty[]).map((difficulty) => (
                    <button
                      key={difficulty}
                      type="button"
                      role="radio"
                      aria-checked={settings.difficulty === difficulty}
                      className={settings.difficulty === difficulty ? "is-active" : ""}
                      onClick={() => set("difficulty", difficulty)}
                    >
                      {DIFFICULTY_LABELS[difficulty]}
                      <small>{DIFFICULTY_HINTS[difficulty]}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {settings.playWithBots && (
              <div className="menu__field menu__field--bots">
                <span id="bots-label">Соперники</span>
                <div className="menu__diff menu__bots" role="radiogroup" aria-labelledby="bots-label">
                  {[1, 2, 3].map((count) => (
                    <button
                      key={count}
                      type="button"
                      role="radio"
                      aria-checked={settings.botCount === count}
                      className={settings.botCount === count ? "is-active" : ""}
                      onClick={() => set("botCount", count)}
                    >
                      <b>{count}</b>
                      <small>{count === 1 ? "дуэль" : count === 2 ? "втроём" : "полный стол"}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="menu__field menu__field--variant">
              <span id="variant-label">Правила стола</span>
              <div className="menu__diff menu__variant" role="radiogroup" aria-labelledby="variant-label">
                {(Object.keys(VARIANT_LABELS) as GameVariant[]).map((variant) => (
                  <button
                    key={variant}
                    type="button"
                    role="radio"
                    aria-checked={settings.variant === variant}
                    className={settings.variant === variant ? "is-active" : ""}
                    onClick={() => set("variant", variant)}
                  >
                    {VARIANT_LABELS[variant]}
                    <small>{VARIANT_HINTS[variant]}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="menu__field menu__timer-field">
              <span id="timer-label">Время на ход</span>
              <div className="menu__diff menu__timer" role="radiogroup" aria-labelledby="timer-label">
                {([0, 15, 30, 45, 60] as const).map((seconds) => {
                  const active = seconds === 0
                    ? !settings.timerEnabled
                    : settings.timerEnabled && settings.turnSeconds === seconds;
                  return (
                    <button
                      key={seconds}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={active ? "is-active" : ""}
                      onClick={() => onChange({
                        ...settings,
                        timerEnabled: seconds !== 0,
                        turnSeconds: seconds === 0 ? settings.turnSeconds : seconds,
                      })}
                    >
                      {seconds === 0 ? "∞" : `${seconds} с`}
                      {seconds === 0 && <small>без лимита</small>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {!settings.playWithBots && (
            <section className="menu__join" aria-labelledby="join-title">
              <div>
                <span className="menu__join-kicker">Уже ждут за столом?</span>
                <b id="join-title">Войти по коду комнаты</b>
              </div>
              <input
                value={roomCode}
                inputMode="text"
                autoComplete="off"
                placeholder="ABC234"
                aria-label="Код комнаты"
                onChange={(event) => setRoomCode(extractRoomCode(event.target.value))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && roomCode.length === 6 && !onlineBusy) {
                    onJoinRoom(roomCode, settings);
                  }
                }}
              />
              <button
                type="button"
                className="btn menu__join-button"
                disabled={roomCode.length !== 6 || onlineBusy}
                onClick={() => onJoinRoom(roomCode, settings)}
              >
                Войти
              </button>
            </section>
          )}

          {onlineError && <p className="menu__online-error" role="alert">{onlineError}</p>}

          <footer className="menu__actions">
            <div className="menu__selection-summary">
              <span>Вы выбрали</span>
              <b>
                {settings.playWithBots ? `${settings.botCount} ${settings.botCount === 1 ? "соперника" : "соперников"}` : "игру по сети"}
                {" · "}{VARIANT_LABELS[settings.variant]}
                {settings.timerEnabled ? ` · ${settings.turnSeconds} секунд` : " · без таймера"}
              </b>
            </div>
            {settings.playWithBots ? (
              <button
                type="button"
                className="btn btn--primary btn--big menu__primary-action"
                onClick={() => onStart(settings)}
              >
                <span>Играть с ботами</span>
                <i aria-hidden="true">→</i>
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--primary btn--big menu__primary-action"
                disabled={onlineBusy}
                onClick={() => onCreateRoom(settings)}
              >
                <span>{onlineBusy ? "Создаём комнату…" : "Создать комнату"}</span>
                {!onlineBusy && <i aria-hidden="true">→</i>}
              </button>
            )}
          </footer>

          <AnimatePresence initial={false}>
            {showStats && (
              <motion.section
                ref={statsDialogRef}
                className="menu__stats"
                initial={{ opacity: 0, y: 8, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.985 }}
                transition={{ duration: 0.2 }}
                role="dialog"
                aria-modal="true"
                aria-labelledby="stats-title"
              >
                <header>
                  <div>
                    <span>Ваши результаты</span>
                    <h3 id="stats-title">Статистика</h3>
                  </div>
                  <button type="button" aria-label="Закрыть статистику" onClick={() => setShowStats(false)}>×</button>
                </header>
                <div className="menu__stats-grid">
                  <Stat label="Партий" value={stats.games} />
                  <Stat label="Побед" value={stats.wins} />
                  <Stat label="Винрейт" value={`${winRate}%`} />
                  <Stat label="Серия" value={stats.streak} />
                  <Stat label="Лучшая серия" value={stats.bestStreak} />
                  <Stat label="Блефов" value={stats.bluffsMade} />
                  <Stat label="Попались" value={stats.bluffsCaught} />
                  <Stat label="Верных вскрытий" value={stats.correctCalls} />
                  <Stat label="Ошибочных" value={stats.falseCalls} />
                  <Stat label="Осечек пережито" value={stats.pullsSurvived} />
                </div>
                {stats.games > 0 && (
                  <button type="button" className="btn btn--ghost" onClick={onResetStats}>
                    Сбросить статистику
                  </button>
                )}
              </motion.section>
            )}
          </AnimatePresence>
        </section>
      </motion.div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="menu__stat">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}
