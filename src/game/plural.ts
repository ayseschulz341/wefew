/** Русское согласование с числом: plural(n, "карта", "карты", "карт"). */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = Math.abs(n) % 10;
  const mod100 = Math.abs(n) % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Локальный игрок по умолчанию зовётся «Вы» — для него нужны формы второго лица. */
export function isYou(name: string): boolean {
  return name.trim().toLowerCase() === "вы";
}
