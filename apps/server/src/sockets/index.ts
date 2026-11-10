import {
  clientEventSchemas,
  LIMITS,
  type Ack,
  type ClientEventName,
  type ClientEventPayload,
  type ClientEventResults,
  type ClientToServerEvents,
  type JoinResult,
  type ServerToClientEvents,
} from '@dubparty/shared';
import type { FastifyInstance } from 'fastify';
import { Server, type Socket } from 'socket.io';
import type { AppContext } from '../app';
import type { GameController } from '../game/controller';
import type { RoomManager } from '../game/manager';
import type { Room, RoomPlayer } from '../game/room';
import { AppError, toApiError } from '../util/errors';
import { TokenBucket } from '../util/rateLimit';

interface SocketData {
  roomCode?: string;
  playerId?: string;
}

type IoServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
type IoSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export function attachSockets(
  fastify: FastifyInstance,
  ctx: AppContext,
  manager: RoomManager,
  game: GameController,
): IoServer {
  const { config, logger } = ctx;
  const io: IoServer = new Server(fastify.server, {
    maxHttpBufferSize: LIMITS.socketPayloadBytes,
    pingInterval: 10_000,
    pingTimeout: 8_000,
    cors: { origin: config.corsOrigins.length > 0 ? config.corsOrigins : !config.isProd },
    serveClient: false,
  });

  manager.setTransport({
    state: (socketId, state) => io.to(socketId).emit('room:state', state),
    playback: (socketId, state) => io.to(socketId).emit('playback:sync', state),
    takeStatus: (socketId, payload) => io.to(socketId).emit('take:status', payload),
    closed: (socketId, reason) => {
      const socket = io.sockets.sockets.get(socketId);
      if (!socket) return;
      socket.data.roomCode = undefined;
      socket.data.playerId = undefined;
      socket.emit('room:closed', { reason });
    },
  });

  io.on('connection', (socket) => {
    const bucket = new TokenBucket(40, 20);

    /** Регистрирует обработчик: ограничение частоты → валидация zod → ответ в едином формате. */
    function on<E extends ClientEventName>(
      event: E,
      handler: (
        payload: ClientEventPayload<E>,
      ) => ClientEventResults[E] | Promise<ClientEventResults[E]>,
    ) {
      const listener = async (raw: unknown, ack: unknown) => {
        // Клиент обязан передать ack; без него сообщение считаем мусором.
        if (typeof ack !== 'function') return;
        const reply = ack as (result: Ack<ClientEventResults[E]>) => void;
        try {
          if (!bucket.take()) throw new AppError('RATE_LIMITED', 'Too many requests');
          const parsed = clientEventSchemas[event].safeParse(raw);
          if (!parsed.success) {
            throw new AppError(
              'VALIDATION',
              parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
            );
          }
          const data = await handler(parsed.data as ClientEventPayload<E>);
          reply({ ok: true, data });
        } catch (err) {
          if (!(err instanceof AppError)) logger.error({ err, event }, 'socket handler failed');
          reply({ ok: false, error: toApiError(err) });
        }
      };
      (socket as unknown as { on(e: string, l: typeof listener): void }).on(event, listener);
    }

    function current(): { room: Room; player: RoomPlayer } {
      const { roomCode, playerId } = socket.data;
      if (!roomCode || !playerId) throw new AppError('NOT_IN_ROOM');
      const room = manager.get(roomCode);
      if (!room) throw new AppError('ROOM_NOT_FOUND');
      return { room, player: room.requirePlayer(playerId) };
    }

    function enter(room: Room, player: RoomPlayer, token: string): JoinResult {
      leaveCurrent(socket);
      socket.data.roomCode = room.code;
      socket.data.playerId = player.id;
      room.attach(player.id, socket.id);
      return {
        roomCode: room.code,
        playerId: player.id,
        sessionToken: token,
        state: room.snapshotFor(player.id),
      };
    }

    on('room:create', (profile) => {
      const { room, player, token } = manager.create(profile);
      return enter(room, player, token);
    });

    on('room:join', ({ roomCode, ...profile }) => {
      const room = manager.require(roomCode);
      const { player, token } = room.join(profile);
      return enter(room, player, token);
    });

    on('session:resume', ({ roomCode, sessionToken }) => {
      const room = manager.get(roomCode);
      if (!room) throw new AppError('ROOM_NOT_FOUND');
      const player = room.authenticate(sessionToken);
      return enter(room, player, sessionToken);
    });

    on('room:leave', () => {
      const { room, player } = current();
      socket.data.roomCode = undefined;
      socket.data.playerId = undefined;
      room.leave(player.id);
      return null;
    });

    on('player:update', (patch) => {
      const { room, player } = current();
      room.updateProfile(player.id, patch);
      return null;
    });

    on('lobby:updateSettings', (patch) => {
      const { room, player } = current();
      room.updateSettings(player.id, patch);
      return null;
    });

    on('lobby:kick', ({ playerId }) => {
      const { room, player } = current();
      room.kick(player.id, playerId);
      return null;
    });

    on('lobby:transferHost', ({ playerId }) => {
      const { room, player } = current();
      room.transferHost(player.id, playerId);
      return null;
    });

    on('game:start', () => {
      const { room, player } = current();
      game.start(room, player.id);
      return null;
    });

    on('playback:control', (control) => {
      const { room, player } = current();
      game.of(room).playbackControl(player.id, control);
      return null;
    });

    on('vote:cast', ({ category, targetId }) => {
      const { room, player } = current();
      game.of(room).castVote(player.id, category, targetId);
      return null;
    });

    on('phase:continue', () => {
      const { room, player } = current();
      game.of(room).continuePhase(player.id);
      return null;
    });

    on('game:restart', () => {
      const { room, player } = current();
      game.restart(room, player.id);
      return null;
    });

    on('time:sync', ({ clientTime }) => ({ clientTime, serverTime: Date.now() }));

    socket.on('disconnect', () => leaveCurrent(socket));
  });

  function leaveCurrent(socket: IoSocket) {
    const { roomCode, playerId } = socket.data;
    if (!roomCode || !playerId) return;
    socket.data.roomCode = undefined;
    socket.data.playerId = undefined;
    manager.get(roomCode)?.detach(playerId, socket.id);
  }

  return io;
}
