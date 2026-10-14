export const ROOM_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

export function normalizeRoomCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
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
