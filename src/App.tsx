import { useCallback, useEffect, useRef, useState } from "react";
import type { GameState, PlayerState } from "./game/types";
import { useGameLoop, type GameSetup } from "./hooks/useGameLoop";
import { sfx } from "./game/sounds";
import {
  applyOutcome,
  loadSettings,
  loadStats,
  resetStats as clearStats,
  saveSettings,
  saveStats,
  type Settings,
  type Stats,
} from "./game/storage";
import { MenuScreen } from "./components/MenuScreen";
import { GameTable } from "./components/GameTable";
import { RulesModal } from "./components/RulesModal";
import { OrientationGate } from "./components/OrientationGate";
import { RevolverModal } from "./components/RevolverModal";
import { ResultScreen } from "./components/ResultScreen";
import { CardFace } from "./components/PlayingCard";
import { AnimatePresence } from "framer-motion";
import { OnlineLobbyScreen } from "./components/OnlineLobbyScreen";
import { createOnlineRoom, useOnlineRoom } from "./hooks/useOnlineRoom";
import { createJoinUrl, roomCodeFromLocation } from "./network/roomLinks";

type Screen = "menu" | "game" | "online";

interface OnlineIntent {
  roomCode: string;
  wantsHost: boolean;
}

const QA_RESULT_PLAYERS: PlayerState[] = [
  {
    seat: 0,
    name: "Вы",
    characterId: "foxy",
    isHuman: true,
    hand: [],
    alive: false,
    chambers: [],
    bluffsMade: 3,
    bluffsCaught: 2,
    correctCalls: 2,
    falseCalls: 1,
    pullsSurvived: 2,
  },
  {
    seat: 1,
    name: "Cupcake",
    characterId: "cupcake",
    isHuman: false,
    hand: [],
    alive: true,
    chambers: [false, true],
    bluffsMade: 4,
    bluffsCaught: 1,
    correctCalls: 3,
    falseCalls: 0,
    pullsSurvived: 4,
  },
  {
    seat: 2,
    name: "Bristle",
    characterId: "bristle",
    isHuman: false,
    hand: [],
    alive: false,
    chambers: [],
    bluffsMade: 2,
    bluffsCaught: 3,
    correctCalls: 1,
    falseCalls: 2,
    pullsSurvived: 1,
  },
  {
    seat: 3,
    name: "Gerk",
    characterId: "gerk",
    isHuman: false,
    hand: [],
    alive: false,
    chambers: [],
    bluffsMade: 2,
    bluffsCaught: 1,
    correctCalls: 2,
    falseCalls: 1,
    pullsSurvived: 3,
  },
];

