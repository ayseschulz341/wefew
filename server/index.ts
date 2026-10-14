import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import type { ClientMessage } from "../src/network/protocol";
import { personalState } from "./projection";
import { Room } from "./room";
import { ALL_CHARACTER_IDS } from "../src/game/characters";

interface AliveWebSocket extends WebSocket {
  isAlive: boolean;
}

interface ClientMeta {
  roomCode?: string;
  sessionId?: string;
}

const PORT = Number(process.env.PORT ?? 8080);
const requestedHeartbeatMs = Number(process.env.HEARTBEAT_INTERVAL_MS);
const HEARTBEAT_INTERVAL_MS = Number.isFinite(requestedHeartbeatMs) && requestedHeartbeatMs >= 250
  ? requestedHeartbeatMs
  : 30_000;
const DIST = resolve(process.cwd(), "dist");
const rooms = new Map<string, Room>();
const clients = new Map<AliveWebSocket, ClientMeta>();
const CLIENT_TYPES = new Set([
  "identify",
  "update_settings",
  "start_game",
  "player_action",
  "request_sync",
  "leave_room",
  "kick_player",
]);
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

function send(socket: WebSocket, value: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
}

function reject(socket: AliveWebSocket, reason: string, actionId?: string): void {
  const meta = clients.get(socket);
  if (!meta?.roomCode) {
    // Ошибка до входа в комнату фатальна: повторить действие негде.
    // Пауза перед закрытием даёт сообщению уйти в сеть раньше кадра close.
    send(socket, { type: "error", message: reason, fatal: true });
    setTimeout(() => socket.close(4002, "Not joined"), 50).unref();
    return;
  }
  send(socket, { type: "action_rejected", reason, actionId });
}

function lobby(room: Room) {
  return {
    type: "lobby_state" as const,
    roomCode: room.code,
    players: [...room.players.values()],
    ownerId: room.ownerId,
    gameInProgress: Boolean(room.game),
    settings: room.settings,
  };
}

function broadcast(room: Room): void {
  for (const [socket, meta] of clients) {
    if (meta.roomCode !== room.code) continue;
    send(socket, lobby(room));
    const player = room.sessionPlayer(meta.sessionId);
    if (!player || !room.game) continue;
    const seat = [...room.players.keys()].indexOf(player.id);
    if (seat >= 0) {
      send(socket, {
        type: "game_state",
        state: personalState(room.game, seat, room.isRouletteResultVisible()),
        turnEndsAt: room.turnEndsAt,
      });
    }
  }
}

function resolveClient(socket: AliveWebSocket) {
  const meta = clients.get(socket);
  const room = meta?.roomCode ? rooms.get(meta.roomCode) : undefined;
  const player = room?.sessionPlayer(meta?.sessionId);
  return { meta, room, player };
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolveBody, rejectBody) => {
    let body = "";
    let tooLarge = false;
    const contentLength = Number(req.headers["content-length"] ?? 0);
    if (Number.isFinite(contentLength) && contentLength > 64 * 1024) {
      tooLarge = true;
      rejectBody(new Error("Слишком большой запрос"));
      req.resume();
      return;
    }
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      if (tooLarge) return;
      body += chunk;
      if (Buffer.byteLength(body) > 64 * 1024) {
        tooLarge = true;
        rejectBody(new Error("Слишком большой запрос"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (tooLarge) return;
      try {
        const parsed = body ? (JSON.parse(body) as unknown) : {};
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          rejectBody(new Error("JSON body must be an object"));
          return;
        }
        resolveBody(parsed as Record<string, unknown>);
      } catch {
        rejectBody(new Error("Некорректный JSON"));
      }
    });
    req.on("error", rejectBody);
  });
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const file = resolve(DIST, requested);
  if (file !== DIST && !file.startsWith(`${DIST}${sep}`)) {
    json(res, 403, { error: "Forbidden" });
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    try {
      const html = await readFile(join(DIST, "index.html"));
      res.writeHead(200, { "content-type": MIME[".html"] });
      res.end(html);
    } catch {
      json(res, 404, { error: "Build not found" });
    }
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && url.pathname === "/api/health") {
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/rooms") {
    try {
      const body = await readJson(req);
      let room: Room;
      do {
        room = new Room(undefined, {
          variant: body.variant === "devil" ? "devil" : "classic",
          turnSeconds: typeof body.turnSeconds === "number" ? body.turnSeconds : 30,
        });
      } while (rooms.has(room.code));
      rooms.set(room.code, room);
      json(res, 201, { roomCode: room.code });
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : "Bad request" });
    }
    return;
  }

  const stateMatch = /^\/api\/rooms\/([A-Z0-9]{6})\/state$/.exec(url.pathname);
  if (req.method === "GET" && stateMatch) {
    const room = rooms.get(stateMatch[1]);
    const player = room?.sessionPlayer(url.searchParams.get("sessionId") ?? undefined);
    if (!room || !player) {
      json(res, 404, { error: "Room or session not found" });
      return;
    }
    const seat = [...room.players.keys()].indexOf(player.id);
    json(res, 200, {
      lobby: lobby(room),
      game: room.game && seat >= 0
        ? personalState(room.game, seat, room.isRouletteResultVisible())
        : null,
      turnEndsAt: room.turnEndsAt,
    });
    return;
  }

  if (req.method !== "GET") {
    json(res, 404, { error: "Not found" });
    return;
  }
  await serveStatic(url.pathname, res);
});

