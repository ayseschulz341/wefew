export const ROOM_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

export function normalizeRoomCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

/** Кириллица, похожая на латиницу кода: ввод с русской раскладки. */
const CYRILLIC_LOOKALIKES: Record<string, string> = {
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H",
  О: "O", Р: "P", С: "C", Т: "T", У: "Y", Х: "X",
};

/**
 * Код комнаты из поля ввода. Принимает и вставленную ссылку-приглашение:
 * раньше из неё получалось «HTTPS» вместо кода.
 */
export function extractRoomCode(value: string): string {
  const fromLink = /[?&]room=([^&#\s]*)/i.exec(value);
  let raw = value;
  if (fromLink) {
    try {
      raw = decodeURIComponent(fromLink[1]);
    } catch {
      raw = fromLink[1];
    }
  }
  const latin = raw
    .toUpperCase()
    .replace(/[А-ЯЁ]/g, (letter) => CYRILLIC_LOOKALIKES[letter] ?? letter);
  return normalizeRoomCode(latin);
}

export function isValidRoomCode(value: string): boolean {
  return ROOM_CODE_PATTERN.test(normalizeRoomCode(value));
}

export function createJoinUrl(roomCode: string): string {
  const configured = import.meta.env.VITE_PUBLIC_APP_URL?.trim();
  const base = configured || window.location.origin + window.location.pathname;
  const url = new URL(base, window.location.href);
  url.search = "";
  url.searchParams.set("room", normalizeRoomCode(roomCode));
  return url.toString();
}

export function roomCodeFromLocation(): string | null {
  const code = normalizeRoomCode(new URLSearchParams(window.location.search).get("room") ?? "");
  return isValidRoomCode(code) ? code : null;
}