export default function App() {
  const invitedRoom = roomCodeFromLocation();
  const [screen, setScreen] = useState<Screen>(invitedRoom ? "online" : "menu");
  const [showRules, setShowRules] = useState(false);
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [stats, setStats] = useState<Stats>(() => loadStats());
  const [gameKey, setGameKey] = useState(0);
  const [onlineIntent, setOnlineIntent] = useState<OnlineIntent | null>(() =>
    invitedRoom ? { roomCode: invitedRoom, wantsHost: false } : null,
  );
  const [onlineBusy, setOnlineBusy] = useState(false);
  const [onlineError, setOnlineError] = useState<string | null>(null);

  // Настройки переживают перезагрузку.
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    sfx.setMuted(settings.muted);
  }, [settings.muted]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [screen, gameKey]);

  const setup: GameSetup = {
    playerName: settings.playerName,
    characterId: settings.characterId,
    difficulty: settings.difficulty,
    botCount: settings.botCount,
    variant: settings.variant,
    timerEnabled: settings.timerEnabled,
    turnSeconds: settings.turnSeconds,
  };

  const start = (next: Settings) => {
    sfx.unlock();
    sfx.play("uiClick");
    setSettings(next);
    setGameKey((k) => k + 1);
    setScreen("game");
  };

  const restart = () => {
    sfx.play("uiClick");
    setGameKey((k) => k + 1);
  };

  const openOnlineRoom = (roomCode: string, wantsHost: boolean, next: Settings) => {
    sfx.unlock();
    sfx.play("uiClick");
    setSettings({ ...next, playWithBots: false });
    setOnlineError(null);
    setOnlineIntent({ roomCode, wantsHost });
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomCode);
    window.history.replaceState({}, "", url);
    setScreen("online");
  };

  const createRoom = async (next: Settings) => {
    setOnlineBusy(true);
    setOnlineError(null);
    try {
      const roomCode = await createOnlineRoom({
        variant: next.variant,
        turnSeconds: next.timerEnabled ? next.turnSeconds : 0,
      });
      openOnlineRoom(roomCode, true, next);
    } catch (error) {
      setOnlineError(error instanceof Error ? error.message : "Не удалось создать комнату");
    } finally {
      setOnlineBusy(false);
    }
  };

  const joinRoom = (roomCode: string, next: Settings) =>
    openOnlineRoom(roomCode, false, next);

  const exitOnline = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("room");
    window.history.replaceState({}, "", url);
    setOnlineIntent(null);
    setScreen("menu");
  };

  const recordOutcome = useCallback((state: GameState) => {
    if (state.phase.kind !== "gameover") return;
    const me = state.players[0];
    const next = applyOutcome(loadStats(), {
      won: state.phase.winner === 0,
      bluffsMade: me.bluffsMade,
      bluffsCaught: me.bluffsCaught,
      correctCalls: me.correctCalls,
      falseCalls: me.falseCalls,
      pullsSurvived: me.pullsSurvived,
    });
    saveStats(next);
    setStats(next);
  }, []);

  const toggleMute = () => {
    sfx.unlock();
    const muted = !settings.muted;
    setSettings((s) => ({ ...s, muted }));
    if (!muted) sfx.play("uiClick");
  };

  // Детерминированная сцена доступна только на локальном сервере визуальной QA.
  const isLocalQa =
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "localhost";
  const qaScene = isLocalQa
    ? new URLSearchParams(window.location.search).get("qa")
    : null;
  const qaStageParam = isLocalQa
    ? new URLSearchParams(window.location.search).get("stage")
    : null;
  const qaPullParam = isLocalQa
    ? Number(new URLSearchParams(window.location.search).get("pull"))
    : 1;
  const qaPull = Number.isFinite(qaPullParam)
    ? Math.max(1, Math.min(6, Math.round(qaPullParam)))
    : 1;
  const qaStage =
    qaStageParam === "load" ||
    qaStageParam === "close" ||
    qaStageParam === "spin" ||
    qaStageParam === "cock" ||
    qaStageParam === "fire" ||
    qaStageParam === "result"
      ? qaStageParam
      : undefined;
  if (qaScene === "roulette-fired" || qaScene === "roulette-dry") {
    return (
      <div className="app app--visual-qa">
        <RevolverModal
          open
          shooterName="Проверка механики"
          fired={qaScene === "roulette-fired"}
          pullNumber={qaPull}
          remainingChambers={7 - qaPull}
          index={1}
          total={1}
          stageOverride={qaStage}
        />
      </div>
    );
  }
  if (qaScene === "cards") {
    return (
      <div className="app app--visual-qa">
        <div className="qa-card-board" aria-label="Проверка карт">
          <CardFace rank="JKR" size="lg" />
          <CardFace rank="JKR" size="md" />
          <CardFace rank="JKR" size="sm" />
          <CardFace rank="K" size="lg" devil />
          <CardFace rank="A" size="lg" />
        </div>
      </div>
    );
  }
  if (qaScene === "result") {
    return (
      <div className="app app--visual-qa">
        <ResultScreen
          winnerName="Cupcake"
          humanWon={false}
          players={QA_RESULT_PLAYERS}
          playerName="Вы"
          rounds={7}
          onRestart={() => undefined}
          onExit={() => undefined}
        />
      </div>
    );
  }

  return (
    <div className="app">
      {/* Плавающая кнопка звука — только в меню; в игре звук в топбаре */}
      {screen === "menu" && (
        <button
          type="button"
          className="sound-toggle"
          aria-pressed={settings.muted}
          title={settings.muted ? "Включить звук" : "Выключить звук"}
          onClick={toggleMute}
        >
          <span aria-hidden="true">{settings.muted ? "🔇" : "🔊"}</span>
          <span className="sr-only">
            {settings.muted ? "Включить звук" : "Выключить звук"}
          </span>
        </button>
      )}

      {screen === "menu" ? (
        <MenuScreen
          settings={settings}
          stats={stats}
          onChange={setSettings}
          onStart={start}
          onCreateRoom={createRoom}
          onJoinRoom={joinRoom}
          onlineBusy={onlineBusy}
          onlineError={onlineError}
          onShowRules={() => setShowRules(true)}
          onResetStats={() => setStats(clearStats())}
        />
      ) : screen === "game" ? (
        <LandscapeGame
          key={gameKey}
          setup={setup}
          muted={settings.muted}
          onToggleMute={toggleMute}
          onExit={() => setScreen("menu")}
          onRestart={restart}
          onGameEnd={recordOutcome}
        />
      ) : onlineIntent ? (
        <OnlineExperience
          key={`${onlineIntent.roomCode}-${onlineIntent.wantsHost}`}
          intent={onlineIntent}
          settings={settings}
          muted={settings.muted}
          onToggleMute={toggleMute}
          onExit={exitOnline}
          onGameEnd={recordOutcome}
        />
      ) : null}

      {showRules && (
        <RulesModal
          variant={settings.variant}
          onClose={() => setShowRules(false)}
        />
      )}
    </div>
  );
}

