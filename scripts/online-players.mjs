/**
 * Полный реальный тест сетевого режима с живыми игроками: трое участников
 * в настоящих браузерах проходят весь путь — лобби, партия до конца через
 * клики по UI, сцены рулетки у всех троих одновременно, перезагрузка
 * страницы посреди партии (восстановление сессии), финальный экран с одним
 * и тем же победителем, рестарт от хоста и отказ четвёртого игрока.
 *
 * Запуск: node scripts/online-players.mjs  (перед этим: npm run build)
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const PORT = 8416;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = "shots/online-players";
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
    await delay(200);
  }
  throw new Error(`server not healthy: ${serverLog}`);
}

const browser = await chromium.launch({
  args: [
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
  ],
});

/** Живой игрок: свой контекст браузера со своим именем в localStorage. */
async function makePlayer(name, characterId) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(
    ([playerName, character]) => {
      if (!localStorage.getItem("liars-bar:settings:v1")) {
        localStorage.setItem(
          "liars-bar:settings:v1",
          JSON.stringify({
            playerName,
            characterId: character,
            difficulty: "normal",
            botCount: 3,
            variant: "classic",
            muted: true,
            timerEnabled: true,
            turnSeconds: 30,
            playWithBots: false,
          }),
        );
      }
    },
    [name, characterId],
  );
  const page = await ctx.newPage();
  const player = { name, ctx, page, errors: [] };
  page.on("pageerror", (e) => player.errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") player.errors.push(`console: ${m.text()}`);
  });
  return player;
}

const shot = async (player, tag) =>
  player.page.screenshot({ path: `${OUT}/${tag}-${player.name}.png` }).catch(() => {});

const bodyText = (page) => page.evaluate(() => document.body.innerText);

async function textWithin(page, needle, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await bodyText(page)).includes(needle)) return true;
    await delay(250);
  }
  return false;
}

/** Кладёт первую легальную карту через UI; true — ход сделан. */
async function playAnyCardUI(page) {
  const slots = page.locator(".hand__slot .playing-card");
  const count = await slots.count();
  const btn = page.getByRole("button", { name: /^Положить/ });
  for (let i = 0; i < count; i += 1) {
    await slots.nth(i).click();
    await page.waitForTimeout(200);
    if (!(await btn.isDisabled())) {
      await btn.click();
      return true;
    }
  }
  return false;
}

/** Полная сцена рулетки глазами всех живых игроков. */
async function observeRouletteUI(players, index) {
  for (const player of players) {
    await player.page.waitForSelector(".overlay--roulette", { timeout: 20000 });
  }
  console.log(`  рулетка №${index}: открыта у всех`);

  const outcomes = new Map();
  for (const player of players) {
    await player.page.waitForSelector('.overlay--roulette[data-stage="result"]', {
      timeout: 45000,
    });
    const outcome = await player.page
      .locator(".overlay--roulette")
      .getAttribute("data-outcome");
    outcomes.set(player.name, outcome);
  }
  const unique = [...new Set(outcomes.values())];
  if (unique.length !== 1) note(`Исходы разошлись: ${JSON.stringify([...outcomes.entries()])}`);
  if (unique[0] === "pending") note("Исход остался pending на стадии result");
  console.log(`  рулетка №${index}: исход ${unique[0]} у всех`);

  for (const player of players) {
    await player.page.waitForFunction(
      () => !document.querySelector(".overlay--roulette"),
      { timeout: 30000 },
    );
  }
  console.log(`  рулетка №${index}: закрыта у всех`);
  await shot(players[0], `roulette-${index}`);
  return unique[0];
}

