/**
 * Проверка мобильных изменений: своё место скрыто, подсказка под столом,
 * барабан в топбаре, новый джокер, оцифрованные звуки, работа в онлайн-комнате.
 *
 * Запуск: node scripts/verify-mobile.mjs  (перед этим: npm run build)
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const PORT = 8412;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = "shots/verify";
mkdirSync(OUT, { recursive: true });

const problems = [];
const note = (message) => {
  problems.push(message);
  console.log(`  !! ${message}`);
};

const server = spawn(process.execPath, ["server-dist/server/index.js"], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (c) => (serverLog += String(c)));
server.stderr.on("data", (c) => (serverLog += String(c)));

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

/** Геометрия: подсказка не должна пересекаться со столом (по bbox сукна). */
async function geometry(page) {
  return page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
        display: getComputedStyle(el).display,
      };
    };
    const me = box(".scene__me");
    const drum = box(".topbar__drum");
    const status = box(".status");
    const felt = box(".felt");
    const overlaps =
      status && felt
        ? !(
            status.left >= felt.right ||
            status.right <= felt.left ||
            status.top >= felt.bottom ||
            status.bottom <= felt.top
          )
        : null;
    return {
      meDisplay: me?.display ?? "absent",
      drumDisplay: drum?.display ?? "absent",
      bulletCount: document.querySelectorAll(".topbar__bullet").length,
      spentCount: document.querySelectorAll(".topbar__bullet.is-spent").length,
      statusTop: status ? Math.round(status.top) : null,
      statusBottom: status ? Math.round(status.bottom) : null,
      feltBottom: felt ? Math.round(felt.bottom) : null,
      statusOverlapsFelt: overlaps,
    };
  });
}

async function waitMyTurn(page, timeoutMs = 70000) {
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("Ваш ход") ||
      document.body.innerText.includes("КОНЕЦ НОЧИ") ||
      document.body.innerText.includes("ВЫЖИЛИ"),
    null,
    { timeout: timeoutMs },
  );
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function isMyTurn(page) {
  return page.evaluate(() => document.body.innerText.includes("Ваш ход"));
}

/** Ждёт хода у любой из страниц, возвращает ту, чей ход. */
async function awaitAnyTurn(pages, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const p of pages) {
      if (await isMyTurn(p)) return p;
    }
    await delay(400);
  }
  throw new Error("ни одна страница не получила ход");
}

/** Выкладывает первую карту руки. */
async function playOneCard(page) {
  await page.locator(".hand__slot .playing-card").first().click();
  await page.getByRole("button", { name: /^Положить/ }).click();
  await page.waitForTimeout(1200);
}

async function startBotGame(page) {
  // По умолчанию меню открыто в онлайн-режиме: переключаем на ботов и стартуем.
  await page.locator(".menu__check--mode").click();
  await page.getByRole("button", { name: "Играть с ботами" }).click();
  await page.waitForSelector(".hand .playing-card", { timeout: 20000 });
}

const browser = await chromium.launch();

