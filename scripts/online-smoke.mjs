import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";

const port = Number(process.env.ONLINE_TEST_PORT ?? 8099);
const origin = `http://127.0.0.1:${port}`;
const sockets = new Set();
let serverOutput = "";

const server = spawn(process.execPath, ["server-dist/server/index.js"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, PORT: String(port), HEARTBEAT_INTERVAL_MS: "250" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => { serverOutput += String(chunk); });
server.stderr.on("data", (chunk) => { serverOutput += String(chunk); });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

class Inbox {
  constructor(socket) {
    this.messages = [];
    this.waiters = [];
    socket.on("message", (data) => {
      const message = JSON.parse(String(data));
      this.messages.push(message);
      for (const wake of this.waiters.splice(0)) wake();
    });
  }

  async next(predicate, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const index = this.messages.findIndex(predicate);
      if (index >= 0) return this.messages.splice(index, 1)[0];
      await Promise.race([
        new Promise((resolve) => this.waiters.push(resolve)),
        delay(Math.min(100, Math.max(1, deadline - Date.now()))),
      ]);
    }
    throw new Error(`Timed out waiting for network event; queued=${JSON.stringify(this.messages.slice(-4))}`);
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Server exited early (${server.exitCode}): ${serverOutput}`);
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return;
    } catch {
      // The child process is still starting.
    }
    await delay(100);
  }
  throw new Error(`Server did not become healthy: ${serverOutput}`);
}

async function createRoom(settings = {}) {
  const response = await fetch(`${origin}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(settings),
  });
  assert(response.status === 201, `Room creation failed with ${response.status}`);
  const body = await response.json();
  assert(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(body.roomCode), "Invalid room code");
  return body.roomCode;
}

function connectRaw(options = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, options);
    const inbox = new Inbox(socket);
    sockets.add(socket);
    socket.once("open", () => resolve({ socket, inbox }));
    socket.once("error", reject);
    socket.once("close", () => sockets.delete(socket));
  });
}

async function openPlayer(roomCode, playerName, characterId, wantsHost = false, resume = {}) {
  const player = await connectRaw();
  player.socket.send(JSON.stringify({
    type: "identify",
    roomCode,
    playerName,
    characterId,
    wantsHost,
    playerId: resume.playerId,
    sessionId: resume.sessionId,
  }));
  const connected = await player.inbox.next((message) => message.type === "connected");
  return { ...player, ...connected, name: playerName };
}

function send(player, value) {
  player.socket.send(JSON.stringify(value));
}

async function stateFor(player) {
  const response = await fetch(
    `${origin}/api/rooms/${player.roomCode}/state?sessionId=${encodeURIComponent(player.sessionId)}`,
  );
  assert(response.ok, `State request failed with ${response.status}`);
  return response.json();
}

