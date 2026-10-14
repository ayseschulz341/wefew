import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
const port = 8097;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["server-dist/server/index.js"], {
  env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "ignore", "pipe"],
});
server.stderr.on("data", (c) => process.stderr.write(c));
for (let i = 0; i < 80; i++) { try { const r = await fetch(`${origin}/api/health`); if (r.ok) break; } catch {} await delay(100); }
const roomCode = await (await fetch(`${origin}/api/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json().then(b => b.roomCode);
const mk = (name) => new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const msgs = [];
  ws.on("message", (d) => msgs.push(JSON.parse(String(d))));
  ws.once("open", () => resolve({ ws, msgs }));
});
const a = await mk("A"); const b = await mk("B");
a.ws.send(JSON.stringify({ type: "identify", roomCode, playerName: "A", characterId: "foxy", wantsHost: true }));
await delay(300);
b.ws.send(JSON.stringify({ type: "identify", roomCode, playerName: "B", characterId: "cupcake" }));
await delay(500);
a.ws.send(JSON.stringify({ type: "start_game", actionId: "s1" }));
await delay(1500);
for (const [name, c] of [["A", a], ["B", b]]) {
  const gs = c.msgs.filter(m => m.type === "game_state");
  console.log(`--- ${name}: game_state x${gs.length}`);
  for (const m of gs) {
    const s = m.state;
    console.log(JSON.stringify({ phase: s.phase.kind, currentSeat: s.currentSeat, round: s.roundNumber, pile: s.pile.length, me: { name: s.players[0].name, alive: s.players[0].alive, hand: s.players[0].hand.map(x => x.rank) }, turnEndsAt: m.turnEndsAt ?? null }));
  }
}
a.ws.close(); b.ws.close(); server.kill();
