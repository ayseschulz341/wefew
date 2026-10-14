import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CharacterId, GameState } from "../game/types";
import { canChallenge, isPlayAllowed, mustChallenge } from "../game/engine";
import { sfx } from "../game/sounds";
import type { GameApi, Taunt } from "./useGameLoop";
import type {
  ClientMessage,
  LobbyPlayer,
  RoomSettings,
  ServerEvent,
} from "../network/protocol";
import {
  clearRoomSession,
  loadRoomSession,
  saveRoomSession,
} from "../network/session";
import { CHARACTER_BY_ID } from "../game/characters";

export type OnlineConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

interface OnlineRoomOptions {
  roomCode: string;
  playerName: string;
  characterId: CharacterId;
  wantsHost: boolean;
  paused?: boolean;
}

export interface OnlineRoomApi {
  connectionStatus: OnlineConnectionStatus;
  roomCode: string;
  players: LobbyPlayer[];
  settings: RoomSettings;
  myPlayerId: string | null;
  isHost: boolean;
  gameInProgress: boolean;
  /** Идентификатор текущей партии от сервера. */
  gameId: string | null;
  game: GameApi | null;
  error: string | null;
  updateSettings: (settings: RoomSettings) => void;
  dismissError: () => void;
  startGame: () => void;
  kickPlayer: (playerId: string) => void;
  leaveRoom: () => void;
  retry: () => void;
}

const DEFAULT_ROOM_SETTINGS: RoomSettings = { variant: "classic", turnSeconds: 30 };
const RECONNECT_MAX_MS = 30_000;

function serverBaseUrl(): string {
  return import.meta.env.VITE_SERVER_URL?.trim() || window.location.origin;
}

function websocketUrl(): string {
  const configured = import.meta.env.VITE_WEBSOCKET_URL?.trim();
  if (configured) return configured;
  const url = new URL(serverBaseUrl());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  return url.toString();
}

