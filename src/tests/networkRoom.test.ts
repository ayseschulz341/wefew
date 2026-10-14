import { afterEach, describe, expect, it, vi } from "vitest";
import { AWAY_TURN_MS, Room } from "../../server/room";
import { personalState } from "../../server/projection";

afterEach(() => {
  vi.useRealTimers();
});

describe("безопасность сетевой комнаты", () => {
  it("не восстанавливает чужое место только по публичному playerId", () => {
    const room = new Room("ABC234");
    const host = room.identify("Хозяин", "foxy", undefined, undefined, true);
    const attacker = room.identify(
      "Самозванец",
      "gerk",
      host.playerId,
      undefined,
      false,
    );

    expect(attacker.playerId).not.toBe(host.playerId);
    expect(attacker.isHost).toBe(false);
    expect(room.players.get(host.playerId)?.name).toBe("Хозяин");
  });

  it("не начинает матч с отключённым вторым игроком", () => {
    const room = new Room("ABC234");
    const host = room.identify("Хозяин", "foxy", undefined, undefined, true);
    const guest = room.identify("Гость", "cupcake", undefined, undefined, false);
    room.setConnected(guest.playerId, false);

    expect(() => room.start(host.playerId)).toThrow(/подключённых/);
  });

  it("изолирует подтверждённые actionId между игроками", () => {
    const room = new Room("ABC234");
    const host = room.identify("Хозяин", "foxy", undefined, undefined, true);
    const guest = room.identify("Гость", "cupcake", undefined, undefined, false);

    room.markProcessedAction(host.playerId, "same-id");

    expect(room.hasProcessedAction(host.playerId, "same-id")).toBe(true);
    expect(room.hasProcessedAction(guest.playerId, "same-id")).toBe(false);
  });

  it("передаёт права хоста подключённому игроку после выхода из матча", () => {
    const room = new Room("ABC234");
    const host = room.identify("Хозяин", "foxy", undefined, undefined, true);
    const guest = room.identify("Гость", "cupcake", undefined, undefined, false);
    const third = room.identify("Третий", "gerk", undefined, undefined, false);
    room.start(host.playerId);

    room.leave(host.playerId);

    expect(room.ownerId).toBe(guest.playerId);
    expect(room.players.get(guest.playerId)?.isHost).toBe(true);
    expect(room.players.get(host.playerId)?.connected).toBe(false);

    room.game!.phase = { kind: "gameover", winner: 1 };
    room.start(guest.playerId);

    expect(room.game?.players).toHaveLength(2);
    expect(room.game?.players.map((player) => player.name)).toEqual(["Гость", "Третий"]);
    expect(room.players.has(host.playerId)).toBe(false);
    expect(room.players.has(third.playerId)).toBe(true);
  });

  it("отключённый в лобби игрок не сдвигает места за столом", () => {
    const room = new Room("ABC234");
    const host = room.identify("Хозяин", "foxy", undefined, undefined, true);
    const ghost = room.identify("Призрак", "toar", undefined, undefined, false);
    const third = room.identify("Третий", "gerk", undefined, undefined, false);
    room.setConnected(ghost.playerId, false);

    room.start(host.playerId);

    expect(room.game?.players.map((player) => player.name)).toEqual(["Хозяин", "Третий"]);
    expect(room.seatOf(host.playerId)).toBe(0);
    expect(room.seatOf(third.playerId)).toBe(1);
    expect(room.seatOf(ghost.playerId)).toBe(-1);
    // Третий видит собственную руку, а не руку хозяина.
    const view = personalState(room.game!, room.seatOf(third.playerId));
    expect(view.players[0].name).toBe("Третий");
    expect(view.players[0].hand.map((card) => card.id)).toEqual(
      room.game!.players[1].hand.map((card) => card.id),
    );
    // Вернувшийся «призрак» не получает чужое место и не может ходить.
    room.identify("Призрак", "toar", undefined, ghost.sessionId, false);
    expect(room.seatOf(ghost.playerId)).toBe(-1);
    expect(() =>
      room.action(ghost.playerId, { type: "challenge" }),
    ).toThrow(/не участвуете/);
  });

  it("без таймера ход отключившегося игрока всё равно завершается", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const room = new Room("ABC234", { turnSeconds: 0 });
    const host = room.identify("Хозяин", "foxy", undefined, undefined, true);
    const guest = room.identify("Гость", "cupcake", undefined, undefined, false);
    room.start(host.playerId);
    const game = room.game!;
    const currentId = game.currentSeat === 0 ? host.playerId : guest.playerId;
    const current = game.currentSeat === 0 ? host : guest;
    expect(room.turnEndsAt).toBeNull();

    room.setConnected(currentId, false);
    expect(room.turnEndsAt).toBe(1_000_000 + AWAY_TURN_MS);

    // Повторные события не продлевают срок.
    vi.setSystemTime(1_005_000);
    room.setConnected(currentId === host.playerId ? guest.playerId : host.playerId, true);
    expect(room.turnEndsAt).toBe(1_000_000 + AWAY_TURN_MS);

    // Вернулся — снова без ограничения.
    room.identify(current.player.name, current.player.characterId, undefined, current.sessionId, false);
    expect(room.turnEndsAt).toBeNull();
  });

  it("отклоняет действие, отправленное для прошедшего хода", () => {
    const room = new Room("ABC234");
    const host = room.identify("Хозяин", "foxy", undefined, undefined, true);
    const guest = room.identify("Гость", "cupcake", undefined, undefined, false);
    room.start(host.playerId);
    const game = room.game!;
    const seatIds = [host.playerId, guest.playerId];
    const actor = seatIds[game.currentSeat];
    const card = game.players[game.currentSeat].hand[0];
    const staleTurn = room.turnId - 1;

    expect(() =>
      room.action(actor, { type: "play_cards", cardIds: [card.id] }, staleTurn),
    ).toThrow(/сменился/);
    room.action(actor, { type: "play_cards", cardIds: [card.id] }, room.turnId);
    expect(room.game!.pile).toHaveLength(1);
  });

  it("одинаковые имена получают номер", () => {
    const room = new Room("ABC234");
    room.identify("Foxy", "foxy", undefined, undefined, true);
    const twin = room.identify("foxy", "cupcake", undefined, undefined, false);
    expect(twin.player.name).toBe("foxy 2");
  });

  it("после окончания партии в комнату можно войти на реванш", () => {
    const room = new Room("ABC234");
    const host = room.identify("Хозяин", "foxy", undefined, undefined, true);
    room.identify("Гость", "cupcake", undefined, undefined, false);
    room.start(host.playerId);
    expect(() => room.identify("Опоздавший", "gerk")).toThrow(/уже идёт/);

    room.game!.phase = { kind: "gameover", winner: 0 };
    const late = room.identify("Опоздавший", "gerk");
    expect(room.seatOf(late.playerId)).toBe(-1);

    room.start(host.playerId);
    expect(room.game?.players.map((player) => player.name)).toEqual([
      "Хозяин",
      "Гость",
      "Опоздавший",
    ]);
  });
});
