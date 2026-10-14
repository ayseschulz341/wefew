/**
 * Полный реальный тест сетевого режима: поднимается собранный сервер,
 * два клиента через WebSocket доигрывают партию до конца — с вскрытиями,
 * рулеткой и финалом. Проверяется приватность исхода на проводе, точные
 * тайминги раскрытия (удар курка) и завершения фазы, отказ действий после
 * gameover и отказ позднему участнику.
 *
 * Запуск: node scripts/online-fullgame.mjs  (перед этим: npm run build)
 */
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";

const port = Number(process.env.ONLINE_TEST_PORT ?? 8098);
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

let checks = 0;
function assert(condition, message) {
  if (!condition) throw new Error(`ПРОВАЛ: ${message}`);
  checks += 1;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Server exited early: ${serverOutput}`);
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`Server did not become healthy: ${serverOutput}`);
}

// ---------- Событийная шина: единственный читатель каждого сокета ----------
const bus = [];
const busWaiters = [];
function busPush(event) {
  bus.push(event);
  for (const wake of busWaiters.splice(0)) wake();
}
async function busTake(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const event = bus.shift();
    if (event) return event;
    if (Date.now() > deadline) throw new Error(`Шина пуста ${timeoutMs} мс; осталось=${bus.length}`);
    await Promise.race([
      new Promise((resolve) => busWaiters.push(resolve)),
      delay(50),
    ]);
  }
}

async function openPlayer(roomCode, playerName, characterId, wantsHost = false) {
  const socket = await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    sockets.add(ws);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
  // Важно: обработчик и возвращаемый объект — одно и то же лицо,
  // иначе состояние клиента будет записываться в копию.
  const client = { name: playerName, socket, messages: [] };
  socket.on("message", (data) => {
    const message = JSON.parse(String(data));
    client.messages.push(message);
    busPush({ client, message });
  });
  socket.send(JSON.stringify({ type: "identify", roomCode, playerName, characterId, wantsHost }));
  const connected = await (async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const index = client.messages.findIndex((m) => m.type === "connected");
      if (index >= 0) return client.messages.splice(index, 1)[0];
      await delay(50);
    }
    throw new Error("Не дождались connected");
  })();
  Object.assign(client, connected);
  return client;
}

function send(client, value) {
  client.socket.send(JSON.stringify(value));
}

let actionSeq = 0;
const actionId = () => `fg-${(actionSeq += 1)}`;

// Тайминги сцены — зеркальные формулы из src/game/roulettePresentation.ts.
const hitOffsetMs = (pull) => 2530 + (pull - 1) * 380 + 6180;
const totalMs = (pull) => hitOffsetMs(pull) + 2600;

/**
 * Ведёт один спуск рулетки по событиям одного клиента: приватность исхода
 * на проводе, тайминг раскрытия (удар курка) и тайминг смены фазы.
 */
/**
 * Ведёт одну рулетную сцену (включая очередь стрелков «Дьявола»):
 * каждый спуск — сегмент со своей приватностью и таймингами.
 */
async function observeRoulette(client, t0, scene, pull, index) {
  const segments = [];
  let cur = { pull, index, startedAt: 0, revealedAt: null, fired: null, leaked: false, endedAt: null };
  segments.push(cur);
  let finished = null;

  for (;;) {
    const event = await busTake(25_000);
    const message = event.message;
    if (message.type !== "game_state") continue;
    event.client.lastState = message.state;
    event.client.lastStateScene = scene;
    const phase = message.state.phase;
    const now = Date.now() - t0;
    if (phase.kind === "roulette") {
      if (phase.index !== cur.index || phase.pullNumber !== cur.pull) {
        // Очередь стрелков: начался следующий спуск.
        cur.endedAt = now;
        cur = {
          pull: phase.pullNumber,
          index: phase.index,
          startedAt: now,
          revealedAt: null,
          fired: null,
          leaked: false,
          endedAt: null,
        };
        segments.push(cur);
      }
      if (phase.resultPending === true) {
        if (phase.fired !== false) cur.leaked = true;
      } else if (cur.revealedAt === null) {
        cur.revealedAt = now;
        cur.fired = phase.fired;
      }
      continue;
    }
    cur.endedAt = now;
    finished = { at: now, kind: phase.kind };
    break;
  }

  for (const seg of segments) {
    assert(!seg.leaked, "Утечка исхода: fired=true пришёл при активном resultPending");
    assert(seg.revealedAt !== null, "Раскрытие исхода не пришло до смены фазы");
    const hit = hitOffsetMs(seg.pull);
    const total = totalMs(seg.pull);
    assert(
      seg.revealedAt - seg.startedAt >= hit - 1500 && seg.revealedAt - seg.startedAt <= hit + 3000,
      `Спуск ${seg.index} (pull ${seg.pull}): раскрытие через ${seg.revealedAt - seg.startedAt} мс от старта сегмента, ожидалось ~${hit}`,
    );
    assert(
      seg.endedAt - seg.startedAt >= total - 1500 && seg.endedAt - seg.startedAt <= total + 4000,
      `Спуск ${seg.index} (pull ${seg.pull}): сегмент длился ${seg.endedAt - seg.startedAt} мс, ожидалось ~${total}`,
    );
  }
  return { segments, finished };
}

/** Первый кадровый кадр спуска: скрытый исход и известный номер. */
function assertHiddenRouletteState(state) {
  assert(
    state.phase.resultPending === true && state.phase.fired === false,
    "Рулетка пришла с раскрытым исходом",
  );
}

function canChallengeNow(state) {
  if (state.phase.kind !== "idle") return false;
  const top = state.pile[state.pile.length - 1];
  return Boolean(top && top.playerId !== 0);
}

/** Кладёт первую легальную карту, перебирая руку. */
async function playLegalCard(client) {
  const state = client.lastState;
  for (const card of state.players[0].hand) {
    const id = actionId();
    send(client, { type: "player_action", action: { type: "play_cards", cardIds: [card.id] }, actionId: id });
    const acked = await (async () => {
      const deadline = Date.now() + 2500;
      while (Date.now() < deadline) {
        const index = client.messages.findIndex(
          (m) => (m.type === "action_ack" || m.type === "action_rejected") && m.actionId === id,
        );
        if (index >= 0) return client.messages.splice(index, 1)[0].type === "action_ack";
        await delay(40);
      }
      return false;
    })();
    if (acked) return true;
  }
  return false;
}

/**
 * Доигрывает полную сетевую партию до gameover. Наблюдает каждую рулетку:
 * скрытый исход на проводе, тайминги раскрытия и смены фазы, очереди
 * стрелков (вариант «Дьявол»). forceDevil заставляет держателя джокера
 * играть его в одиночку, чтобы гарантированно собрать очередь стрелков.
 */
async function playFullGame({ variant, playerDefs, forceDevil = false, label }) {
  // События предыдущего сценария не должны попадать в эту партию.
  bus.length = 0;
  const roomCode = await (await fetch(`${origin}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ variant, turnSeconds: 0 }),
  })).json().then((b) => b.roomCode);
  assert(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(roomCode), "Код комнаты невалиден");

  const clients = [];
  for (let i = 0; i < playerDefs.length; i += 1) {
    const [name, character] = playerDefs[i];
    clients.push(await openPlayer(roomCode, name, character, i === 0));
  }
  const host = clients[0];
  {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const index = host.messages.findIndex(
        (m) => m.type === "lobby_state" && m.players.length === playerDefs.length,
      );
      if (index >= 0) { host.messages.splice(index, 1); break; }
      await delay(50);
    }
  }

  send(host, { type: "start_game", actionId: actionId() });
  const ack = await (async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const index = host.messages.findIndex((m) => m.type === "action_ack");
      if (index >= 0) return host.messages.splice(index, 1)[0];
      await delay(40);
    }
    throw new Error("start_game не подтверждён");
  })();
  assert(Boolean(ack), "Нет подтверждения старта");

  let roulettes = 0;
  let shotsFired = 0;
  let maxQueue = 0;
  let gameOver = false;
  let observing = false;
  let scene = 0;
  let firstStats = null;

  /**
   * Приоритетный ход: в сценарии «Дьявола» держатель карты с меткой играет
   * её одиночку, как только её номинал совпал с номиналом стола. Возвращает
   * true, если ход сделан.
   */
  const playCardChoice = async (c) => {
    const state = c.lastState;
    if (forceDevil) {
      const hand = state.players[0].hand;
      const devilCard = hand.find(
        (card) => card.devilMark && card.rank === state.tableRank,
      );
      if (devilCard) {
        const id = actionId();
        send(c, { type: "player_action", action: { type: "play_cards", cardIds: [devilCard.id] }, actionId: id });
        const deadline = Date.now() + 2500;
        while (Date.now() < deadline) {
          const index = c.messages.findIndex(
            (m) => (m.type === "action_ack" || m.type === "action_rejected") && m.actionId === id,
          );
          if (index >= 0) return c.messages.splice(index, 1)[0].type === "action_ack";
          await delay(40);
        }
        return false;
      }
    }
    return false;
  };

  const driveTurns = async () => {
    for (const c of clients) {
      const s = c.lastState;
      if (!s || c.lastActed === s) continue;
      if (c.lastStateScene !== scene) continue;
      if (s.phase.kind !== "idle" || s.currentSeat !== 0 || !s.players[0].alive) continue;
      c.lastActed = s;
      if (await playCardChoice(c)) {
        await delay(120);
        continue;
      }
      if (canChallengeNow(s)) {
        send(c, { type: "player_action", action: { type: "challenge" }, actionId: actionId() });
      } else {
        const played = await playLegalCard(c);
        if (!played) throw new Error(`${c.name}: нет легальной карты и обвинения`);
      }
      await delay(120);
    }
  };

  for (let guard = 0; guard < 600 && !gameOver; guard += 1) {
    const event = await busTake(35_000);
    const { client, message } = event;
    if (!clients.includes(client)) continue;
    if (message.type !== "game_state") continue;
    const state = message.state;
    if (state.phase.kind !== client.lastState?.phase.kind) {
      console.error(`  [${label}/${client.name}] ${client.lastState?.phase.kind ?? "—"} -> ${state.phase.kind}` +
        (state.phase.kind === "roulette" ? ` pull=${state.phase.pullNumber} index=${state.phase.index}/${state.phase.total}` : ""));
    }
    client.lastState = state;
    client.lastStateScene = scene;

    if (state.phase.kind === "roulette") {
      if (observing) continue; // та же сцена глазами другого клиента
      observing = true;
      scene += 1;
      assertHiddenRouletteState(state);
      const observed = await observeRoulette(
        client,
        Date.now(),
        scene,
        state.phase.pullNumber,
        state.phase.index,
      );
      roulettes += observed.segments.length;
      shotsFired += observed.segments.filter((seg) => seg.fired).length;
      maxQueue = Math.max(maxQueue, observed.segments.length);
      if (!firstStats) {
        const seg = observed.segments[0];
        firstStats = {
          pull: seg.pull,
          revealedAt: seg.revealedAt - seg.startedAt,
          finishedAt: seg.endedAt - seg.startedAt,
        };
      }
      if (observed.finished.kind === "gameover") gameOver = true;
      observing = false;
      await driveTurns();
      continue;
    }
    if (state.phase.kind === "gameover") gameOver = true;
    await driveTurns();
  }

  assert(gameOver, `${label}: партия не доиграна до конца`);
  assert(roulettes >= 1, `${label}: не случилось ни одного спуска`);
  if (forceDevil) {
    assert(maxQueue >= 2, `${label}: очередь стрелков не собралась (max=${maxQueue})`);
  }
  console.log(`${label}: спусков=${roulettes}, выстрелов=${shotsFired}, очередь стрелков до ${maxQueue}`);
  console.log(`${label}: первый спуск (pull ${firstStats.pull}) — раскрытие +${firstStats.revealedAt} мс (цель ${hitOffsetMs(firstStats.pull)}), фаза сменилась +${firstStats.finishedAt} мс (цель ${totalMs(firstStats.pull)})`);

  // Финальные инварианты.
  const overState = host.lastState;
  assert(overState?.phase.kind === "gameover", `${label}: финальное состояние не gameover`);
  const alive = overState.players.filter((p) => p.alive);
  assert(alive.length <= 1, `${label}: живых больше одного после финала`);
  const dead = overState.players.find((p) => !p.alive);
  if (dead) assert(dead.hand.length === 0, `${label}: у погибшего остались карты`);

  // Действие после gameover отклоняется.
  const id = actionId();
  send(host, { type: "player_action", action: { type: "challenge" }, actionId: id });
  {
    const deadline = Date.now() + 4000;
    let rejected = false;
    while (Date.now() < deadline) {
      const index = host.messages.findIndex(
        (m) => m.type === "action_rejected" && m.actionId === id,
      );
      if (index >= 0) { rejected = true; break; }
      await delay(40);
    }
    assert(rejected, `${label}: действие после gameover не отклонено`);
  }

  for (const c of clients) c.socket.close();
  return { roulettes, shotsFired, maxQueue };
}

