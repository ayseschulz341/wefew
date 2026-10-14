import { randomUUID } from "node:crypto";
import { canChallenge, mustChallenge, reducer, startNetworkGame } from "../src/game/engine";
import type { CharacterId, GameState, GameVariant } from "../src/game/types";
import type { LobbyPlayer } from "../src/network/protocol";
import { rouletteHitOffsetMs, rouletteTotalMs } from "../src/game/roulettePresentation";

export const MAX_PLAYERS = 4;
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < 6; i += 1) code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  return code;
}

export interface Settings { variant: GameVariant; turnSeconds: number; }
export interface Session { playerId: string; }

export class Room {
  readonly players = new Map<string, LobbyPlayer>();
  readonly sessions = new Map<string, Session>();
  private readonly processedActionIds = new Map<string, Set<string>>();
  game: GameState | null = null;
  ownerId: string | null = null;
  turnEndsAt: number | null = null;
  phaseEndsAt: number | null = null;
  rouletteResultAt: number | null = null;
  readonly settings: Settings;
  private lastActivityAt = Date.now();

  constructor(readonly code = generateRoomCode(), settings?: Partial<Settings>) {
    this.settings = { variant: settings?.variant === "devil" ? "devil" : "classic", turnSeconds: clampSeconds(settings?.turnSeconds) };
  }

  identify(playerName: string, characterId: CharacterId | null, _requestedId?: string, sessionId?: string, wantsHost = false) {
    this.touch();
    const restored = sessionId ? this.sessions.get(sessionId) : undefined;
    // Публичного playerId недостаточно для восстановления места: иначе любой
    // участник лобби мог бы выдать себя за соседа. Нужна выданная сервером сессия.
    const playerId = restored?.playerId ?? randomUUID();
    const existing = this.players.get(playerId);
    if (!existing && (this.game || this.players.size >= MAX_PLAYERS)) throw new Error(this.game ? "Game already started" : "Room is full");
    if (!this.ownerId && wantsHost) this.ownerId = playerId;
    if (!this.ownerId) this.ownerId = playerId;
    const player: LobbyPlayer = { id: playerId, name: playerName.trim().slice(0, 24) || "Player", characterId, isHost: this.ownerId === playerId, connected: true };
    this.players.set(playerId, player);
    const newSessionId = restored?.playerId === playerId ? sessionId! : randomUUID();
    this.sessions.set(newSessionId, { playerId });
    return { player, playerId, sessionId: newSessionId, isHost: player.isHost };
  }

