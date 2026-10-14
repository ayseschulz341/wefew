import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";

const port = Number(process.env.RAILWAY_SMOKE_PORT ?? 8101);
const origin = `http://127.0.0.1:${port}`;
let output = "";

const server = spawn(process.execPath, ["server-dist/server/index.js"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverExit = new Promise((resolve) => {
  server.once("exit", (code, signal) => resolve({ code, signal }));
});
server.stdout.on("data", (chunk) => { output += String(chunk); });
server.stderr.on("data", (chunk) => { output += String(chunk); });

function assert(condition, message) {
  if (!condition) throw new Error(`${message}\n${output}`);
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Production server exited early (${server.exitCode})\n${output}`);
    }
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return response;
    } catch {
      // The process is still starting.
    }
    await delay(100);
  }
  throw new Error(`Production server did not become healthy\n${output}`);
}

async function openWebSocket() {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${origin.replace("http", "ws")}/ws`, {
      origin,
    });
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("WebSocket upgrade timed out"));
    }, 3_000);
    socket.once("open", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

let completedChecks;
try {
  const health = await waitForHealth();
  assert(health.status === 200, `Healthcheck returned ${health.status}`);
  assert((await health.json()).ok === true, "Healthcheck payload is invalid");

  const page = await fetch(`${origin}/room/test-route`);
  const html = await page.text();
  assert(page.status === 200, `SPA fallback returned ${page.status}`);
  assert(html.includes('<div id="root"></div>'), "SPA fallback did not serve index.html");

  const socket = await openWebSocket();
  socket.close(1000, "Smoke test complete");

  completedChecks = ["healthcheck", "spa-fallback", "websocket-upgrade"];
} finally {
  server.kill("SIGTERM");
  const exit = await Promise.race([
    serverExit,
    delay(3_000).then(() => null),
  ]);
  if (!exit) {
    server.kill("SIGKILL");
    await serverExit;
    throw new Error(`Production server did not stop within 3 seconds\n${output}`);
  }
  if (process.platform !== "win32") {
    assert(exit.code === 0 && exit.signal === null, `Production server did not exit cleanly: ${JSON.stringify(exit)}`);
  }
}

process.stdout.write(`${JSON.stringify({ ok: true, checks: completedChecks })}\n`);
