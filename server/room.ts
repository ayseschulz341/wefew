import { randomUUID } from "node:crypto";
import { canChallenge, mustChallenge, reducer, startNetworkGame } from "../src/game/engine";
import type { CharacterId, GameState, GameVariant } from "../src/game/types";
import type { LobbyPlayer } from "../src/network/protocol";
import { rouletteHitOffsetMs, rouletteTotalMs } from "../src/game/roulettePresentation";

export const MAX_PLAYERS = 4;
/**
 * Сколько сервер ждёт хода отключившегося игрока. Действует и при выключенном
 * таймере комнаты — иначе ушедший игрок навсегда останавливал бы партию.
 */
export const AWAY_TURN_MS = 15_000;
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < 6; i += 1) code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  return code;
}

export interface Settings { variant: GameVariant; turnSeconds: number; }
export interface Session { playerId: string; }
export type RoomAction = { type: "play_cards"; cardIds: string[] } | { type: "challenge" };

export class Room {
  readonly players = new Map<string, LobbyPlayer>();
  readonly sessions = new Map<string, Session>();
  private readonly processedActionIds = new Map<string, Set<string>>();
  game: GameState | null = null;
  ownerId: string | null = null;
  turnEndsAt: number | null = null;
  phaseEndsAt: number | null = null;
  rouletteResultAt: number | null = null;
  /** Номер состояния партии: меняется при каждом ходе и смене фазы. */
  turnId = 0;
  /** Идентификатор текущей партии (новый на каждый старт и реванш). */
  gameId: string | null = null;
  readonly settings: Settings;
  private lastActivityAt = Date.now();
  /** Рассадка текущей партии: место → playerId. В лобби могут быть и не севшие за стол. */
  private seats: string[] = [];
  private turnStartedAt: number | null = null;

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
    if (!existing && (this.isPlaying() || this.players.size >= MAX_PLAYERS)) throw new Error(this.isPlaying() ? "Партия уже идёт — дождитесь её конца" : "За столом нет свободных мест");
    if (!this.ownerId && wantsHost) this.ownerId = playerId;
    if (!this.ownerId) this.ownerId = playerId;
    const player: LobbyPlayer = { id: playerId, name: this.uniqueName(playerName, playerId), characterId, isHost: this.ownerId === playerId, connected: true };
    this.players.set(playerId, player);
    const newSessionId = restored?.playerId === playerId ? sessionId! : randomUUID();
    this.sessions.set(newSessionId, { playerId });
    this.refreshTurnDeadline();
    return { player, playerId, sessionId: newSessionId, isHost: player.isHost };
  }

  sessionPlayer(sessionId: string | undefined): LobbyPlayer | null {
    const playerId = sessionId ? this.sessions.get(sessionId)?.playerId : undefined;
    return playerId ? this.players.get(playerId) ?? null : null;
  }
  /** Идёт ли партия (финальный экран партией не считается). */
  isPlaying(): boolean {
    return this.game !== null && this.game.phase.kind !== "gameover";
  }
  /** Место игрока в текущей партии или -1, если он не сидит за столом. */
  seatOf(id: string): number {
    return this.game ? this.seats.indexOf(id) : -1;
  }
  updateSettings(playerId: string, patch: Partial<Settings>) {
    this.touch();
    this.assertHost(playerId); if (this.isPlaying()) throw new Error("Партия уже идёт");
    if (patch.variant) this.settings.variant = patch.variant === "devil" ? "devil" : "classic";
    if (patch.turnSeconds !== undefined) this.settings.turnSeconds = clampSeconds(patch.turnSeconds);
  }
  start(playerId: string) {
    this.touch();
    this.assertHost(playerId);
    if (this.isPlaying()) throw new Error("Партия уже идёт");
    if (this.game?.phase.kind === "gameover") this.removeDisconnectedPlayers();
    const connectedPlayers = [...this.players.values()].filter((player) => player.connected);
    if (connectedPlayers.length < 2) {
      throw new Error("Нужно минимум два подключённых игрока");
    }
    // Места фиксируются при старте. Раньше место вычислялось по порядку всего
    // лобби, и отключённый в лобби игрок сдвигал нумерацию: соседи получали
    // чужие руки и ходили за чужое место.
    this.seats = connectedPlayers.map((player) => player.id);
    this.gameId = randomUUID();
    this.game = startNetworkGame(connectedPlayers.map((p) => ({ name: p.name, characterId: p.characterId })), { difficulty: "normal", variant: this.settings.variant });
    this.scheduleTurn();
  }
  action(playerId: string, action: RoomAction, turnId?: number) {
    this.touch();
    if (!this.game) throw new Error("Партия ещё не началась");
    const seat = this.seatOf(playerId); if (seat < 0) throw new Error("Вы не участвуете в этой партии");
    // Действие, отправленное для уже прошедшего хода (например, повтор очереди
    // после переподключения), не должно сработать в новом ходе.
    if (turnId !== undefined && turnId !== this.turnId) throw new Error("Ход уже сменился");
    const before = JSON.stringify(this.game);
    this.game = action.type === "play_cards" ? reducer(this.game, { type: "PLAY_CARDS", seat, cardIds: action.cardIds }) : reducer(this.game, { type: "CHALLENGE", challenger: seat });
    if (before === JSON.stringify(this.game)) throw new Error("Такой ход сейчас невозможен");
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
  kick(hostId: string, playerId: string) {
    this.touch();
    this.assertHost(hostId);
    if (this.isPlaying()) throw new Error("Во время партии исключать нельзя");
    if (playerId === hostId) throw new Error("Нельзя исключить самого себя");
    this.forgetPlayer(playerId);
  }
  leave(playerId: string) {
    this.touch();
    if (this.isPlaying() && this.seats.includes(playerId)) {
      // Место за столом сохраняется до конца партии, ходы за ушедшего делает сервер.
      this.setConnected(playerId, false);
      if (this.ownerId === playerId) this.ensureConnectedOwner();
      return;
    }
    this.forgetPlayer(playerId);
    if (this.ownerId === playerId) this.ensureConnectedOwner();
  }
  setConnected(playerId: string, connected: boolean) {
    const player = this.players.get(playerId);
    if (player) {
      player.connected = connected;
      if (!connected && this.ownerId === playerId && !this.isPlaying()) {
        this.ensureConnectedOwner();
      }
      this.refreshTurnDeadline();
      this.touch();
    }
  }
  isStale(now = Date.now()) {
    const nobodyConnected = [...this.players.values()].every((player) => !player.connected);
    const ttl = this.isPlaying()
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
  private assertHost(id: string) { if (this.ownerId !== id) throw new Error("Это может только владелец стола"); }
  private touch() { this.lastActivityAt = Date.now(); }
  /** Одинаковые имена путали журнал и экран победителя — добавляем номер. */
  private uniqueName(raw: string, playerId: string): string {
    const base = raw.trim().slice(0, 24) || "Player";
    const taken = new Set(
      [...this.players.values()]
        .filter((player) => player.id !== playerId)
        .map((player) => player.name.toLowerCase()),
    );
    if (!taken.has(base.toLowerCase())) return base;
    for (let n = 2; ; n += 1) {
      const candidate = `${base.slice(0, 21)} ${n}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }
  private ensureConnectedOwner() {
    if (this.ownerId && this.players.get(this.ownerId)?.connected) return;
    const connected = [...this.players.values()].filter((player) => player.connected);
    // Во время партии права (в том числе реванш) получает тот, кто сидит за столом.
    const seated = this.game ? connected.find((player) => this.seats.includes(player.id)) : undefined;
    this.ownerId = (seated ?? connected[0])?.id ?? null;
    for (const player of this.players.values()) player.isHost = player.id === this.ownerId;
  }
  private forgetPlayer(playerId: string) {
    this.players.delete(playerId);
    this.processedActionIds.delete(playerId);
    for (const [sessionId, session] of this.sessions) {
      if (session.playerId === playerId) this.sessions.delete(sessionId);
    }
  }
  private removeDisconnectedPlayers() {
    for (const [playerId, player] of this.players) {
      if (!player.connected) this.forgetPlayer(playerId);
    }
    this.ensureConnectedOwner();
  }
  /**
   * Срок текущего хода: обычный таймер комнаты, а для отключившегося игрока —
   * не дольше AWAY_TURN_MS. Повторные вызовы срок не продлевают.
   */
  private refreshTurnDeadline(now = Date.now()) {
    const game = this.game;
    if (!game || game.phase.kind !== "idle" || this.turnStartedAt === null) return;
    const regular = this.settings.turnSeconds > 0
      ? this.turnStartedAt + this.settings.turnSeconds * 1000
      : null;
    const currentId = this.seats[game.currentSeat];
    const away = !currentId || !this.players.get(currentId)?.connected;
    // Когда за столом не осталось никого, партия не доигрывается сама ускоренно:
    // действует только обычный таймер, а 15 секунд отсчитываются от возвращения.
    const anyoneHere = this.seats.some((id) => this.players.get(id)?.connected);
    if (!away || !anyoneHere) {
      this.turnEndsAt = regular;
      return;
    }
    this.turnEndsAt = Math.min(
      regular ?? Infinity,
      this.turnEndsAt ?? Infinity,
      Math.max(now, this.turnStartedAt) + AWAY_TURN_MS,
    );
  }
  private scheduleTurn() {
    this.turnId += 1;
    const now = Date.now();
    if (this.game?.phase.kind === "idle") {
      this.turnStartedAt = now;
      this.turnEndsAt = null;
      this.phaseEndsAt = null;
      this.rouletteResultAt = null;
      this.refreshTurnDeadline(now);
    } else if (this.game && this.game.phase.kind !== "gameover") {
      // Presentation phases are authoritative too: no client may decide when
      // a reveal or a revolver pull resolves.
      this.turnStartedAt = null;
      this.turnEndsAt = null;
      const roulette = this.game.phase.kind === "roulette" ? this.game.phase : null;
      this.phaseEndsAt = now + (
        this.game.phase.kind === "reveal" ? 2800 : roulette ? rouletteTotalMs(roulette.pullNumber) : 0
      );
      // Исход раскрывается ровно в момент удара курка на таймлайне сцены.
      this.rouletteResultAt = roulette
        ? now + rouletteHitOffsetMs(roulette.pullNumber)
        : null;
    } else {
      this.turnStartedAt = null;
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