  sessionPlayer(sessionId: string | undefined): LobbyPlayer | null {
    const playerId = sessionId ? this.sessions.get(sessionId)?.playerId : undefined;
    return playerId ? this.players.get(playerId) ?? null : null;
  }
  updateSettings(playerId: string, patch: Partial<Settings>) {
    this.touch();
    this.assertHost(playerId); if (this.game) throw new Error("Game already started");
    if (patch.variant) this.settings.variant = patch.variant === "devil" ? "devil" : "classic";
    if (patch.turnSeconds !== undefined) this.settings.turnSeconds = clampSeconds(patch.turnSeconds);
  }
  start(playerId: string) {
    this.touch();
    this.assertHost(playerId);
    if (this.game && this.game.phase.kind !== "gameover") throw new Error("Game already started");
    if (this.game?.phase.kind === "gameover") this.removeDisconnectedPlayers();
    const connectedPlayers = [...this.players.values()].filter((player) => player.connected);
    if (connectedPlayers.length < 2) {
      throw new Error("Нужно минимум два подключённых игрока");
    }
    this.game = startNetworkGame(connectedPlayers.map((p) => ({ name: p.name, characterId: p.characterId })), { difficulty: "normal", variant: this.settings.variant });
    this.scheduleTurn();
  }
  action(playerId: string, action: { type: "play_cards"; cardIds: string[] } | { type: "challenge" }) {
    this.touch();
    if (!this.game) throw new Error("Game has not started");
    const seat = this.seatOf(playerId); if (seat < 0) throw new Error("Player is not in game");
    const before = JSON.stringify(this.game);
    this.game = action.type === "play_cards" ? reducer(this.game, { type: "PLAY_CARDS", seat, cardIds: action.cardIds }) : reducer(this.game, { type: "CHALLENGE", challenger: seat });
    if (before === JSON.stringify(this.game)) throw new Error("Illegal action");
    this.scheduleTurn();
  }
  advance() {
    if (this.game && this.game.phase.kind !== "idle" && this.game.phase.kind !== "gameover") {
      this.touch();
      this.game = reducer(this.game, { type: "ADVANCE" });
      if (this.game.phase.kind === "gameover") this.ensureConnectedOwner();
      this.scheduleTurn();
    }
  }
  timeout() {
    if (!this.game || this.game.phase.kind !== "idle") return;
    this.touch();
    const seat = this.game.currentSeat;
    const player = this.game.players[seat];
    if (canChallenge(this.game, seat) && mustChallenge(this.game, seat)) {
      this.game = reducer(this.game, { type: "CHALLENGE", challenger: seat });
    } else if (player?.hand[0]) {
      // The server, rather than an absent client, makes the minimum legal
      // move at deadline. Card identity is still never revealed to opponents.
      this.game = reducer(this.game, { type: "PLAY_CARDS", seat, cardIds: [player.hand[0].id] });
    }
    this.scheduleTurn();
  }
  kick(hostId: string, playerId: string) { this.touch(); this.assertHost(hostId); if (this.game) throw new Error("Cannot kick after game start"); if (playerId === hostId) throw new Error("Host cannot kick self"); this.players.delete(playerId); for (const [id, session] of this.sessions) if (session.playerId === playerId) this.sessions.delete(id); }
  leave(playerId: string) {
    this.touch();
    if (this.game) {
      this.setConnected(playerId, false);
      if (this.ownerId === playerId) this.ensureConnectedOwner();
      return;
    }
    this.players.delete(playerId);
    for (const [id, session] of this.sessions) if (session.playerId === playerId) this.sessions.delete(id);
    if (this.ownerId === playerId) {
      this.ownerId = this.players.keys().next().value ?? null;
      for (const p of this.players.values()) p.isHost = p.id === this.ownerId;
    }
  }
  setConnected(playerId: string, connected: boolean) {
    const player = this.players.get(playerId);
    if (player) {
      player.connected = connected;
      if (!connected && this.ownerId === playerId && (!this.game || this.game.phase.kind === "gameover")) {
        this.ensureConnectedOwner();
      }
      this.touch();
    }
  }
  isStale(now = Date.now()) {
    const nobodyConnected = [...this.players.values()].every((player) => !player.connected);
    const ttl = this.game && this.game.phase.kind !== "gameover"
      ? 60 * 60 * 1000
      : 15 * 60 * 1000;
    return (this.players.size === 0 || nobodyConnected) && now - this.lastActivityAt > ttl;
  }
  isRouletteResultVisible() {
    return this.game?.phase.kind === "roulette" && this.rouletteResultAt === null;
  }
  revealRouletteResult() {
    if (this.game?.phase.kind !== "roulette") return false;
    this.rouletteResultAt = null;
    return true;
  }
  hasProcessedAction(playerId: string, id: string) {
    return this.processedActionIds.get(playerId)?.has(id) ?? false;
  }
  markProcessedAction(playerId: string, id: string) {
    let ids = this.processedActionIds.get(playerId);
    if (!ids) {
      ids = new Set<string>();
      this.processedActionIds.set(playerId, ids);
    }
    ids.add(id);
    if (ids.size > 1000) ids.delete(ids.values().next().value!);
  }
  private assertHost(id: string) { if (this.ownerId !== id) throw new Error("Host only"); }
  private seatOf(id: string) { return [...this.players.keys()].indexOf(id); }
  private touch() { this.lastActivityAt = Date.now(); }
  private ensureConnectedOwner() {
    if (this.ownerId && this.players.get(this.ownerId)?.connected) return;
    this.ownerId = [...this.players.values()].find((player) => player.connected)?.id ?? null;
    for (const player of this.players.values()) player.isHost = player.id === this.ownerId;
  }
  private removeDisconnectedPlayers() {
    for (const [playerId, player] of this.players) {
      if (player.connected) continue;
      this.players.delete(playerId);
      this.processedActionIds.delete(playerId);
      for (const [sessionId, session] of this.sessions) {
        if (session.playerId === playerId) this.sessions.delete(sessionId);
      }
    }
    this.ensureConnectedOwner();
  }
  private scheduleTurn() {
    if (this.game?.phase.kind === "idle") {
      this.turnEndsAt = this.settings.turnSeconds > 0
        ? Date.now() + this.settings.turnSeconds * 1000
        : null;
      this.phaseEndsAt = null;
      this.rouletteResultAt = null;
    } else if (this.game && this.game.phase.kind !== "gameover") {
      // Presentation phases are authoritative too: no client may decide when
      // a reveal or a revolver pull resolves.
      this.turnEndsAt = null;
      const now = Date.now();
      const roulette = this.game.phase.kind === "roulette" ? this.game.phase : null;
      this.phaseEndsAt = now + (
        this.game.phase.kind === "reveal" ? 2800 : roulette ? rouletteTotalMs(roulette.pullNumber) : 0
      );
      // Исход раскрывается ровно в момент удара курка на таймлайне сцены.
      this.rouletteResultAt = roulette
        ? now + rouletteHitOffsetMs(roulette.pullNumber)
        : null;
    } else {
      this.turnEndsAt = null;
      this.phaseEndsAt = null;
      this.rouletteResultAt = null;
    }
  }
}
function clampSeconds(value: unknown) {
  const n = typeof value === "number" ? Math.round(value) : 30;
  if (n === 0) return 0;
  return [15, 30, 45, 60].includes(n) ? n : 30;
}