interface OnlineExperienceProps {
  intent: OnlineIntent;
  settings: Settings;
  muted: boolean;
  onToggleMute: () => void;
  onExit: () => void;
  onGameEnd: (state: GameState) => void;
}

function OnlineExperience({
  intent,
  settings,
  muted,
  onToggleMute,
  onExit,
  onGameEnd,
}: OnlineExperienceProps) {
  const portrait = usePortraitPhone();
  const [paused, setPaused] = useState(false);
  const room = useOnlineRoom({
    roomCode: intent.roomCode,
    playerName: settings.playerName,
    characterId: settings.characterId,
    wantsHost: intent.wantsHost,
    paused: paused || portrait,
  });
  const recorded = useRef(false);

  useEffect(() => {
    if (room.game?.state.phase.kind === "gameover" && !recorded.current) {
      recorded.current = true;
      onGameEnd(room.game.state);
    }
  }, [onGameEnd, room.game?.state]);

  const leave = () => {
    room.leaveRoom();
    onExit();
  };

  if (!room.game) {
    return (
      <OnlineLobbyScreen
        room={room}
        inviteUrl={createJoinUrl(room.roomCode)}
        onExit={leave}
      />
    );
  }

  const onlineSetup: GameSetup = {
    playerName: settings.playerName,
    characterId: settings.characterId,
    difficulty: "normal",
    botCount: 0,
    variant: room.settings.variant,
    timerEnabled: room.settings.turnSeconds > 0,
    turnSeconds: room.settings.turnSeconds || 30,
  };

  return (
    <>
      <GameTable
        api={room.game}
        setup={onlineSetup}
        muted={muted}
        onToggleMute={onToggleMute}
        onExit={leave}
        onRestart={room.isHost ? room.startGame : undefined}
        online
        paused={paused || portrait}
        onPause={setPaused}
      />
      {room.connectionStatus !== "connected" && (
        <div className="online-reconnect" role="status">
          <span className="online-reconnect__spinner" aria-hidden="true" />
          Восстанавливаем соединение с комнатой…
        </div>
      )}
      <AnimatePresence>{portrait && <OrientationGate resumed />}</AnimatePresence>
    </>
  );
}

interface GameProps {
  setup: GameSetup;
  muted: boolean;
  onToggleMute: () => void;
  onExit: () => void;
  onRestart: () => void;
  onGameEnd: (state: GameState) => void;
}

function readPortraitPhone(): boolean {
  if (typeof window === "undefined") return false;
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  const longSide = Math.max(window.innerWidth, window.innerHeight);
  // Размеры намеренно важнее user-agent: так работают iPadOS «как Mac»,
  // встроенные браузеры и режим «сайт для компьютера» на телефоне.
  return (
    window.innerHeight > window.innerWidth &&
    shortSide <= 600 &&
    longSide <= 1100
  );
}

function usePortraitPhone(): boolean {
  const [portrait, setPortrait] = useState(readPortraitPhone);

  useEffect(() => {
    const update = () => setPortrait(readPortraitPhone());
    const media = window.matchMedia("(orientation: portrait)");
    media.addEventListener?.("change", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    update();
    return () => {
      media.removeEventListener?.("change", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return portrait;
}

function LandscapeGame(props: GameProps) {
  const portrait = usePortraitPhone();
  const [started, setStarted] = useState(() => !portrait);

  useEffect(() => {
    if (!portrait) setStarted(true);
  }, [portrait]);

  if (!started) return <OrientationGate />;

  return (
    <>
      <Game {...props} orientationBlocked={portrait} />
      <AnimatePresence>{portrait && <OrientationGate resumed />}</AnimatePresence>
    </>
  );
}

function Game({
  setup,
  muted,
  onToggleMute,
  onExit,
  onRestart,
  onGameEnd,
  orientationBlocked = false,
}: GameProps & { orientationBlocked?: boolean }) {
  // Пауза: боты не ходят, рулетка не доигрывается, таймер стоит.
  const [paused, setPaused] = useState(false);
  const effectivePaused = paused || orientationBlocked;
  const api = useGameLoop(setup, effectivePaused);
  const recorded = useRef(false);

  useEffect(() => {
    if (api.state.phase.kind === "gameover" && !recorded.current) {
      recorded.current = true;
      onGameEnd(api.state);
    }
  }, [api.state, onGameEnd]);

  return (
    <GameTable
      api={api}
      setup={setup}
      muted={muted}
      onToggleMute={onToggleMute}
      onExit={onExit}
      onRestart={onRestart}
      paused={effectivePaused}
      onPause={setPaused}
    />
  );
}