try {
  await waitForServer();

  // ---------- Лобби: трое живых игроков ----------
  const host = await makePlayer("Анна", "foxy");
  const guestB = await makePlayer("Борис", "gerk");
  const guestV = await makePlayer("Вера", "cupcake");
  const players = [host, guestB, guestV];

  await host.page.goto(BASE);
  await host.page.waitForTimeout(700);
  await host.page.getByRole("button", { name: "Создать комнату" }).click();
  await host.page.waitForSelector(".room-code strong", { timeout: 20000 });
  const code = (await host.page.locator(".room-code strong").innerText()).trim();
  console.log("room code:", code);

  for (const guest of [guestB, guestV]) {
    await guest.page.goto(`${BASE}/?room=${code}`);
    await guest.page.waitForSelector(".online-lobby", { timeout: 15000 });
  }
  if (!(await textWithin(host.page, "За столом 3/4", 10000))) {
    note("Хост не увидел состав 3/4 в лобби");
  }
  await shot(host, "lobby");

  await host.page.getByRole("button", { name: "Дьявол" }).click();
  await host.page.getByRole("button", { name: "Без таймера" }).click();
  await host.page.getByRole("button", { name: "Начать игру" }).click();
  for (const player of players) {
    await player.page.waitForSelector(".hand .playing-card", { timeout: 25000 });
  }
  console.log("партия началась у троих");

  // ---------- Партия через UI до конца ----------
  // Единый опрос фаз: финал, рулетка (очередь стрелков держит стол надолго —
  // в ней никто не ходит), чей-то ход. Никаких узких ожиданий одного текста.
  let roulettes = 0;
  let reloadDone = false;
  let gameover = false;
  let lastProgress = Date.now();
  const deadline = Date.now() + 8 * 60 * 1000;

  while (!gameover && Date.now() < deadline) {
    let progressed = false;

    // 1) Финал? innerText отражает CSS-регистр, сравниваем без учёта регистра.
    let overPage = null;
    for (const player of players) {
      const text = (await bodyText(player.page)).toLowerCase();
      if (text.includes("победитель партии") || text.includes("победителей нет")) {
        overPage = player;
        break;
      }
    }
    if (overPage) {
      gameover = true;
      progressed = true;
    }

    // 2) Сцена рулетки у кого-либо — наблюдаем её всеми.
    if (!gameover) {
      let inRoulette = null;
      for (const player of players) {
        if (await player.page.$(".overlay--roulette")) {
          inRoulette = player;
          break;
        }
      }
      if (inRoulette) {
        roulettes += 1;
        await observeRouletteUI(players, roulettes);
        progressed = true;

        // Перезагрузка страницы посреди партии: не в свой ход, после рулетки.
        if (!reloadDone) {
          let candidate = null;
          for (const player of [guestB, guestV]) {
            if (!(await bodyText(player.page)).includes("Ваш ход")) {
              candidate = player;
              break;
            }
          }
          if (candidate) {
            reloadDone = true;
            console.log(`  перезагрузка страницы: ${candidate.name}`);
            const url = candidate.page.url();
            await candidate.page.reload();
            await candidate.page.waitForSelector(".hand .playing-card", { timeout: 25000 });
            await candidate.page.waitForFunction(
              () => !document.querySelector(".online-reconnect"),
              { timeout: 15000 },
            );
            if (candidate.page.url() !== url) note(`${candidate.name}: URL изменился после перезагрузки`);
            console.log(`  ${candidate.name}: сессия восстановлена, место сохранено`);
            await shot(candidate, "reloaded");
          }
        }
      }
    }

    // 3) Чей-то ход: действуем через UI.
    if (!gameover && !progressed) {
      let active = null;
      for (const player of players) {
        if ((await bodyText(player.page)).includes("Ваш ход")) {
          active = player;
          break;
        }
      }
      if (active) {
        const danger = active.page.locator(".btn--danger");
        if (!(await danger.isDisabled())) {
          await danger.click();
        } else if (!(await playAnyCardUI(active.page))) {
          note(`${active.name}: ни обвинение, ни выкладка недоступны в свой ход`);
          await shot(active, "no-moves");
        }
        progressed = true;
        await delay(400);
      }
    }

    if (progressed) lastProgress = Date.now();
    else if (Date.now() - lastProgress > 90_000) {
      note("Партия не меняется 90 с");
      for (const player of players) await shot(player, "stuck");
      break;
    } else {
      await delay(300);
    }
  }
  if (!gameover) note("Партия не доиграна до конца за отведённое время");

  // ---------- Финал: один победитель у всех ----------
  if (gameover) {
    const winners = new Map();
    for (const player of players) {
      await player.page.waitForSelector(".result__winnername", { timeout: 30000 });
      const name = (await player.page.locator(".result__winnername").innerText()).trim();
      winners.set(player.name, name);
      await shot(player, "final");
    }
    const uniqueWinners = [...new Set(winners.values())];
    console.log("финальные карточки:", JSON.stringify([...winners.entries()]));
    if (uniqueWinners.length !== 1) {
      note(`Победитель разошёлся между клиентами: ${JSON.stringify([...winners.entries()])}`);
    }

    // ---------- Рестарт от хоста ----------
    const restart = host.page.getByRole("button", { name: /Сыграть ещё раз/ });
    if (!(await restart.count())) {
      note("У хоста нет кнопки рестарта после финала");
    } else {
      await restart.click();
      for (const player of players) {
        await player.page.waitForSelector(".hand .playing-card", { timeout: 30000 });
      }
      console.log("рестарт от хоста: новая партия у всех");
      await shot(host, "restarted");
    }
  }

  // ---------- Четвёртый игрок в идущую партию ----------
  {
    const late = await makePlayer("Гоша", "toar");
    let wsOpens = 0;
    late.page.on("websocket", (ws) => {
      if (ws.url().includes("/ws")) wsOpens += 1;
    });
    await late.page.goto(`${BASE}/?room=${code}`);
    const alert = late.page.locator('[role="alert"]');
    await alert.waitFor({ timeout: 10000 });
    const message = (await alert.innerText()).trim().split("\n")[0];
    console.log(`четвёртый игрок: отказ «${message}»`);
    await late.page.waitForFunction(
      () => document.querySelector(".connection-badge")?.classList.contains("is-disconnected"),
      { timeout: 8000 },
    );
    await delay(4000);
    if (wsOpens > 3) note(`Четвёртый клиент в петле переподключений: ${wsOpens} соединений`);
    await shot(late, "late-refused");
    await late.ctx.close();
  }

  // ---------- Гигиена вёрстки и консоли ----------
  for (const player of [...players]) {
    const overflow = await player.page.evaluate(() => {
      const doc = document.documentElement;
      return doc.scrollWidth - doc.clientWidth;
    });
    if (overflow > 1) note(`${player.name}: горизонтальное переполнение ${overflow}px`);
    for (const error of player.errors) note(`${player.name}: ${error}`);
  }

  for (const player of players) await player.ctx.close();
} catch (error) {
  note(String(error?.stack ?? error?.message ?? error));
} finally {
  await browser.close();
  try {
    process.platform === "win32"
      ? spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"])
      : server.kill();
  } catch {}
}

console.log(
  problems.length
    ? `\nПРОБЛЕМЫ (${problems.length}):`
    : `\nТрое живых игроков: полный цикл сетевой партии пройден без ошибок.`,
);
for (const problem of problems) console.log(` - ${problem}`);
if (problems.length) process.exitCode = 1;