export async function createOnlineRoom(settings: RoomSettings): Promise<string> {
  const response = await fetch(`${serverBaseUrl()}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    let serverMessage = "";
    try {
      const errorPayload = (await response.json()) as { error?: unknown };
      if (typeof errorPayload.error === "string") serverMessage = errorPayload.error;
    } catch {
      // Прокси может вернуть пустой ответ, если backend не запущен.
    }
    throw new Error(
      serverMessage ||
        (response.status >= 500
          ? "Сетевой сервер недоступен. Перезапустите игру командой npm run dev"
          : "Не удалось создать комнату"),
    );
  }
  const payload = (await response.json()) as { roomCode?: string };
  if (!payload.roomCode) throw new Error("Сервер не вернул код комнаты");
  return payload.roomCode;
}

/**
 * Имя за сетевым столом. Локальное «Вы» у всех одинаковое: соперники видели бы
 * друг друга как «Вы», а журнал писал бы о чужих ходах во втором лице.
 */
export function onlinePlayerName(playerName: string, characterId: CharacterId): string {
  const name = playerName.trim();
  if (name && name.toLowerCase() !== "вы") return name;
  return CHARACTER_BY_ID.get(characterId)?.name ?? "Игрок";
}

function createActionId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useOnlineRoom(options: OnlineRoomOptions): OnlineRoomApi {
  const { roomCode, playerName, characterId, wantsHost, paused = false } = options;
  const [connectionStatus, setConnectionStatus] =
    useState<OnlineConnectionStatus>("connecting");
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);
  const [settings, setSettings] = useState<RoomSettings>(DEFAULT_ROOM_SETTINGS);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [gameInProgress, setGameInProgress] = useState(false);
  const [state, setState] = useState<GameState | null>(null);
  const [turnEndsAt, setTurnEndsAt] = useState<number | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const intentionalLeaveRef = useRef(false);
  const pendingActionsRef = useRef(new Map<string, ClientMessage>());
  const previousStateRef = useRef<GameState | null>(null);
  const myPlayerIdRef = useRef<string | null>(null);
  /** Номер состояния партии с сервера и ход, на который действие уже отправлено. */
  const turnIdRef = useRef<number | undefined>(undefined);
  const sentTurnRef = useRef<number | null>(null);
  /** Часы сервера минус часы клиента: таймер не зависит от неточных часов телефона. */
  const clockOffsetRef = useRef(0);

  const send = useCallback((message: ClientMessage, queue = true) => {
    if (queue && message.type === "player_action") {
      pendingActionsRef.current.set(message.actionId, message);
      while (pendingActionsRef.current.size > 20) {
        const oldest = pendingActionsRef.current.keys().next().value;
        if (oldest) pendingActionsRef.current.delete(oldest);
      }
    }
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    intentionalLeaveRef.current = false;
    let disposed = false;

    const connect = () => {
      if (disposed || intentionalLeaveRef.current) return;
      setConnectionStatus(retryCountRef.current === 0 ? "connecting" : "reconnecting");
      const socket = new WebSocket(websocketUrl());
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        if (disposed) return;
        const stored = loadRoomSession(roomCode);
        const identify: ClientMessage = {
          type: "identify",
          roomCode,
          playerName: onlinePlayerName(playerName, characterId),
          characterId,
          playerId: stored?.playerId,
          sessionId: stored?.sessionId,
          wantsHost,
        };
        socket.send(JSON.stringify(identify));
        retryCountRef.current = 0;
      });

      socket.addEventListener("message", (event) => {
        let message: ServerEvent;
        try {
          message = JSON.parse(String(event.data)) as ServerEvent;
        } catch {
          return;
        }
        if (message.type === "connected") {
          setConnectionStatus("connected");
          setMyPlayerId(message.playerId);
          myPlayerIdRef.current = message.playerId;
          setIsHost(message.isHost);
          setError(null);
          saveRoomSession({
            roomCode: message.roomCode,
            playerId: message.playerId,
            sessionId: message.sessionId,
          });
          for (const pending of pendingActionsRef.current.values()) send(pending, false);
          return;
        }
        if (message.type === "lobby_state") {
          setPlayers(message.players);
          setSettings(message.settings ?? DEFAULT_ROOM_SETTINGS);
          setGameInProgress(message.gameInProgress);
          setIsHost((current) =>
            myPlayerIdRef.current ? message.ownerId === myPlayerIdRef.current : current,
          );
          return;
        }
        if (message.type === "game_state") {
          if (typeof message.serverNow === "number") {
            clockOffsetRef.current = message.serverNow - Date.now();
          }
          turnIdRef.current = message.turnId;
          setGameId(message.gameId ?? null);
          setState(message.state);
          setGameInProgress(true);
          setTurnEndsAt(message.turnEndsAt ?? null);
          return;
        }
        if (message.type === "action_ack") {
          pendingActionsRef.current.delete(message.actionId);
          return;
        }
        if (message.type === "action_rejected" || message.type === "error") {
          if (message.type === "action_rejected" && message.actionId) {
            pendingActionsRef.current.delete(message.actionId);
            sentTurnRef.current = null;
          }
          setError(message.type === "error" ? message.message : message.reason);
          if (message.type === "error" && message.fatal) {
            // Отказ в самом входе (нет комнаты, игра уже идёт): повторные
            // попытки бессмысленны — останавливаем переподключение.
            intentionalLeaveRef.current = true;
            setConnectionStatus("disconnected");
            socket.close();
          }
          return;
        }
        if (message.type === "player_kicked") {
          clearRoomSession(roomCode);
          intentionalLeaveRef.current = true;
          setError("Владелец комнаты исключил вас");
          setConnectionStatus("disconnected");
          socket.close();
          return;
        }
        if (message.type === "room_closed") {
          clearRoomSession(roomCode);
          intentionalLeaveRef.current = true;
          setError(message.reason || "Комната закрыта");
          setConnectionStatus("disconnected");
          socket.close();
        }
      });

      socket.addEventListener("close", (event) => {
        if (disposed || intentionalLeaveRef.current) return;
        if (event.code === 4001) {
          // Эту же сессию открыли в другой вкладке. Автопереподключение отняло
          // бы место обратно, и вкладки бесконечно перехватывали бы его.
          intentionalLeaveRef.current = true;
          setError("Комната открыта в другой вкладке или на другом устройстве");
          setConnectionStatus("disconnected");
          return;
        }
        retryCountRef.current += 1;
        setConnectionStatus("reconnecting");
        const delay = Math.min(RECONNECT_MAX_MS, 1000 * 2 ** (retryCountRef.current - 1));
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      });

      socket.addEventListener("error", () => {
        socket.close();
      });
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [characterId, playerName, retryKey, roomCode, send, wantsHost]);

  useEffect(() => {
    if (!turnEndsAt || !state || state.phase.kind !== "idle" || state.currentSeat !== 0) {
      setSecondsLeft(null);
      return;
    }
    const update = () =>
      setSecondsLeft(
        Math.max(0, Math.ceil((turnEndsAt - (Date.now() + clockOffsetRef.current)) / 1000)),
      );
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [state, turnEndsAt]);

  // Звуки и голоса по переходам серверного состояния — одинаково для своих
  // и чужих ходов, как в локальной партии.
  useEffect(() => {
    if (!state) return;
    const previous = previousStateRef.current;
    if (state.phase.kind === "reveal" && previous?.phase.kind !== "reveal") {
      const { accused, challenger, devil, wasLie } = state.phase;
      sfx.play("heartbeat");
      sfx.play("flip");
      sfx.playVoice(state.players[challenger]?.characterId ?? null, "challenge");
      const accusedId = state.players[accused]?.characterId ?? null;
      if (devil) sfx.queueVoice(accusedId, "devilRevealed");
      else if (wasLie) sfx.queueVoice(accusedId, "caughtLying");
    } else if (previous && state.pile.length > previous.pile.length) {
      const top = state.pile[state.pile.length - 1];
      sfx.play("card");
      sfx.playVoice(state.players[top.playerId]?.characterId ?? null, "play", {
        count: top.cards.length,
        rank: state.tableRank,
      });
    }
    previousStateRef.current = state;
  }, [state]);

  const isMyTurn = Boolean(
    state && !paused && state.phase.kind === "idle" && state.currentSeat === 0 && state.players[0]?.alive,
  );
  const canCall = Boolean(state && isMyTurn && canChallenge(state, 0));
  const mustCall = Boolean(state && mustChallenge(state, 0));

  const dismissError = useCallback(() => setError(null), []);

  /** Одно действие на ход: повторный клик до ответа сервера давал ошибку отказа. */
  const claimTurn = useCallback((): boolean => {
    const turnId = turnIdRef.current;
    if (turnId === undefined) return true;
    if (sentTurnRef.current === turnId) return false;
    sentTurnRef.current = turnId;
    return true;
  }, []);

  const playCard = useCallback(
    (cardIds: string[]) => {
      if (!state || paused || !isPlayAllowed(state, 0, cardIds) || !claimTurn()) return;
      send({
        type: "player_action",
        action: { type: "play_cards", cardIds },
        actionId: createActionId(),
        turnId: turnIdRef.current,
      });
    },
    [claimTurn, paused, send, state],
  );

  const challenge = useCallback(() => {
    if (!canCall || !state || !claimTurn()) return;
    send({
      type: "player_action",
      action: { type: "challenge" },
      actionId: createActionId(),
      turnId: turnIdRef.current,
    });
  }, [canCall, claimTurn, send, state]);

  const game = useMemo<GameApi | null>(() => {
    if (!state) return null;
    return {
      state,
      isMyTurn,
      canChallenge: canCall,
      mustChallenge: mustCall,
      secondsLeft,
      taunts: [] as Taunt[],
      playCard,
      challenge,
      isPlayAllowed: (cardIds) => isPlayAllowed(state, 0, cardIds),
    };
  }, [canCall, challenge, isMyTurn, mustCall, playCard, secondsLeft, state]);

  return {
    connectionStatus,
    roomCode,
    players,
    settings,
    myPlayerId,
    isHost,
    gameInProgress,
    gameId,
    game,
    error,
    updateSettings: (next) => send({ type: "update_settings", ...next, actionId: createActionId() }, false),
    dismissError,
    startGame: () => send({ type: "start_game", actionId: createActionId() }, false),
    kickPlayer: (playerId) => send({ type: "kick_player", playerId, actionId: createActionId() }, false),
    leaveRoom: () => {
      intentionalLeaveRef.current = true;
      send({ type: "leave_room" }, false);
      clearRoomSession(roomCode);
      socketRef.current?.close();
      setConnectionStatus("disconnected");
    },
    retry: () => {
      intentionalLeaveRef.current = false;
      retryCountRef.current = 0;
      setError(null);
      setRetryKey((value) => value + 1);
    },
  };
}
