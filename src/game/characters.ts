import type {
  CharacterDef,
  CharacterId,
  Personality,
} from "./types";

/**
 * Завсегдатаи бара с собственными голосовыми файлами. Характер задаёт
 * стиль игры бота, а текстовые реплики — его поведение за столом.
 */
export const CHARACTERS: CharacterDef[] = [
  {
    id: "scubby",
    name: "Scubby",
    title: "хитрая крольчиха",
    kind: "rabbit",
    persona: { aggression: 0.32, honesty: 0.78, chaos: 0.25, bravado: 0.25 },
    lines: {
      play: ["Кладу, кладу…", "Только не смотри так."],
      bluff: ["Э-это точно то, что нужно.", "Всё честно, клянусь."],
      challenge: ["Я… я не верю!", "Врёшь ведь!"],
      caught: ["Ой. Ой-ой.", "Зачем я это сделала…"],
      survived: ["Жива! Я жива!", "Сердце в пятках."],
    },
  },
  {
    id: "foxy",
    name: "Foxy",
    title: "лиса-провокатор",
    kind: "fox",
    persona: { aggression: 0.58, honesty: 0.42, chaos: 0.5, bravado: 0.65 },
    lines: {
      play: ["Смотри внимательно.", "Как по учебнику."],
      bluff: ["Чистая правда, дорогуша.", "Разве я когда-то лгала?"],
      challenge: ["Попалась, мышка.", "Открывай, красавчик."],
      caught: ["Пф. Бывает.", "Один раз не считается."],
      survived: ["Мне идёт этот револьвер.", "Удача любит наглых."],
    },
  },
  {
    id: "bristle",
    name: "Bristle",
    title: "ворчливый вепрь",
    kind: "boar",
    persona: { aggression: 0.72, honesty: 0.6, chaos: 0.3, bravado: 0.6 },
    lines: {
      play: ["Держи.", "Хрр. Мой ход."],
      bluff: ["Не нравится — вскрывай.", "Всё как надо, хрр."],
      challenge: ["Брехня!", "Показывай, что положил!"],
      caught: ["Хрр… ладно.", "Достал ты меня."],
      survived: ["Меня так не убьёшь.", "Хрр! Дальше."],
    },
  },
  {
    id: "toar",
    name: "Toar",
    title: "угрюмый бык",
    kind: "bull",
    persona: { aggression: 0.44, honesty: 0.86, chaos: 0.15, bravado: 0.4 },
    lines: {
      play: ["Ход сделан.", "Молча."],
      bluff: ["Так надо.", "Не спрашивай."],
      challenge: ["Ложь.", "Вскрывай."],
      caught: ["Мгм.", "Заслужил."],
      survived: ["Ещё не сегодня.", "Дальше."],
    },
  },
  {
    id: "cupcake",
    name: "Cupcake",
    title: "хитрый и весёлый хряк",
    kind: "pig",
    persona: { aggression: 0.3, honesty: 0.52, chaos: 0.62, bravado: 0.55 },
    lines: {
      play: ["Держите, друзья!", "Хорошая карта."],
      bluff: ["Я бы не обманул, ну!", "Честно-пречестно!"],
      challenge: ["Эй, врунишка!", "А вот и не верю."],
      caught: ["Ну какой же я глупый.", "Ой, попался."],
      survived: ["Пусто! Вот это удача.", "Жив, приятели."],
    },
  },
  {
    id: "gerk",
    name: "Gerk",
    title: "крыса-калькулятор",
    kind: "rat",
    persona: { aggression: 0.62, honesty: 0.66, chaos: 0.18, bravado: 0.45 },
    lines: {
      play: ["По расчёту.", "Вероятность на моей стороне."],
      bluff: ["Статистика не против.", "Проверяемо. Но не советую."],
      challenge: ["Арифметика не сходится.", "Столько их не бывает."],
      caught: ["Погрешность модели.", "Учтено на будущее."],
      survived: ["Пять шестых. Ожидаемо.", "Расчёт верен."],
    },
  },
];

export const CHARACTER_BY_ID = new Map<CharacterId, CharacterDef>(
  CHARACTERS.map((c) => [c.id, c]),
);

export const ALL_CHARACTER_IDS: CharacterId[] = CHARACTERS.map((c) => c.id);

export const DEFAULT_PERSONA: Personality = {
  aggression: 0.5,
  honesty: 0.62,
  chaos: 0.35,
  bravado: 0.5,
};

/** Случайная реплика персонажа по поводу. */
export function botLine(
  characterId: CharacterId | null,
  kind: keyof CharacterDef["lines"],
  rng: () => number = Math.random,
): string | null {
  if (!characterId) return null;
  const def = CHARACTER_BY_ID.get(characterId);
  if (!def) return null;
  const pool = def.lines[kind];
  if (!pool || pool.length === 0) return null;
  return pool[Math.floor(rng() * pool.length)] ?? pool[0];
}
