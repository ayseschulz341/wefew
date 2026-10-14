/**
 * Браузерный e2e сетевого режима: два реальных клиента (host + guest)
 * доигрывают до вскрытия и полной сцены рулетки на обоих экранах.
 * Проверяется синхронность исхода, завершение сцены, продолжение партии
 * и отсутствие ошибок консоли.
 *
 * Запуск: node scripts/online-browser.mjs  (перед этим: npm run build)
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { chromium } from "playwright";

const PORT = 8415;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = "shots/online-e2e";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, ["server-dist/server/index.js"], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (c) => (serverLog += String(c)));
server.stderr.on("data", (c) => (serverLog += String(c)));

const problems = [];
const note = (message) => {
  problems.push(message);
  console.log(`  !! ${message}`);
};

async function waitForServer() {
  for (let i = 0; i < 100; i += 1) {
    if (server.exitCode !== null) throw new Error(`server exited: ${serverLog}`);
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server not healthy: ${serverLog}`);
}

/** Кладёт первую легальную карту; возвращает true, если ход сделан. */
async function playAnyCard(page) {
  const slots = page.locator(".hand__slot .playing-card");
  const count = await slots.count();
  const btn = page.getByRole("button", { name: /^Положить/ });
  for (let i = 0; i < count; i += 1) {
    await slots.nth(i).click();
    await page.waitForTimeout(220);
    if (!(await btn.isDisabled())) {
      await btn.click();
      return true;
    }
  }
  return false;
}

const browser = await chromium.launch({
  args: [
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
  ],
});