const wss = new WebSocketServer({
  server,
  path: "/ws",
  maxPayload: 64 * 1024,
  verifyClient: ({ origin, req }, done) => {
    const host = req.headers.host;
    if (!origin || !host) {
      done(true);
      return;
    }
    try {
      const parsedOrigin = new URL(origin);
      if ((parsedOrigin.protocol === "http:" || parsedOrigin.protocol === "https:") && parsedOrigin.host === host) {
        done(true);
      } else {
        done(false, 403, "Forbidden origin");
      }
    } catch {
      done(false, 403, "Forbidden origin");
    }
  },
});

function disconnect(socket: AliveWebSocket): void {
  const meta = clients.get(socket);
  if (!meta) return;
  clients.delete(socket);
  if (!meta.roomCode || !meta.sessionId) return;
  const room = rooms.get(meta.roomCode);
  const player = room?.sessionPlayer(meta.sessionId);
  if (!room || !player) return;
  const stillConnected = [...clients.entries()].some(
    ([otherSocket, otherMeta]) =>
      otherSocket.readyState === WebSocket.OPEN &&
      otherMeta.roomCode === room.code &&
      room.sessionPlayer(otherMeta.sessionId)?.id === player.id,
  );
  if (!stillConnected) {
    room.setConnected(player.id, false);
    broadcast(room);
  }
}

