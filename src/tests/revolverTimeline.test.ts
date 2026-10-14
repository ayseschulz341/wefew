import { describe, expect, it } from "vitest";
import {
  buildRevolverTimes,
  makeSpinTravel,
  poseAt,
  revolverSoundEvents,
  stageAnchor,
  stageOfTime,
} from "../game/revolverTimeline";
import { rouletteStageMs, rouletteTimes } from "../game/roulettePresentation";

const SCENARIO = {
  loadOrder: [1, 2, 3, 4, 5],
  startAngle: 0,
  spinTravel: 4 * 360 + 30,
  fired: true,
};

describe("сетка времени сцены — 1-в-1 с оригинальной анимацией", () => {
  it("воспроизводит опорные метки демо для одного патрона", () => {
    const T = buildRevolverTimes(1);
    expect(T.latchAt).toBe(500);
    expect(T.openAt).toBe(750);
    expect(T.openDur).toBe(720);
    expect(T.loadAt).toBe(1720);
    expect(T.loadStep).toBe(380);
    expect(T.loadDur).toBe(460);
    expect(T.closeStart).toBe(2530);
    expect(T.closeDur).toBe(420);
    expect(T.spinStart).toBe(3400);
    expect(T.spinDur).toBe(2600);
    expect(T.cockStart).toBe(6550);
    expect(T.cockDur).toBe(380);
    expect(T.fireStart).toBe(9230);
    expect(T.hit).toBe(9510);
    expect(T.end).toBe(12110);
  });

  it("заряжание шести патронов растягивает сцену как в демо", () => {
    const T6 = rouletteTimes(6);
    expect(T6.closeStart).toBe(4430);
    expect(T6.spinStart).toBe(5300);
    expect(T6.cockStart).toBe(8450);
    expect(T6.fireStart).toBe(11130);
    expect(T6.hit).toBe(11410);
    expect(T6.end).toBe(14010);
  });

  it("выдерживает увеличенную паузу перед спуском", () => {
    for (let pull = 1; pull <= 6; pull += 1) {
      const T = rouletteTimes(pull);
      expect(T.fireStart - (T.cockStart + T.cockDur)).toBe(2300);
    }
  });

  it("удар курка происходит после спуска, а сцена заканчивается хвостом демо", () => {
    for (let pull = 1; pull <= 6; pull += 1) {
      const T = rouletteTimes(pull);
      expect(T.hit - T.fireStart).toBe(280);
      expect(T.end - T.hit).toBe(2600);
    }
  });

  it("стадии времени соответствуют новому порядку сцены", () => {
    const T = buildRevolverTimes(1);
    expect(stageOfTime(0, T)).toBe("load");
    expect(stageOfTime(T.closeStart + 10, T)).toBe("close");
    expect(stageOfTime(T.spinStart + 10, T)).toBe("spin");
    expect(stageOfTime(T.cockStart + 10, T)).toBe("cock");
    expect(stageOfTime(T.fireStart + 10, T)).toBe("fire");
    expect(stageOfTime(T.hit + 600, T)).toBe("result");
  });

  it("длительности стадий стыкуются без зазоров", () => {
    for (let pull = 1; pull <= 6; pull += 1) {
      const T = rouletteTimes(pull);
      const s = rouletteStageMs(pull);
      const total = Object.values(s).reduce((a, b) => a + b, 0);
      expect(total).toBe(T.end);
    }
  });
});

describe("случайный угол остановки барабана", () => {
  it("никогда не останавливается ровно на каморе", () => {
    let seed = 1;
    const rng = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 200; i += 1) {
      const travel = makeSpinTravel(rng);
      expect(travel % 60).not.toBe(0);
      expect(travel % 60).toBeGreaterThanOrEqual(15);
      expect(travel % 60).toBeLessThanOrEqual(45);
    }
  });

  it("крутит барабан на несколько полных оборотов", () => {
    const travel = makeSpinTravel(() => 0);
    expect(travel).toBeGreaterThanOrEqual(4 * 360);
    expect(travel).toBeLessThan(7 * 360);
  });
});

