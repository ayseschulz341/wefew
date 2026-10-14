import type { CharacterId, GameState, GameVariant } from "../game/types";

export interface RoomSettings {
  variant: GameVariant;
  turnSeconds: 0 | 15 | 30 | 45 | 60;
}

export interface LobbyPlayer {
  id: string;
  name: string;
  characterId: CharacterId | null;
  isHost: boolean;
  connected: boolean;
}

export type ServerEvent =
  | {
      type: "connected";
      playerId: string;
      roomCode: string;
      sessionId: string;
      isHost: boolean;
    }
  | {
      type: "lobby_state";
      roomCode: string;
      players: LobbyPlayer[];
      ownerId: string | null;
      gameInProgress: boolean;
      settings: RoomSettings;
    }
  | { type: "game_state"; state: GameState; turnEndsAt?: number | null }
  | { type: "action_ack"; actionId: string }
  | { type: "action_rejected"; reason: string; actionType?: string; actionId?: string }
  | { type: "player_kicked"; roomCode: string }
  | { type: "room_closed"; roomCode: string; reason: string }
  | {
      type: "error";
      message: string;
      /** Фатальная ошибка контекста (например, отказ в identify): соединение закрыто. */
      fatal?: boolean;
    };

export type ClientMessage =
  | {
      type: "identify";
      roomCode: string;
      playerName: string;
      characterId: CharacterId;
      playerId?: string;
      sessionId?: string;
      wantsHost?: boolean;
    }
  | { type: "update_settings"; variant: GameVariant; turnSeconds: number; actionId: string }
  | { type: "start_game"; actionId: string }
  | {
      type: "player_action";
      action:
        | { type: "play_cards"; cardIds: string[] }
        | { type: "challenge" };
      actionId: string;
    }
  | { type: "kick_player"; playerId: string; actionId: string }
  | { type: "request_sync" }
  | { type: "leave_room" };