try {
  await waitForServer();

  // ---------- Сценарий 1: классика, два игрока ----------
  const classic = await playFullGame({
    variant: "classic",
    playerDefs: [["Хост", "foxy"], ["Гость", "cupcake"]],
    label: "классика/2",
  });

  // ---------- Сценарий 2: «Дьявол», трое — очередь стрелков ----------
  // Розыгрыш дьявольской карты зависит от расклада: партия может закончиться
  // до её появления. Одна повторная попытка на этот случай.
  let devil = null;
  for (let attempt = 1; attempt <= 2 && !devil; attempt += 1) {
    try {
      devil = await playFullGame({
        variant: "devil",
        playerDefs: [["Хост-Д", "foxy"], ["Гость-Д", "cupcake"], ["Третий-Д", "gerk"]],
        forceDevil: true,
        label: attempt === 1 ? "дьявол/3" : "дьявол/3 (повтор)",
      });
    } catch (error) {
      if (attempt === 2 || !String(error).includes("очередь стрелков")) throw error;
      console.log("  очередь стрелков не собралась — повторяем сценарий");
    }
  }

  // ---------- Поздний участник в комнату с игрой не допускается ----------
  {
    const roomCode = await (await fetch(`${origin}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })).json().then((b) => b.roomCode);
    const h = await openPlayer(roomCode, "Хост-П", "foxy", true);
    const g = await openPlayer(roomCode, "Гость-П", "cupcake");
    await delay(400);
    send(h, { type: "start_game", actionId: actionId() });
    await delay(900);
    const lateSocket = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      sockets.add(ws);
      ws.once("open", () => resolve(ws));
      ws.once("error", reject);
    });
    const lateMessages = [];
    lateSocket.on("message", (data) => lateMessages.push(JSON.parse(String(data))));
    lateSocket.send(JSON.stringify({ type: "identify", roomCode, playerName: "Поздний", characterId: "gerk" }));
    const deadline = Date.now() + 4000;
    let errored = false;
    while (Date.now() < deadline) {
      const index = lateMessages.findIndex((m) => m.type === "error");
      if (index >= 0) { errored = true; break; }
      await delay(40);
    }
    assert(errored, "Поздний участник не получил отказ");
    lateSocket.close();
    h.socket.close();
    g.socket.close();
  }

  console.log(`OK: ${checks} проверок пройдено`);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    checks,
    classic: { roulettes: classic.roulettes, shotsFired: classic.shotsFired },
    devil: { roulettes: devil.roulettes, shotsFired: devil.shotsFired, maxQueue: devil.maxQueue },
  })}\n`);
} catch (error) {
  console.error(String(error?.stack ?? error));
  process.stdout.write(`${JSON.stringify({ ok: false, error: String(error?.message ?? error) })}\n`);
  process.exitCode = 1;
} finally {
  for (const socket of sockets) socket.terminate();
  server.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => server.once("exit", resolve)), delay(2000)]);
}