try {
  await waitForServer();

  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const host = await hostCtx.newPage();
  const guestCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const guest = await guestCtx.newPage();

  const consoleErrors = new Map([
    [host, []],
    [guest, []],
  ]);
  for (const page of [host, guest]) {
    page.on("pageerror", (e) => consoleErrors.get(page).push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.get(page).push(`console: ${m.text()}`);
    });
  }

  // ---------- Лобби: хост создаёт комнату, гость входит ----------
  await host.goto(BASE);
  await host.waitForTimeout(600);
  await host.getByRole("button", { name: "Создать комнату" }).click();
  await host.waitForSelector(".room-code strong", { timeout: 20000 });
  const code = (await host.locator(".room-code strong").innerText()).trim();
  console.log("room code:", code);

  await guest.goto(`${BASE}/?room=${code}`);
  await host.waitForFunction(
    () => document.body.innerText.includes("За столом 2/4"),
    null,
    { timeout: 20000 },
  );
  await host.getByRole("button", { name: "Начать игру" }).click();
  await host.waitForSelector(".hand .playing-card", { timeout: 25000 });
  await guest.waitForSelector(".hand .playing-card", { timeout: 25000 });
  console.log("оба клиента за столом");

  // ---------- Доигрываем до вскрытия ----------
  let challenged = false;
  for (let turn = 0; turn < 10 && !challenged; turn += 1) {
    const page = await Promise.race([host, guest].map(async (p) => {
      await p.waitForFunction(
        () => document.body.innerText.includes("Ваш ход") ||
              document.body.innerText.includes("КОНЕЦ НОЧИ") ||
              document.body.innerText.includes("Победитель партии"),
        { timeout: 60000 },
      );
      return p;
    }));
    const body = await page.evaluate(() => document.body.innerText);
    if (body.includes("КОНЕЦ НОЧИ") || body.includes("Победитель партии")) {
      note("Партия кончилась до вскрытия — рулетка не проверена");
      break;
    }
    const danger = page.locator(".btn--danger");
    if (!(await danger.isDisabled())) {
      await danger.click();
      challenged = true;
      console.log(`вскрытие инициировал: ${page === host ? "хост" : "гость"}`);
      break;
    }
    if (!(await playAnyCard(page))) note("нет легальной карты в свой ход");
    await page.waitForTimeout(1500);
  }
  if (!challenged) throw new Error("Не дошли до вскрытия");

  // ---------- Рулетка на обоих экранах ----------
  await host.waitForSelector(".overlay--roulette", { timeout: 15000 });
  await guest.waitForSelector(".overlay--roulette", { timeout: 15000 });
  console.log("рулетка открылась у обоих");

  const dump = async (tag) => {
    for (const [name, page] of [["host", host], ["guest", guest]]) {
      try {
        const info = await page.evaluate(() => {
          const ov = document.querySelector(".overlay--roulette");
          return {
            stage: ov?.getAttribute("data-stage"),
            outcome: ov?.getAttribute("data-outcome"),
            pull: ov?.getAttribute("data-pull"),
            status: document.body.innerText.slice(0, 120).replace(/\n/g, " | "),
          };
        });
        console.error(`  [${tag}/${name}] ${JSON.stringify(info)}`);
        await page.screenshot({ path: `${OUT}/stuck-${tag}-${name}.png` });
      } catch {}
    }
  };
  try {
    await host.waitForSelector('.overlay--roulette[data-stage="result"]', { timeout: 45000 });
    await guest.waitForSelector('.overlay--roulette[data-stage="result"]', { timeout: 45000 });
  } catch (error) {
    await dump("result-timeout");
    for (const [page, errors] of consoleErrors) {
      for (const message of errors) console.error(`  [консоль ${page === host ? "хост" : "гость"}] ${message}`);
    }
    throw error;
  }
  const hostOutcome = await host.locator(".overlay--roulette").getAttribute("data-outcome");
  const guestOutcome = await guest.locator(".overlay--roulette").getAttribute("data-outcome");
  console.log(`исход: хост=${hostOutcome}, гость=${guestOutcome}`);
  if (hostOutcome !== guestOutcome) note(`Исходы на клиентах разошлись: ${hostOutcome} != ${guestOutcome}`);
  if (hostOutcome === "pending" || guestOutcome === "pending") note("Исход остался нераскрытым на стадии result");

  await host.screenshot({ path: `${OUT}/host-roulette-result.png` });
  await guest.screenshot({ path: `${OUT}/guest-roulette-result.png` });

  // ---------- Сцена закрывается, партия продолжается ----------
  await host.waitForFunction(() => !document.querySelector(".overlay--roulette"), { timeout: 20000 });
  await guest.waitForFunction(() => !document.querySelector(".overlay--roulette"), { timeout: 20000 });
  console.log("сцена закрылась у обоих");

  // Даём партии продолжиться: ждём либо новый ход, либо финал.
  await host.waitForFunction(
    () => {
      const t = document.body.innerText;
      return t.includes("Ваш ход") || t.includes("ход") || t.includes("КОНЕЦ НОЧИ") || t.includes("Победитель партии");
    },
    { timeout: 30000 },
  );
  await host.screenshot({ path: `${OUT}/host-after.png` });
  await guest.screenshot({ path: `${OUT}/guest-after.png` });

  // ---------- Неверный код комнаты: отказ без петли переподключений ----------
  const badCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const bad = await badCtx.newPage();
  let badReconnects = 0;
  bad.on("websocket", (ws) => {
    if (ws.url().includes("/ws")) ws.on("close", () => { badReconnects += 1; });
  });
  await bad.goto(`${BASE}/?room=ZZZZZZ`);
  await bad.waitForSelector('[role="alert"]', { timeout: 8000 });
  const alertText = await bad.locator('[role="alert"]').innerText();
  console.log(`неверный код: сервер ответил «${alertText.trim().split("\n")[0]}»`);
  await bad.waitForFunction(
    () => document.querySelector(".connection-badge")?.classList.contains("is-disconnected"),
    { timeout: 5000 },
  );
  await bad.waitForTimeout(4000);
  if (badReconnects > 3) note(`Клиент переподключается в петле: ${badReconnects} соединений за 4 с`);
  await bad.screenshot({ path: `${OUT}/bad-code-error.png` });
  await badCtx.close();

  for (const [page, errors] of consoleErrors) {
    for (const error of errors) note(`${page === host ? "хост" : "гость"}: ${error}`);
  }

  await hostCtx.close();
  await guestCtx.close();
} catch (error) {
  note(String(error?.message ?? error));
} finally {
  await browser.close();
  try {
    process.platform === "win32"
      ? spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"])
      : server.kill();
  } catch {}
}

if (problems.length) {
  console.log(`\nПРОБЛЕМЫ: ${problems.length}`);
  process.exitCode = 1;
} else {
  console.log("\nБраузерный e2e сетевого режима: все проверки пройдены.");
}
