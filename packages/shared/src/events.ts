import type { z } from 'zod';
import type { Ack } from './errors';
import {
  emptySchema,
  playbackControlSchema,
  playerRefSchema,
  playerUpdateSchema,
  roomCreateSchema,
  roomJoinSchema,
  sessionResumeSchema,
  settingsUpdateSchema,
  timeSyncSchema,
  voteCastSchema,
} from './schemas';
import type { PlaybackState, RoomState, TakeStatus } from './state';

/** Схемы всех событий client → server. Сервер валидирует по ним каждое сообщение. */
export const clientEventSchemas = {
  'room:create': roomCreateSchema,
  'room:join': roomJoinSchema,
  'session:resume': sessionResumeSchema,
  'room:leave': emptySchema,
  'player:update': playerUpdateSchema,
  'lobby:updateSettings': settingsUpdateSchema,
  'lobby:kick': playerRefSchema,
  'lobby:transferHost': playerRefSchema,
  'game:start': emptySchema,
  'playback:control': playbackControlSchema,
  'vote:cast': voteCastSchema,
  'phase:continue': emptySchema,
  'game:restart': emptySchema,
  'time:sync': timeSyncSchema,
} as const;

export type ClientEventName = keyof typeof clientEventSchemas;
export type ClientEventInput<E extends ClientEventName> = z.input<(typeof clientEventSchemas)[E]>;
export type ClientEventPayload<E extends ClientEventName> = z.output<
  (typeof clientEventSchemas)[E]
>;

export interface JoinResult {
  roomCode: string;
  playerId: string;
  /** Токен сессии: клиент хранит его в localStorage и предъявляет при переподключении. */
  sessionToken: string;
  state: RoomState;
}

export interface ClientEventResults {
  'room:create': JoinResult;
  'room:join': JoinResult;
  'session:resume': JoinResult;
  'room:leave': null;
  'player:update': null;
  'lobby:updateSettings': null;
  'lobby:kick': null;
  'lobby:transferHost': null;
  'game:start': null;
  'playback:control': null;
  'vote:cast': null;
  'phase:continue': null;
  'game:restart': null;
  'time:sync': { clientTime: number; serverTime: number };
}

export type ClientToServerEvents = {
  [E in ClientEventName]: (
    payload: ClientEventInput<E>,
    ack: (result: Ack<ClientEventResults[E]>) => void,
  ) => void;
};

export type RoomClosedReason = 'kicked' | 'closed' | 'replaced' | 'expired';

export interface ServerToClientEvents {
  'room:state': (state: RoomState) => void;
  'playback:sync': (state: PlaybackState) => void;
  'take:status': (payload: { roundIndex: number; status: TakeStatus; errorCode?: string }) => void;
  'room:closed': (payload: { reason: RoomClosedReason }) => void;
  'server:shutdown': () => void;
}
