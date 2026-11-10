import { DEFAULT_TIMINGS, type PlaybackState, type Profile, type Timings } from '@dubparty/shared';
import { silentLogger } from '../logger';
import { GameController } from './controller';
import { Room, type RoomPlayer } from './room';
import type { GameSession } from './session';
import type { MediaPipeline, PlayablePack, RoomDeps } from './types';

/** Детерминированный генератор для воспроизводимых перемешиваний. */
export function seededRng(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

export const TEST_PACK: PlayablePack = {
  id: 'demo',
  title: 'Test pack',
  clips: [
    {
      id: 'duo',
      title: 'Duo',
      videoKey: 'packs/demo/duo/video-1.mp4',
      posterKey: 'packs/demo/duo/poster-1.jpg',
      hasMusic: false,
      durationMs: 10_000,
      characters: [
        { id: 'a', name: 'A', color: '#ff0000' },
        { id: 'b', name: 'B', color: '#00ff00' },
      ],
      lines: [
        { id: 'l1', characterId: 'a', startMs: 1000, endMs: 2000, text: 'Hi' },
        { id: 'l2', characterId: 'b', startMs: 3000, endMs: 4000, text: 'Hello' },
      ],
    },
    {
      id: 'solo',
      title: 'Solo',
      videoKey: 'packs/demo/solo/video-1.mp4',
      posterKey: 'packs/demo/solo/poster-1.jpg',
      hasMusic: true,
      durationMs: 8_000,
      characters: [{ id: 'a', name: 'A', color: '#ff0000' }],
      lines: [{ id: 'l1', characterId: 'a', startMs: 500, endMs: 1500, text: 'Solo' }],
    },
  ],
};

export interface TestRoom {
  room: Room;
  game: GameController;
  session(): GameSession;
  media: { processTake: MediaPipeline['processTake']; buildReview: MediaPipeline['buildReview'] };
  calls: { processTake: Parameters<MediaPipeline['processTake']>[0][]; buildReview: number };
  events: {
    changes: number;
    playback: PlaybackState[];
    removed: { socketId: string | null; reason: string }[];
    ended: number;
  };
  /** Добавляет игрока и сразу «подключает» его сокет. */
  add(nickname: string): RoomPlayer & { token: string };
  /** Имитирует загрузку дубля. */
  submit(playerId: string, offsetMs?: number): ReturnType<GameSession['submitTake']>;
}

const profile = (nickname: string): Profile => ({ nickname, avatar: 'fox', color: '#ef4444' });

export function createTestRoom(
  options: {
    timings?: Partial<Timings>;
    pack?: PlayablePack;
    failTakeFor?: Set<string>;
    failReview?: boolean;
  } = {},
): TestRoom {
  const calls: TestRoom['calls'] = { processTake: [], buildReview: 0 };
  const events: TestRoom['events'] = { changes: 0, playback: [], removed: [], ended: 0 };
  const pack = options.pack ?? TEST_PACK;

  const media: MediaPipeline = {
    async processTake(args) {
      calls.processTake.push(args);
      const playerId = /takes\/([^/]+)-\d+\./.exec(args.rawKey)?.[1] ?? '';
      if (options.failTakeFor?.has(playerId)) throw new Error('boom');
    },
    async buildReview() {
      calls.buildReview++;
      if (options.failReview) throw new Error('boom');
    },
  };

  const deps: RoomDeps = {
    timings: { ...DEFAULT_TIMINGS, ...options.timings },
    logger: silentLogger,
    rng: seededRng(),
    packs: {
      exists: (id) => id === pack.id,
      getPlayable: (id) => (id === pack.id ? pack : null),
    },
    media,
    limits: { maxRoomFiles: 1000, maxRoomBytes: 1e12 },
    onChange: () => void events.changes++,
    onPlayback: (_room, state) => void events.playback.push(state),
    onTakeStatus: () => {},
    onPlayerRemoved: (_room, socketId, reason) => void events.removed.push({ socketId, reason }),
    onEnded: () => void events.ended++,
  };

  const room = new Room('ABCD', deps);
  const game = new GameController();
  let socketSeq = 0;

  return {
    room,
    game,
    media,
    calls,
    events,
    session: () => game.of(room),
    add(nickname) {
      const { player, token } = room.join(profile(nickname));
      room.attach(player.id, `sock-${++socketSeq}`);
      return Object.assign(player, { token });
    },
    submit(playerId, offsetMs = 0) {
      const session = game.of(room);
      const { rawKey, seq } = session.prepareTake(playerId, session.roundIndex, 'webm');
      return session.submitTake(playerId, { rawKey, seq, size: 1000, offsetMs, effect: 'none' });
    },
  };
}
