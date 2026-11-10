export const ERROR_CODES = [
  'VALIDATION',
  'RATE_LIMITED',
  'NOT_FOUND',
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'GAME_IN_PROGRESS',
  'NOT_IN_ROOM',
  'FORBIDDEN',
  'BAD_PHASE',
  'NOT_ENOUGH_PLAYERS',
  'PACK_UNAVAILABLE',
  'SESSION_EXPIRED',
  'SELF_VOTE',
  'LIMIT_REACHED',
  'UNSUPPORTED_MEDIA',
  'TOO_LARGE',
  'TOO_LONG',
  'PROCESSING_FAILED',
  'SERVER_BUSY',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  code: ErrorCode;
  message: string;
}

export type Ack<T = undefined> = { ok: true; data: T } | { ok: false; error: ApiError };
