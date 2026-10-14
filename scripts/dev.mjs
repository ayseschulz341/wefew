import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const viteEntry = resolve(root, "node_modules/vite/bin/vite.js");
const tsxEntry = resolve(root, "node_modules/tsx/dist/cli.mjs");
const serverPort = Number(process.env.PORT ?? 8080);
const services = [];
let shuttingDown = false;

function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const service of services) {
    if (service.process.exitCode === null && !service.process.killed) {
      service.process.kill();
    }
  }

  const forceExit = setTimeout(() => process.exit(exitCode), 1500);
  forceExit.unref();

  Promise.all(
    services.map(
      ({ process: child }) =>
        new Promise((finish) => {
          if (child.exitCode !== null) finish();
          else child.once("exit", finish);
        }),
    ),
  ).then(() => process.exit(exitCode));
}

function startService(name, entry, args = []) {
  const child = spawn(process.execPath, [entry, ...args], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  const service = { name, process: child };
  services.push(service);

  child.once("error", (error) => {
    console.error(`[dev] Не удалось запустить ${name}:`, error.message);
    shutdown(1);
  });
  child.once("exit", (code, signal) => {
    if (shuttingDown) return;
    const reason = signal ? `сигнал ${signal}` : `код ${code ?? 1}`;
    console.error(`[dev] Процесс ${name} завершился (${reason}).`);
    shutdown(code ?? 1);
  });

  return child;
}

async function waitForServer(child) {
  const deadline = Date.now() + 10_000;
  const healthUrl = `http://127.0.0.1:${serverPort}/api/health`;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`сетевой сервер завершился с кодом ${child.exitCode}`);
    }
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return;
    } catch {
      // Сервер ещё запускается.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }

  throw new Error(`сетевой сервер не ответил на ${healthUrl} за 10 секунд`);
}

process.once("SIGINT", () => shutdown(0));
process.once("SIGTERM", () => shutdown(0));

try {
  const server = startService("server", tsxEntry, ["server/index.ts"]);
  await waitForServer(server);
  startService("client", viteEntry, process.argv.slice(2));
} catch (error) {
  console.error(
    "[dev] Ошибка запуска:",
    error instanceof Error ? error.message : error,
  );
  shutdown(1);
}
