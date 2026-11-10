import type {
  Ack,
  ClientEventInput,
  ClientEventName,
  ClientEventResults,
  ClientToServerEvents,
  ErrorCode,
  ServerToClientEvents,
} from '@dubparty/shared';
import { io, type Socket } from 'socket.io-client';

export class ApiErr extends Error {
  readonly code: ErrorCode | 'TIMEOUT' | 'NETWORK';

  constructor(code: ApiErr['code'], message?: string) {
    super(message ?? code);
    this.name = 'ApiErr';
    this.code = code;
  }
}

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  autoConnect: false,
  transports: ['websocket', 'polling'],
  reconnectionDelay: 500,
  reconnectionDelayMax: 4000,
});

/** Отправляет событие и ждёт ответа сервера; ошибки превращаются в исключения с кодом. */
export function request<E extends ClientEventName>(
  event: E,
  ...args: undefined extends ClientEventInput<E>
    ? [payload?: ClientEventInput<E>]
    : [payload: ClientEventInput<E>]
): Promise<ClientEventResults[E]> {
  return new Promise((resolve, reject) => {
    // Сервер недоступен — говорим об этом сразу, а не после десятисекундного ожидания ответа.
    let settled = false;
    const onConnectError = () => {
      if (settled) return;
      settled = true;
      reject(new ApiErr('NETWORK'));
    };
    if (!socket.connected) {
      socket.once('connect_error', onConnectError);
      socket.connect();
    }
    const timed = socket.timeout(10_000) as unknown as {
      emit(
        event: string,
        payload: unknown,
        ack: (err: Error | null, result?: Ack<ClientEventResults[E]>) => void,
      ): void;
    };
    timed.emit(event, args[0] ?? null, (err, result) => {
      socket.off('connect_error', onConnectError);
      if (settled) return;
      settled = true;
      if (err || !result) reject(new ApiErr('TIMEOUT'));
      else if (result.ok) resolve(result.data);
      else reject(new ApiErr(result.error.code, result.error.message));
    });
  });
}