async function testMalformedTraffic() {
  for (const body of ["[1,2,3]", "{broken-json", JSON.stringify({ padding: "x".repeat(70 * 1024) })]) {
    const response = await fetch(`${origin}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    assert(response.status === 400, `Malformed HTTP body returned ${response.status}`);
  }

  for (const payload of ["null", "42", "[]", JSON.stringify({ type: "unknown" })]) {
    // До входа в комнату любая ошибка фатальна: объяснение и закрытие.
    const client = await connectRaw();
    client.socket.send(payload);
    const verdict = await Promise.race([
      client.inbox.next((message) => message.type === "error" || message.type === "action_rejected").then((m) => m.type),
      delay(3000).then(() => "closed"),
    ]);
    assert(verdict === "error", `Pre-identify garbage returned ${verdict}, expected fatal error`);
    client.socket.close();
  }

  const oversized = await connectRaw();
  const closed = new Promise((resolve) => oversized.socket.once("close", (code) => resolve(code)));
  oversized.socket.send(JSON.stringify({ type: "unknown", padding: "x".repeat(70 * 1024) }));
  const closeCode = await Promise.race([closed, delay(3000).then(() => null)]);
  assert(closeCode === 1009, `Oversized WebSocket was not closed with 1009 (got ${closeCode})`);

  const rejectedOrigin = await new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: "not a valid origin" });
    socket.once("open", () => reject(new Error("Malformed Origin was accepted")));
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve(response.statusCode);
    });
    socket.once("error", () => resolve(null));
  });
  assert(rejectedOrigin === 403 || rejectedOrigin === null, `Malformed Origin returned ${rejectedOrigin}`);

  const healthy = await fetch(`${origin}/api/health`);
  assert(healthy.ok, "Malformed traffic stopped the server");
}

async function testSessionBoundary() {
  const roomCode = await createRoom();
  const host = await openPlayer(roomCode, "Session host", "foxy", true);
  const attacker = await openPlayer(roomCode, "Самозванец", "gerk", false, {
    playerId: host.playerId,
    sessionId: "invalid-session",
  });
  assert(attacker.playerId !== host.playerId, "Public playerId allowed a session takeover");

  const resumed = await openPlayer(roomCode, "Session host", "foxy", false, host);
  assert(resumed.playerId === host.playerId, "Valid session did not restore the same player");
  const oldClosed = await Promise.race([
    new Promise((resolve) => host.socket.once("close", (code) => resolve(code))),
    delay(2000).then(() => null),
  ]);
  assert(oldClosed === 4001 || host.socket.readyState === WebSocket.CLOSED, "Old resumed socket stayed authoritative");
  resumed.socket.close();
  attacker.socket.close();
}

async function testHungClientCleanup() {
  const roomCode = await createRoom();
  const host = await openPlayer(roomCode, "Heartbeat host", "foxy", true);
  const hung = await connectRaw({ autoPong: false });
  hung.socket.send(JSON.stringify({
    type: "identify",
    roomCode,
    playerName: "Hung client",
    characterId: "cupcake",
    wantsHost: false,
  }));
  const connected = await hung.inbox.next((message) => message.type === "connected");
  await host.inbox.next((message) => message.type === "lobby_state" && message.players.length === 2);
  const closeCode = await Promise.race([
    new Promise((resolve) => hung.socket.once("close", (code) => resolve(code))),
    delay(2500).then(() => null),
  ]);
  assert(closeCode !== null, "Hung client was not removed by heartbeat");
  await host.inbox.next((message) => message.type === "lobby_state" && message.players.some(
    (player) => player.id === connected.playerId && !player.connected,
  ));
  host.socket.close();
}

function verifyPrivateProjection(player, state, allStates) {
  assert(state.players.length === 4, "Projection has wrong player count");
  assert(state.players[0].name === player.name.slice(0, 24), "Projection is not relative to its recipient");
  assert(state.deck.length === 0 && state.discard.length === 0, "Deck or discard leaked over the wire");
  assert(state.players.every((entry) => entry.chambers.every((value) => value === false)), "Revolver chambers leaked");
  for (const opponent of state.players.slice(1)) {
    assert(opponent.hand.every((card) => card.id.startsWith("hidden-")), "Opponent card identity leaked");
  }
  const ownIds = new Set(state.players[0].hand.map((card) => card.id));
  for (const otherState of allStates) {
    if (otherState === state) continue;
    const serialized = JSON.stringify(otherState);
    for (const id of ownIds) assert(!serialized.includes(id), `Card ${id} leaked to another player`);
  }
}

async function testFourPlayerGame() {
  const roomCode = await createRoom({ variant: "devil", turnSeconds: 45 });
  const definitions = [
    ["Хозяин", "foxy"],
    ["Гость <script>alert(1)</script>", "cupcake"],
    ["Третий", "scubby"],
    ["Четвёртый", "toar"],
  ];
  const players = [];
  for (let index = 0; index < definitions.length; index += 1) {
    const [name, character] = definitions[index];
    players.push(await openPlayer(roomCode, name, character, index === 0));
  }
  const lobby = await players[0].inbox.next(
    (message) => message.type === "lobby_state" && message.players.length === 4,
  );
  assert(lobby.players[1].name.length <= 24, "Untrusted name was not bounded");

  send(players[0], {
    type: "update_settings",
    variant: "classic",
    turnSeconds: 15,
    actionId: "settings-1",
  });
  await players[0].inbox.next((message) => message.type === "action_ack" && message.actionId === "settings-1");
  await players[3].inbox.next(
    (message) => message.type === "lobby_state" && message.settings.turnSeconds === 15,
  );

  send(players[0], { type: "start_game", actionId: "start-1" });
  await players[0].inbox.next((message) => message.type === "action_ack" && message.actionId === "start-1");
  const initialStates = await Promise.all(players.map((player) =>
    player.inbox.next((message) => message.type === "game_state" && message.state.players.length === 4)
      .then((message) => message.state),
  ));
  players.forEach((player, index) => verifyPrivateProjection(player, initialStates[index], initialStates));

  const activeIndex = initialStates.findIndex((state) => state.currentSeat === 0);
  assert(activeIndex >= 0, "No client received the active seat");
  const active = players[activeIndex];
  const validCardId = initialStates[activeIndex].players[0].hand[0].id;
  const poisonedAction = {
    type: "player_action",
    action: { type: "play_cards", cardIds: ["not-a-card"] },
    actionId: "poison-retry",
  };
  send(active, poisonedAction);
  await active.inbox.next((message) => message.type === "action_rejected" && message.actionId === "poison-retry");
  send(active, { ...poisonedAction, action: { type: "play_cards", cardIds: [validCardId] } });
  await active.inbox.next((message) => message.type === "action_ack" && message.actionId === "poison-retry");
  const afterFirstPlay = await Promise.all(players.map((player) =>
    player.inbox.next((message) => message.type === "game_state" && message.state.pile.length === 1)
      .then((message) => message.state),
  ));

  send(active, { ...poisonedAction, action: { type: "play_cards", cardIds: [validCardId] } });
  await active.inbox.next((message) => message.type === "action_ack" && message.actionId === "poison-retry");
  await delay(150);
  assert((await stateFor(active)).game.pile.length === 1, "Duplicate action was applied twice");

  const nextActiveIndex = afterFirstPlay.findIndex((state) => state.currentSeat === 0);
  assert(nextActiveIndex >= 0 && nextActiveIndex !== activeIndex, "Turn did not move to another player");
  const nextActive = players[nextActiveIndex];
  const inactive = players[(nextActiveIndex + 1) % players.length];
  const nextCardId = afterFirstPlay[nextActiveIndex].players[0].hand[0].id;
  send(inactive, { type: "player_action", action: { type: "play_cards", cardIds: ["not-owned"] }, actionId: "shared-id" });
  send(nextActive, { type: "player_action", action: { type: "play_cards", cardIds: [nextCardId] }, actionId: "shared-id" });
  const [inactiveResult, activeResult] = await Promise.all([
    inactive.inbox.next((message) => message.actionId === "shared-id" && message.type === "action_rejected"),
    nextActive.inbox.next((message) => message.actionId === "shared-id" && message.type === "action_ack"),
  ]);
  assert(inactiveResult.type === "action_rejected" && activeResult.type === "action_ack", "Cross-player action IDs collided");
  await Promise.all(players.map((player) =>
    player.inbox.next((message) => message.type === "game_state" && message.state.pile.length === 2),
  ));

  const reconnectIndex = nextActiveIndex;
  const reconnecting = players[reconnectIndex];
  reconnecting.socket.close();
  await players[(reconnectIndex + 1) % players.length].inbox.next(
    (message) => message.type === "lobby_state" && message.players.some(
      (entry) => entry.id === reconnecting.playerId && !entry.connected,
    ),
  );
  const resumed = await openPlayer(roomCode, reconnecting.name, definitions[reconnectIndex][1], false, reconnecting);
  assert(resumed.playerId === reconnecting.playerId, "Reconnect changed the player seat");
  players[reconnectIndex] = resumed;
  const resumedLobby = await resumed.inbox.next((message) => message.type === "lobby_state");
  assert(resumedLobby.players.length === 4, "Reconnect duplicated the player");
  await resumed.inbox.next((message) => message.type === "game_state" && message.state.pile.length === 2);
  send(resumed, { type: "player_action", action: { type: "play_cards", cardIds: [nextCardId] }, actionId: "shared-id" });
  await resumed.inbox.next((message) => message.type === "action_ack" && message.actionId === "shared-id");
  await delay(150);
  assert((await stateFor(resumed)).game.pile.length === 2, "Replayed action after reconnect applied twice");

  for (const player of players) player.socket.close();
  return { roomCode, players: players.length };
}

async function testHostLifecycle() {
  const roomCode = await createRoom({ turnSeconds: 0 });
  const host = await openPlayer(roomCode, "Leaving host", "foxy", true);
  const guestA = await openPlayer(roomCode, "New host", "cupcake");
  const guestB = await openPlayer(roomCode, "Remaining guest", "gerk");
  const guestC = await openPlayer(roomCode, "Kicked guest", "scubby");
  await host.inbox.next((message) => message.type === "lobby_state" && message.players.length === 4);

  send(host, { type: "leave_room" });
  const transferred = await guestA.inbox.next(
    (message) => message.type === "lobby_state" && message.ownerId === guestA.playerId,
  );
  assert(transferred.players.find((player) => player.id === guestA.playerId)?.isHost, "Host flag was not transferred");
  send(guestA, { type: "kick_player", playerId: guestC.playerId, actionId: "new-host-kick" });
  await guestA.inbox.next((message) => message.type === "action_ack" && message.actionId === "new-host-kick");
  await guestC.inbox.next((message) => message.type === "player_kicked");
  const rejoined = await openPlayer(roomCode, "Kicked guest", "scubby", false, guestC);
  assert(rejoined.playerId !== guestC.playerId, "Kicked session restored its removed seat");
  rejoined.socket.close();
  await guestA.inbox.next((message) => message.type === "lobby_state" && message.players.some(
    (player) => player.id === rejoined.playerId && !player.connected,
  ));
  send(guestA, { type: "start_game", actionId: "new-host-start" });
  await guestA.inbox.next((message) => message.type === "action_ack" && message.actionId === "new-host-start");
  await guestB.inbox.next((message) => message.type === "game_state");
  guestA.socket.close();
  guestB.socket.close();
}

async function testTimers() {
  const timedRoom = await createRoom({ turnSeconds: 15 });
  const timedHost = await openPlayer(timedRoom, "Timer host", "foxy", true);
  const timedGuest = await openPlayer(timedRoom, "Timer guest", "cupcake");
  send(timedHost, { type: "start_game", actionId: "timer-start" });
  await timedHost.inbox.next((message) => message.type === "action_ack" && message.actionId === "timer-start");
  await timedHost.inbox.next((message) => message.type === "game_state" && message.state.pile.length === 0);
  await timedHost.inbox.next(
    (message) => message.type === "game_state" && message.state.pile.length === 1,
    17_500,
  );
  timedHost.socket.close();
  timedGuest.socket.close();

  const untimedRoom = await createRoom({ turnSeconds: 0 });
  const untimedHost = await openPlayer(untimedRoom, "No timer host", "foxy", true);
  const untimedGuest = await openPlayer(untimedRoom, "No timer guest", "cupcake");
  send(untimedHost, { type: "start_game", actionId: "untimed-start" });
  await untimedHost.inbox.next((message) => message.type === "action_ack" && message.actionId === "untimed-start");
  const initial = await untimedHost.inbox.next((message) => message.type === "game_state");
  assert(initial.turnEndsAt == null, "Untimed room received a deadline");
  await delay(1200);
  assert((await stateFor(untimedHost)).game.pile.length === 0, "Untimed room made an automatic move");
  untimedHost.socket.close();
  untimedGuest.socket.close();
}

try {
  await waitForServer();
  await testMalformedTraffic();
  await testSessionBoundary();
  await testHungClientCleanup();
  const game = await testFourPlayerGame();
  await testHostLifecycle();
  await testTimers();
  process.stdout.write(`${JSON.stringify({
    ok: true,
    roomCode: game.roomCode,
    clients: game.players,
    checks: [
      "malformed-and-oversized",
      "malformed-origin-and-http-body",
      "session-boundary",
      "hung-client-heartbeat",
      "four-client-privacy",
      "action-retry-and-dedupe",
      "concurrent-cross-player-action-id",
      "reconnect-replay",
      "host-transfer",
      "kick-session-revocation",
      "timed-and-untimed-turns",
    ],
  })}\n`);
} finally {
  for (const socket of sockets) socket.terminate();
  server.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => server.once("exit", resolve)), delay(2000)]);
}
