import type {
  ClipCharacter,
  ClipLine,
  EffectId,
  HistoryRound,
  Phase,
  PlaybackState,
  RoundState,
  TakeStatus,
  TimeWindow,
  Timings,
} from '@dubparty/shared';
import type { Logger } from '../logger';
import type { Room } from './room';

/** Клип в том виде, в котором он нужен игре. */
export interface PlayableClip {
  id: string;
  title: string;
  videoKey: string;
  posterKey: string;
  hasMusic: boolean;
  durationMs: number;
  characters: ClipCharacter[];
  lines: ClipLine[];
}

export interface PlayablePack {
  id: string;
  title: string;
  clips: PlayableClip[];
}

export interface PackProvider {
  exists(packId: string): boolean;
  getPlayable(packId: string): PlayablePack | null;
}

/** Серверная обработка звука и видео. В тестах подменяется заглушкой. */
export interface MediaPipeline {
  /**
   * Приводит сырой дубль к шкале времени клипа и накладывает эффект.
   * Результат — WAV длиной ровно в клип.
   */
  processTake(args: {
    rawKey: string;
    outKey: string;
    offsetMs: number;
    effect: EffectId;
    durationMs: number;
    /** В режиме roles — окна, в которых голос игрока слышен. */
    windows?: TimeWindow[];
  }): Promise<void>;
  /** Собирает готовое видео: картинка + музыка + голоса. */
  buildReview(args: {
    videoKey: string;
    hasMusic: boolean;
    voiceKeys: string[];
    outKey: string;
    durationMs: number;
  }): Promise<void>;
}

export interface RoomDeps {
  timings: Timings;
  logger: Logger;
  rng: () => number;
  packs: PackProvider;
  media: MediaPipeline;
  limits: { maxRoomFiles: number; maxRoomBytes: number };
  /** Состояние комнаты изменилось — разослать снапшоты. */
  onChange(room: Room): void;
  onPlayback(room: Room, state: PlaybackState): void;
  onTakeStatus(
    room: Room,
    playerId: string,
    payload: { roundIndex: number; status: TakeStatus; errorCode?: string },
  ): void;
  /** Игрок исключён: закрыть его соединение. */
  onPlayerRemoved(room: Room, socketId: string | null, reason: 'kicked' | 'replaced'): void;
  /** Игра закончилась — запомнить время для очистки. */
  onEnded(room: Room): void;
}

/** То, что комнате нужно от идущей игры. */
export interface GameHandle {
  readonly phase: Phase;
  readonly phaseEndsAt: number | null;
  readonly roundIndex: number;
  readonly totalRounds: number;
  roundStateFor(playerId: string): RoundState | null;
  history(): HistoryRound[];
  /** Игрок ушёл или исключён. */
  onPlayerGone(playerId: string): void;
  /** Кто-то подключился или отключился — пересчитать условия ожидания. */
  onPresenceChange(): void;
  dispose(): void;
}
