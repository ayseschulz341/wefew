interface StoredRoomSession {
  roomCode: string;
  playerId: string;
  sessionId: string;
  savedAt: number;
}

const KEY = "liars-bar:online-session:v1";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function loadRoomSession(roomCode: string): StoredRoomSession | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<StoredRoomSession> | null;
    if (
      !value ||
      value.roomCode !== roomCode ||
      typeof value.playerId !== "string" ||
      typeof value.sessionId !== "string" ||
      typeof value.savedAt !== "number" ||
      !(Date.now() - value.savedAt <= MAX_AGE_MS)
    ) {
      return null;
    }
    return value as StoredRoomSession;
  } catch {
    return null;
  }
}

export function saveRoomSession(value: Omit<StoredRoomSession, "savedAt">): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...value, savedAt: Date.now() }));
  } catch {
    // В приватном режиме браузер может запретить localStorage.
  }
}

export function clearRoomSession(roomCode?: string): void {
  try {
    if (!roomCode) {
      localStorage.removeItem(KEY);
      return;
    }
    const current = JSON.parse(localStorage.getItem(KEY) ?? "null") as StoredRoomSession | null;
    if (current?.roomCode === roomCode) localStorage.removeItem(KEY);
  } catch {
    // Повреждённая запись удаляется; заблокированное хранилище бросает и здесь,
    // а выход из комнаты не должен из-за этого обрываться.
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* хранилище недоступно */
    }
  }
}
