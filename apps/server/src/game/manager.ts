import {
  DEFAULT_TIMINGS,
  type PlaybackState,
  type Profile,
  type RoomClosedReason,
  type RoomState,
  type TakeStatus,
  type Timings,
} from '@dubparty/shared';
import { eq } from 'drizzle-orm';
import type { AppContext } from '../app';
import { schema } from '../db';
import { AppError } from '../util/errors';
import { newRoomCode } from '../util/ids';
import { Room, type RoomPlayer } from './room';
import type { MediaPipeline, PackProvider, RoomDeps, TwitchVoteSource } from './types';

/** Канал доставки событий игрокам. Реализуется слоем сокетов. */
export interface RoomTransport {
  state(socketId: string, state: RoomState): void;
  playback(socketId: string, state: PlaybackState): void;
  takeStatus(
    socketId: string,
    payload: { roundIndex: number; status: TakeStatus; errorCode?: string },
  ): void;
  /** Сообщает клиенту, что он больше не в комнате, и отвязывает сокет. */
  closed(socketId: string, reason: RoomClosedReason): void;
}

export interface RoomManagerOptions {
  packs: PackProvider;
  media: MediaPipeline;
  createTwitch(): TwitchVoteSource;
  timings?: Partial<Timings>;
  rng?: () => number;
}

export function roomPrefix(code: string): string {
  return `rooms/${code}`;
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  readonly timings: Timings;
  private transport: RoomTransport | null = null;
  private readonly dirty = new Set<Room>();
  private flushScheduled = false;
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly ctx: AppContext,
    private readonly options: RoomManagerOptions,
  ) {
    this.timings = { ...DEFAULT_TIMINGS, ...options.timings };
  }

  setTransport(transport: RoomTransport): void {
    this.transport = transport;
  }

  /** Запускает периодическую очистку и убирает то, что осталось от прошлого запуска. */
  async start(): Promise<void> {
    // Состояние комнат живёт в памяти, поэтому после перезапуска старые комнаты
    // недостижимы: их файлы можно удалить сразу.
    const orphans = this.ctx.db.select().from(schema.rooms).all();
    for (const row of orphans) {
      await this.ctx.storage
        .deletePrefix(roomPrefix(row.code))
        .catch((err) => this.ctx.logger.warn({ err, room: row.code }, 'orphan cleanup failed'));
    }
    if (orphans.length > 0) {
      this.ctx.db.delete(schema.rooms).run();
      this.ctx.logger.info({ count: orphans.length }, 'removed rooms left from previous run');
    }
    this.sweepTimer = setInterval(() => void this.sweep(), 60_000);
    this.sweepTimer.unref();
  }

  async stop(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    for (const room of this.rooms.values()) room.dispose();
  }

  private deps(): RoomDeps {
    const { config, logger } = this.ctx;
    return {
      timings: this.timings,
      logger,
      rng: this.options.rng ?? Math.random,
      packs: this.options.packs,
      media: this.options.media,
      twitchEnabled: config.TWITCH_ENABLED,
      createTwitch: this.options.createTwitch,
      limits: {
        maxRoomFiles: config.MAX_ROOM_FILES,
        maxRoomBytes: config.MAX_ROOM_MB * 1024 * 1024,
      },
      onChange: (room) => this.scheduleBroadcast(room),
      onPlayback: (room, state) => {
        for (const p of room.players) {
          if (p.socketId) this.transport?.playback(p.socketId, state);
        }
      },
      onTakeStatus: (room, playerId, payload) => {
        const socketId = room.getPlayer(playerId)?.socketId;
        if (socketId) this.transport?.takeStatus(socketId, payload);
      },
      onPlayerRemoved: (_room, socketId, reason) => {
        if (socketId) this.transport?.closed(socketId, reason);
      },
      onEnded: (room) => {
        this.ctx.db
          .update(schema.rooms)
          .set({ endedAt: room.endedAt, lastActivityAt: room.lastActivityAt })
          .where(eq(schema.rooms.code, room.code))
          .run();
      },
    };
  }

  create(profile: Profile): { room: Room; player: RoomPlayer; token: string } {
    if (this.rooms.size >= this.ctx.config.MAX_ROOMS) {
      throw new AppError('SERVER_BUSY', 'Too many rooms, try again later');
    }
    let code = newRoomCode();
    for (let i = 0; this.rooms.has(code); i++) {
      if (i > 200) throw new AppError('SERVER_BUSY', 'Could not allocate a room code');
      code = newRoomCode();
    }
    const room = new Room(code, this.deps());
    this.rooms.set(code, room);
    this.ctx.db
      .insert(schema.rooms)
      .values({ code, createdAt: room.createdAt, lastActivityAt: room.lastActivityAt })
      .run();
    const { player, token } = room.join(profile);
    this.ctx.logger.info({ room: code }, 'room created');
    return { room, player, token };
  }

  get(code: string): Room | undefined {
    const room = this.rooms.get(code);
    return room && !room.closed ? room : undefined;
  }

  require(code: string): Room {
    const room = this.get(code);
    if (!room) throw new AppError('ROOM_NOT_FOUND');
    return room;
  }

  /** Для HTTP-запросов: комната и игрок по коду и токену сессии. */
  authenticate(code: string, token: string | undefined): { room: Room; player: RoomPlayer } {
    if (!token) throw new AppError('NOT_IN_ROOM');
    const room = this.require(code);
    return { room, player: room.authenticate(token) };
  }

  private scheduleBroadcast(room: Room): void {
    this.dirty.add(room);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    // Несколько изменений за один тик уходят одним снапшотом.
    setImmediate(() => {
      this.flushScheduled = false;
      const rooms = [...this.dirty];
      this.dirty.clear();
      for (const r of rooms) this.broadcast(r);
    });
  }

  private broadcast(room: Room): void {
    if (room.closed || !this.transport) return;
    for (const p of room.players) {
      if (p.socketId) this.transport.state(p.socketId, room.snapshotFor(p.id));
    }
  }

  async destroy(room: Room, reason: RoomClosedReason): Promise<void> {
    if (!this.rooms.delete(room.code)) return;
    for (const p of room.players) {
      if (p.socketId) this.transport?.closed(p.socketId, reason);
    }
    room.dispose();
    this.dirty.delete(room);
    this.ctx.db.delete(schema.rooms).where(eq(schema.rooms.code, room.code)).run();
    await this.ctx.storage
      .deletePrefix(roomPrefix(room.code))
      .catch((err) => this.ctx.logger.warn({ err, room: room.code }, 'room cleanup failed'));
    this.ctx.logger.info({ room: room.code, reason }, 'room removed');
  }

  /** Удаляет опустевшие, давно завершённые и заброшенные комнаты. */
  async sweep(now = Date.now()): Promise<void> {
    const ttlMs = this.ctx.config.ROOM_TTL_HOURS * 3_600_000;
    const idleMs = this.ctx.config.ROOM_IDLE_HOURS * 3_600_000;
    for (const room of [...this.rooms.values()]) {
      const empty = room.activePlayers.length === 0;
      const ended = room.endedAt !== null && now - room.endedAt >= ttlMs;
      const idle = now - room.lastActivityAt >= idleMs;
      if (empty || ended || idle) {
        await this.destroy(room, empty ? 'closed' : 'expired');
      } else {
        this.ctx.db
          .update(schema.rooms)
          .set({ lastActivityAt: room.lastActivityAt })
          .where(eq(schema.rooms.code, room.code))
          .run();
      }
    }
  }
}
