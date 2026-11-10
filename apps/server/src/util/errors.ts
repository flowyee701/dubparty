import type { ApiError, ErrorCode } from '@dubparty/shared';

const HTTP_STATUS: Partial<Record<ErrorCode, number>> = {
  VALIDATION: 400,
  RATE_LIMITED: 429,
  NOT_FOUND: 404,
  ROOM_NOT_FOUND: 404,
  ROOM_FULL: 409,
  GAME_IN_PROGRESS: 409,
  NOT_IN_ROOM: 401,
  SESSION_EXPIRED: 401,
  FORBIDDEN: 403,
  BAD_PHASE: 409,
  NOT_ENOUGH_PLAYERS: 409,
  PACK_UNAVAILABLE: 409,
  SELF_VOTE: 400,
  LIMIT_REACHED: 429,
  UNSUPPORTED_MEDIA: 415,
  TOO_LARGE: 413,
  TOO_LONG: 422,
  PROCESSING_FAILED: 422,
  SERVER_BUSY: 503,
  INTERNAL: 500,
};

/** Ожидаемая ошибка: её код и сообщение можно показать клиенту. */
export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'AppError';
    this.code = code;
  }

  get statusCode(): number {
    return HTTP_STATUS[this.code] ?? 500;
  }

  toJSON(): ApiError {
    return { code: this.code, message: this.message };
  }
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof AppError) return err.toJSON();
  return { code: 'INTERNAL', message: 'Internal error' };
}
