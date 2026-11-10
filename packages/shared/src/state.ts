import type { Avatar, GameMode, Phase, VoteCategory } from './constants';
import type { Troupe } from './roles';
import type { ClipCharacter, ClipLine, Settings } from './schemas';
import type { RoundScore } from './scoring';
import type { PlaybackAnchor } from './sync';

export interface PublicPlayer {
  id: string;
  nickname: string;
  avatar: Avatar;
  color: string;
  connected: boolean;
  /** Ушёл или был исключён во время игры: остаётся в списке ради истории раундов. */
  left: boolean;
  score: number;
}

export interface ClipPublic {
  id: string;
  title: string;
  videoUrl: string;
  posterUrl: string;
  /** В видео есть музыкальная дорожка, которую нужно оставить слышимой. */
  hasMusic: boolean;
  durationMs: number;
  characters: ClipCharacter[];
  /** В режиме free — пусто. */
  lines: ClipLine[];
}

/** То, что смотрят при общем просмотре: готовое видео с озвучкой. */
export interface EntryPublic {
  id: string;
  authorIds: string[];
  url: string;
  durationMs: number;
}

export interface PlaybackState extends PlaybackAnchor {
  entryIndex: number;
  /** Растёт при каждом изменении — клиент отбрасывает устаревшие состояния. */
  rev: number;
}

/** То, за что голосуют: обычно запись целиком, а в единственной труппе — её участники. */
export interface VoteTarget {
  id: string;
  authorIds: string[];
  entryId: string;
}

export type TakeStatus = 'none' | 'processing' | 'ready' | 'failed';

export interface RoundState {
  index: number;
  mode: GameMode;
  clip: ClipPublic;
  /** Только в режиме roles. */
  troupes: Troupe[] | null;
  /** Игроки, чей дубль принят и обработан. */
  submittedIds: string[];
  yourTake: { status: TakeStatus; errorCode?: string };
  entries: EntryPublic[];
  playback: PlaybackState | null;
  voteTargets: VoteTarget[];
  yourVotes: Partial<Record<VoteCategory, string>>;
  /** Игроки, проголосовавшие во всех доступных им категориях. */
  votedIds: string[];
  audienceVotes: number;
  results: RoundScore | null;
}

export interface HistoryRound {
  index: number;
  clipTitle: string;
  mode: GameMode;
  entries: EntryPublic[];
}

export type TwitchStatus = 'off' | 'connecting' | 'connected' | 'error';

export interface TwitchState {
  enabled: boolean;
  channel: string | null;
  status: TwitchStatus;
}

export interface RoomState {
  code: string;
  youId: string;
  hostId: string;
  players: PublicPlayer[];
  settings: Settings;
  phase: Phase;
  /** Время сервера, когда закончится текущая фаза (если у неё есть таймер). */
  phaseEndsAt: number | null;
  serverTime: number;
  roundIndex: number;
  totalRounds: number;
  round: RoundState | null;
  /** Завершённые раунды — для скачивания озвучек. */
  history: HistoryRound[];
  twitch: TwitchState;
}

export interface PackSummary {
  id: string;
  title: string;
  description: string;
  author: string;
  language: string;
  license: string;
  builtin: boolean;
  clipCount: number;
  /** Число клипов, где больше одного персонажа (интересны для режима roles). */
  multiRoleClipCount: number;
  posterUrl: string | null;
}

export interface EditorClip {
  id: string;
  title: string;
  videoUrl: string;
  posterUrl: string;
  sourceUrl: string;
  hasMusic: boolean;
  durationMs: number;
  sourceDurationMs: number;
  trimStartMs: number;
  trimEndMs: number;
  characters: ClipCharacter[];
  lines: ClipLine[];
  attribution: string;
}

export interface PackDetail extends PackSummary {
  clips: EditorClip[];
}

export interface PublicConfig {
  version: string;
  twitchEnabled: boolean;
  limits: {
    clipUploadMaxBytes: number;
    clipMaxDurationMs: number;
    sourceMaxDurationMs: number;
    takeMaxBytes: number;
  };
}
