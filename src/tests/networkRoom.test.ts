import { describe, expect, it } from "vitest";
import { Room } from "../../server/room";

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
});
