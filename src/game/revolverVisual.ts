import { CHAMBERS } from "./types";

export type CartridgeState = "empty" | "live" | "spent";

export interface CartridgeLayoutOptions {
  pullNumber: number;
  activeSlot: number;
  fired: boolean;
  afterImpact: boolean;
}

const mod = (value: number, divisor: number) =>
  ((value % divisor) + divisor) % divisor;

/** Количество патронов визуально растёт вместе с номером спуска: от 1 до 6. */
export function cartridgeCountForPull(pullNumber: number): number {
  return Math.max(1, Math.min(CHAMBERS, Math.round(pullNumber)));
}

/**
 * Формирует честное состояние барабана: при осечке активное гнездо пустое,
 * при выстреле в нём находится боевой патрон, который после удара становится гильзой.
 */
export function createCartridgeLayout({
  pullNumber,
  activeSlot,
  fired,
  afterImpact,
}: CartridgeLayoutOptions): CartridgeState[] {
  const layout = Array.from<CartridgeState>({ length: CHAMBERS }).fill("empty");
  const count = cartridgeCountForPull(pullNumber);
  const normalizedActive = mod(activeSlot, CHAMBERS);
  const liveCount = fired ? count : Math.min(count, CHAMBERS - 1);
  const firstOffset = fired ? 0 : 1;

  for (let index = 0; index < liveCount; index += 1) {
    layout[mod(normalizedActive + firstOffset + index, CHAMBERS)] = "live";
  }

  if (fired && afterImpact) layout[normalizedActive] = "spent";
  return layout;
}
