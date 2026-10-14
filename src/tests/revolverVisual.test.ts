import { describe, expect, it } from "vitest";
import {
  cartridgeCountForPull,
  createCartridgeLayout,
} from "../game/revolverVisual";

describe("визуальный барабан револьвера", () => {
  it("показывает от одного до шести патронов по номеру спуска", () => {
    for (let pull = 1; pull <= 6; pull += 1) {
      const layout = createCartridgeLayout({
        pullNumber: pull,
        activeSlot: 0,
        fired: true,
        afterImpact: false,
      });
      expect(layout.filter((state) => state === "live")).toHaveLength(pull);
    }
  });

  it("при осечке оставляет активное гнездо пустым", () => {
    for (let pull = 1; pull <= 5; pull += 1) {
      const layout = createCartridgeLayout({
        pullNumber: pull,
        activeSlot: 3,
        fired: false,
        afterImpact: false,
      });
      expect(layout[3]).toBe("empty");
      expect(layout.filter((state) => state === "live")).toHaveLength(pull);
    }
  });

  it("после выстрела заменяет активный патрон стреляной гильзой", () => {
    const layout = createCartridgeLayout({
      pullNumber: 4,
      activeSlot: 2,
      fired: true,
      afterImpact: true,
    });

    expect(layout[2]).toBe("spent");
    expect(layout.filter((state) => state === "live")).toHaveLength(3);
    expect(layout.filter((state) => state !== "empty")).toHaveLength(4);
  });

  it("ограничивает счётчик физической ёмкостью барабана", () => {
    expect(cartridgeCountForPull(-10)).toBe(1);
    expect(cartridgeCountForPull(99)).toBe(6);
  });
});