function handle(socket: AliveWebSocket, raw: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    reject(socket, "Некорректное сообщение");
    return;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    reject(socket, "Сообщение должно быть объектом");
    return;
  }
  const message = parsed as ClientMessage;
  if (typeof message.type !== "string") {
    reject(socket, "Не указан тип сообщения");
    return;
  }
  if (!CLIENT_TYPES.has(message.type)) {
    reject(socket, "Неизвестный тип сообщения");
    return;
  }

  try {
    if (message.type === "identify") {
      if (
        typeof message.roomCode !== "string" ||
        typeof message.playerName !== "string" ||
        (message.characterId !== null && !ALL_CHARACTER_IDS.includes(message.characterId))
      ) {
        throw new Error("Некорректные данные игрока");
      }
      const room = rooms.get(message.roomCode.toUpperCase());
      if (!room) throw new Error("Комната не найдена");
      const joined = room.identify(
        message.playerName,
        message.characterId,
        message.playerId,
        message.sessionId,
        message.wantsHost,
      );
      for (const [otherSocket, otherMeta] of clients) {
        if (
          otherSocket !== socket &&
          otherMeta.roomCode === room.code &&
          room.sessionPlayer(otherMeta.sessionId)?.id === joined.playerId
        ) {
          clients.delete(otherSocket);
          otherSocket.close(4001, "Session resumed elsewhere");
        }
      }
      clients.set(socket, { roomCode: room.code, sessionId: joined.sessionId });
      send(socket, {
        type: "connected",
        playerId: joined.playerId,
        roomCode: room.code,
        sessionId: joined.sessionId,
        isHost: joined.isHost,
      });
      broadcast(room);
      return;
    }

    const { room, player } = resolveClient(socket);
    if (!room || !player) throw new Error("Сначала подключитесь к комнате");
    if (message.type === "request_sync") {
      broadcast(room);
      return;
    }
    if (message.type === "leave_room") {
      room.leave(player.id);
      clients.delete(socket);
      broadcast(room);
      socket.close(1000, "Left room");
      return;
    }

    const actionId = "actionId" in message ? message.actionId : undefined;
    if (typeof actionId !== "string" || actionId.length < 1 || actionId.length > 128) {
      throw new Error("Некорректный идентификатор действия");
    }
    if (room.hasProcessedAction(player.id, actionId)) {
      send(socket, { type: "action_ack", actionId });
      return;
    }

    if (message.type === "update_settings") {
      if (
        (message.variant !== undefined && message.variant !== "classic" && message.variant !== "devil") ||
        (message.turnSeconds !== undefined && typeof message.turnSeconds !== "number")
      ) {
        throw new Error("Некорректные настройки комнаты");
      }
      room.updateSettings(player.id, message);
    } else if (message.type === "start_game") {
      room.start(player.id);
    } else if (message.type === "player_action") {
      if (
        !message.action ||
        (message.action.type !== "challenge" && message.action.type !== "play_cards") ||
        (message.action.type === "play_cards" &&
          (!Array.isArray(message.action.cardIds) ||
            message.action.cardIds.length < 1 ||
            message.action.cardIds.length > 3 ||
            !message.action.cardIds.every((id) => typeof id === "string")))
      ) {
        throw new Error("Некорректное игровое действие");
      }
      room.action(player.id, message.action);
    } else if (message.type === "kick_player") {
      if (typeof message.playerId !== "string") throw new Error("Некорректный игрок");
      const kickedSockets = [...clients.entries()].filter(
        ([, candidate]) =>
          candidate.roomCode === room.code &&
          room.sessionPlayer(candidate.sessionId)?.id === message.playerId,
      );
      room.kick(player.id, message.playerId);
      for (const [kickedSocket] of kickedSockets) {
        send(kickedSocket, { type: "player_kicked", roomCode: room.code });
        clients.delete(kickedSocket);
        kickedSocket.close(4003, "Kicked");
      }
    }

    room.markProcessedAction(player.id, actionId);
    send(socket, { type: "action_ack", actionId });
    broadcast(room);
  } catch (error) {
    reject(
      socket,
      error instanceof Error ? error.message : "Действие отклонено",
      "actionId" in message && typeof message.actionId === "string"
        ? message.actionId
        : undefined,
    );
  }
}

wss.on("connection", (socket: AliveWebSocket) => {
  socket.isAlive = true;
  clients.set(socket, {});
  socket.on("pong", () => {
    socket.isAlive = true;
  });
  socket.on("message", (data, isBinary) => {
    if (isBinary) {
      reject(socket, "Бинарные сообщения не поддерживаются");
      return;
    }
    handle(socket, data.toString("utf8"));
  });
  socket.on("close", () => disconnect(socket));
  socket.on("error", () => disconnect(socket));
});

setInterval(() => {
  for (const room of rooms.values()) {
    if (room.rouletteResultAt && room.rouletteResultAt <= Date.now()) {
      if (room.revealRouletteResult()) broadcast(room);
    } else if (room.phaseEndsAt && room.phaseEndsAt <= Date.now()) {
      room.advance();
      broadcast(room);
    } else if (room.turnEndsAt && room.turnEndsAt <= Date.now()) {
      room.timeout();
      broadcast(room);
    }
  }
}, 500).unref();

setInterval(() => {
  for (const [code, room] of rooms) if (room.isStale()) rooms.delete(code);
}, 60_000).unref();

setInterval(() => {
  for (const socket of clients.keys()) {
    if (!socket.isAlive) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, HEARTBEAT_INTERVAL_MS).unref();

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);

  for (const socket of clients.keys()) {
    socket.close(1012, "Service restarting");
  }
  wss.close();
  server.close((error) => {
    if (error) {
      console.error("HTTP server shutdown failed", error);
      process.exitCode = 1;
    }
  });

  setTimeout(() => {
    for (const socket of clients.keys()) socket.terminate();
    process.exitCode = 1;
  }, 10_000).unref();
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Liars Bar server listening on ${PORT}`);
});