describe("поза револьвера по времени", () => {
  // Сетка под число патронов сценария, чтобы укладка успевала до закрытия.
  const T = buildRevolverTimes(SCENARIO.loadOrder.length);

  it("в начале сцены барабан закрыт, курок спущен", () => {
    const p = poseAt(0, SCENARIO, T);
    expect(p.latch).toBe(0);
    expect(p.cylOpen).toBe(0);
    expect(p.hammer).toBe(0);
    expect(p.flash).toBe(0);
    expect(p.bullets.every((b) => b === 0)).toBe(true);
  });

  it("перед захлопыванием барабан откинут и все патроны уложены", () => {
    const p = poseAt(T.closeStart - 60, SCENARIO, T);
    expect(p.cylOpen).toBe(1);
    SCENARIO.loadOrder.forEach((slot) => {
      expect(p.bullets[slot]).toBe(1);
    });
    // Пустые гнёзда остаются пустыми.
    expect(p.bullets[0]).toBe(0);
  });

  it("раскрутка идёт на закрытом барабане и не возвращается в открытый вид", () => {
    const mid = poseAt(T.spinStart + T.spinDur / 2, SCENARIO, T);
    const end = poseAt(T.spinStart + T.spinDur, SCENARIO, T);
    expect(mid.cylOpen).toBe(0);
    expect(end.cylOpen).toBe(0);
    expect(mid.spin).toBeGreaterThan(0);
    expect(mid.spin).toBeLessThan(SCENARIO.spinTravel);
    expect(end.spin).toBeCloseTo(SCENARIO.startAngle + SCENARIO.spinTravel, 6);
    const after = poseAt(T.end - 10, SCENARIO, T);
    expect(after.spin).toBe(end.spin);
    expect(after.spinVel).toBe(0);
    expect(after.cylOpen).toBe(0);
  });

  it("курок взводится после раскрутки и падает в момент удара", () => {
    expect(poseAt(T.spinStart + T.spinDur + 100, SCENARIO, T).hammer).toBe(0);
    expect(poseAt(T.fireStart - 100, SCENARIO, T).hammer).toBe(1);
    expect(poseAt(T.hit + 80, SCENARIO, T).hammer).toBeLessThan(1);
  });

  it("выстрел даёт вспышку и отдачу, осечка — только тряску", () => {
    const bang = poseAt(T.hit + 30, SCENARIO, T);
    expect(bang.flash).toBeGreaterThan(0);
    expect(bang.recoil).toBeGreaterThan(0);
    expect(bang.shake).toBe(0);

    const dry = poseAt(T.hit + 30, { ...SCENARIO, fired: false }, T);
    expect(dry.flash).toBe(0);
    expect(dry.recoil).toBe(0);
    expect(dry.shake).not.toBe(0);
  });

  it("опорные кадры статичных стадий согласованы с их длительностями", () => {
    for (const stage of ["load", "close", "spin", "cock", "fire", "result"] as const) {
      const t = stageAnchor(stage, T);
      expect(stageOfTime(t, T)).toBe(stage);
    }
  });
});

describe("звуковые события сцены", () => {
  const T = buildRevolverTimes(1);

  it("отсортированы и покрывают весь цикл механизма", () => {
    const events = revolverSoundEvents(SCENARIO, T);
    const kinds = events.map((e) => e.kind);
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i].time).toBeGreaterThanOrEqual(events[i - 1].time);
    }
    expect(kinds).toContain("latch");
    expect(kinds).toContain("open");
    expect(kinds.filter((k) => k === "load")).toHaveLength(SCENARIO.loadOrder.length);
    expect(kinds).toContain("close");
    expect(kinds.filter((k) => k === "cock")).toHaveLength(2);
    expect(kinds).toContain("trigger");
    // Терминальный исход (bang/click) сцена получает отдельным вызовом.
    expect(kinds).not.toContain("bang");
    expect(kinds).not.toContain("click");
  });

  it("трещотка барабана не чаще 28 мс и все щелчки внутри раскрутки", () => {
    const events = revolverSoundEvents(SCENARIO, T).filter((e) => e.kind === "tick");
    expect(events.length).toBeGreaterThan(10);
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i].time - events[i - 1].time).toBeGreaterThanOrEqual(28);
    }
    for (const e of events) {
      expect(e.time).toBeGreaterThanOrEqual(T.spinStart);
      expect(e.time).toBeLessThanOrEqual(T.spinStart + T.spinDur);
    }
  });
});
