import { describe, expect, it } from "vitest";
import { isYou, plural } from "../game/plural";
import { extractRoomCode } from "../network/roomLinks";

describe("согласование с числом", () => {
  it("подбирает форму по последним цифрам", () => {
    const forms = (n: number) => plural(n, "карта", "карты", "карт");
    expect([0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 111].map(forms)).toEqual([
      "карт",
      "карта",
      "карты",
      "карты",
      "карт",
      "карт",
      "карт",
      "карт",
      "карта",
      "карты",
      "карт",
      "карт",
    ]);
  });

  it("узнаёт локальное «Вы» в любом регистре", () => {
    expect(isYou(" вы ")).toBe(true);
    expect(isYou("Вы")).toBe(true);
    expect(isYou("Вова")).toBe(false);
  });
});

describe("код комнаты из поля ввода", () => {
  it("принимает код как есть и приводит регистр", () => {
    expect(extractRoomCode("abc234")).toBe("ABC234");
  });

  it("достаёт код из вставленной ссылки-приглашения", () => {
    expect(extractRoomCode("https://bar.example/?room=XYZ789")).toBe("XYZ789");
    expect(extractRoomCode("https://bar.example/play?lang=ru&room=k7m2qa#top")).toBe("K7M2QA");
  });

  it("понимает похожие буквы с русской раскладки", () => {
    expect(extractRoomCode("АВС234")).toBe("ABC234");
  });
});