try {
  await waitForServer();

  // ---------- 1. Джокер: QA-доска карт ----------
  const jokerPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await jokerPage.goto(`${BASE}/?qa=cards`);
  await jokerPage.waitForTimeout(700);
  await jokerPage.screenshot({ path: `${OUT}/01-joker-cards.png` });
  console.log("shot: 01-joker-cards");
  await jokerPage.close();

  // ---------- 2. Боты, телефон 911x440 ----------
  const botCtx = await browser.newContext({
    viewport: { width: 911, height: 440 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const bp = await botCtx.newPage();
  bp.on("pageerror", (e) => note(`bots pageerror: ${e.message}`));
  bp.on("console", (m) => {
    if (m.type() === "error") note(`bots console: ${m.text()}`);
  });

  await bp.goto(BASE);
  await bp.waitForTimeout(600);
  await startBotGame(bp);
  // Жест пользователя разблокирует AudioContext.
  await bp.locator("body").click({ position: { x: 10, y: 10 } });
  await waitMyTurn(bp);
  await bp.waitForTimeout(1200);
  await bp.screenshot({ path: `${OUT}/02-bots-my-turn-911x440.png` });
  console.log("shot: 02-bots-my-turn-911x440");

  const botGeo = await geometry(bp);
  console.log("bots geometry:", JSON.stringify(botGeo));
  if (botGeo.meDisplay !== "none") note(`scene__me должен быть скрыт, display=${botGeo.meDisplay}`);
  if (botGeo.drumDisplay === "none" || botGeo.drumDisplay === "absent")
    note("topbar__drum не виден на мобильном");
  if (botGeo.bulletCount !== 6) note(`в барабане ${botGeo.bulletCount} пипсов вместо 6`);
  if (botGeo.statusOverlapsFelt) note("подсказка пересекает bbox сукна");

  // Мелкий телефон 844x390 — узкий блок вёрстки.
  await bp.setViewportSize({ width: 844, height: 390 });
  await bp.waitForTimeout(700);
  await bp.screenshot({ path: `${OUT}/03-bots-844x390.png` });
  console.log("shot: 03-bots-844x390");
  const smallGeo = await geometry(bp);
  console.log("small geometry:", JSON.stringify(smallGeo));
  if (smallGeo.statusOverlapsFelt) note("844x390: подсказка пересекает bbox сукна");

  // Выкладка карты — груда и статус «ход соперника».
  await bp.locator(".hand__slot .playing-card").first().click();
  await bp.getByRole("button", { name: /^Положить/ }).click();
  await bp.waitForTimeout(1600);
  await bp.screenshot({ path: `${OUT}/04-bots-after-play.png` });
  console.log("shot: 04-bots-after-play");
  await botCtx.close();

  // Осечка — отдельная QA-сцена (roulette-dry): там на ударе играет процедурный щелчок.
  const sndCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  for (const scene of ["roulette-fired", "roulette-dry"]) {
    const sp = await sndCtx.newPage();
    sp.on("pageerror", (e) => note(`${scene} pageerror: ${e.message}`));
    sp.on("console", (m) => {
      if (m.type() === "error") note(`${scene} console: ${m.text()}`);
    });
    await sp.goto(`${BASE}/?qa=${scene}`);
    await sp.waitForTimeout(400);
    // Сцена обязана дойти до финала без единой ошибки консоли.
    await sp.waitForSelector('.overlay--roulette[data-stage="result"]', { timeout: 15000 });
    await sp.waitForTimeout(800);
    await sp.screenshot({ path: `${OUT}/05-roulette-${scene}.png` });
    console.log(`shot: 05-roulette-${scene}`);
    await sp.close();
  }
  await sndCtx.close();

  // ---------- 4. Онлайн: двое игроков, гость на телефоне ----------
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const host = await hostCtx.newPage();
  host.on("pageerror", (e) => note(`host pageerror: ${e.message}`));
  await host.goto(BASE);
  // Меню по умолчанию в онлайн-режиме — сразу создаём комнату.
  await host.getByRole("button", { name: "Создать комнату" }).click();
  await host.waitForSelector(".room-code strong", { timeout: 20000 });
  const code = (await host.locator(".room-code strong").innerText()).trim();
  console.log("room code:", code);

  const guestCtx = await browser.newContext({
    viewport: { width: 911, height: 440 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const guest = await guestCtx.newPage();
  guest.on("pageerror", (e) => note(`guest pageerror: ${e.message}`));
  guest.on("console", (m) => {
    if (m.type() === "error") note(`guest console: ${m.text()}`);
  });
  await guest.goto(`${BASE}/?room=${code}`);
  await host.waitForFunction(
    () => document.body.innerText.includes("За столом 2/4"),
    null,
    { timeout: 20000 },
  );
  await host.getByRole("button", { name: "Начать игру" }).click();
  await guest.waitForSelector(".hand .playing-card", { timeout: 25000 });
  await host.waitForSelector(".hand .playing-card", { timeout: 25000 });

  // Первым может начать любой: играем по кругу и снимаем гостя в его ход,
  // когда на столе уже есть выкладка.
  let current = await awaitAnyTurn([host, guest]);
  let guestShot = false;
  for (let round = 0; round < 8 && !guestShot; round += 1) {
    const pileCards = await current.evaluate(
      () => document.querySelectorAll(".center__pile-card").length,
    );
    if (current === guest) {
      const name = pileCards > 0 ? "06-online-guest-my-turn" : "06a-online-guest-starter";
      await guest.screenshot({ path: `${OUT}/${name}.png` });
      console.log(`shot: ${name} (pile=${pileCards})`);
      if (pileCards > 0) guestShot = true;
      await playOneCard(guest);
    } else {
      await playOneCard(host);
    }
    current = await awaitAnyTurn([host, guest]);
  }
  if (!guestShot) note("не дождались хода гостя со скриншотом");

  const guestGeo = await geometry(guest);
  console.log("guest geometry:", JSON.stringify(guestGeo));
  if (guestGeo.meDisplay !== "none") note(`online: scene__me виден (${guestGeo.meDisplay})`);
  if (guestGeo.drumDisplay === "none" || guestGeo.drumDisplay === "absent")
    note("online: topbar__drum не виден");
  if (guestGeo.bulletCount !== 6) note(`online: в барабане ${guestGeo.bulletCount} пипсов`);
  if (guestGeo.statusOverlapsFelt) note("online: подсказка пересекает bbox сукна");

  // Скриншот хоста на десктопе — раскладка без мобильных изменений.
  if (await isMyTurn(host)) {
    await host.screenshot({ path: `${OUT}/07-online-host-desktop.png` });
  } else {
    await playOneCard(guest);
    await awaitAnyTurn([host], 45000);
    await host.screenshot({ path: `${OUT}/07-online-host-desktop.png` });
  }
  console.log("shot: 07-online-host-desktop");
  await hostCtx.close();
  await guestCtx.close();
} finally {
  await browser.close();
  try {
    process.platform === "win32"
      ? spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"])
      : server.kill();
  } catch {}
}

if (problems.length) {
  console.log(`\nПРОБЛЕМЫ (${problems.length}):`);
  for (const p of problems) console.log(" -", p);
  process.exitCode = 1;
} else {
  console.log("\nВсе проверки пройдены.");
}
