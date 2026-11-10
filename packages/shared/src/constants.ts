export const ROOM_CODE_LENGTH = 4;
/** Без I и O — их легко спутать с 1 и 0, когда код диктуют голосом. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const NICKNAME_MAX = 16;

export const AVATARS = [
  'fox',
  'cat',
  'dog',
  'owl',
  'frog',
  'bear',
  'robot',
  'alien',
  'ghost',
  'unicorn',
  'panda',
  'octopus',
] as const;
export type Avatar = (typeof AVATARS)[number];

export const PLAYER_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
] as const;

export type PlayerColor = (typeof PLAYER_COLORS)[number];

export const MODES = ['parallel', 'roles', 'free'] as const;
export type GameMode = (typeof MODES)[number];

export const ROUNDS_MIN = 1;
export const ROUNDS_MAX = 10;
export const RECORD_SECONDS_MIN = 30;
export const RECORD_SECONDS_MAX = 180;

export const VOTE_CATEGORIES = ['funniest', 'acting'] as const;
export type VoteCategory = (typeof VOTE_CATEGORIES)[number];

export const PHASES = [
  'lobby',
  'intro',
  'recording',
  'processing',
  'playback',
  'voting',
  'results',
  'final',
] as const;
export type Phase = (typeof PHASES)[number];

/** Длительности фаз. Сервер может переопределить их (например, в тестах). */
export interface Timings {
  introMs: number;
  /** Сколько ждать загрузки дублей после окончания таймера записи. */
  recordGraceMs: number;
  /** Запас сверх длительности клипа, чтобы успеть хотя бы один дубль. */
  recordMinExtraMs: number;
  processingMaxMs: number;
  playbackPrerollMs: number;
  playbackGapMs: number;
  votingMs: number;
  resultsMs: number;
  /** Сколько держать место за отключившимся игроком в лобби. */
  lobbyDisconnectMs: number;
  /** Сколько ждать возвращения хоста, прежде чем передать права. */
  hostGraceMs: number;
}

export const DEFAULT_TIMINGS: Timings = {
  introMs: 7_000,
  recordGraceMs: 8_000,
  recordMinExtraMs: 20_000,
  processingMaxMs: 120_000,
  playbackPrerollMs: 3_500,
  playbackGapMs: 1_500,
  votingMs: 45_000,
  resultsMs: 30_000,
  lobbyDisconnectMs: 90_000,
  hostGraceMs: 15_000,
};

export const SCORING = {
  /** За каждый полученный голос. */
  perVote: 100,
  /** Победителю категории (при ничьей — каждому лидеру). */
  categoryWin: 50,
  /** За то, что проголосовал во всех доступных категориях. */
  votedBonus: 25,
  /** Фавориту зрителей Twitch. */
  audienceWin: 100,
} as const;

export const SYNC = {
  /** Жёсткий допуск рассинхрона при общем просмотре. */
  toleranceMs: 150,
  /** Ниже этого порога ничего не трогаем. */
  softMs: 40,
  /** На сколько меняем playbackRate при мягкой коррекции. */
  rateDelta: 0.06,
  /** Интервал проверки дрейфа. */
  checkIntervalMs: 200,
  /** Порог коррекции видео относительно часов записи. */
  recordDriftMs: 80,
} as const;

const MB = 1024 * 1024;

export const LIMITS = {
  takeMaxBytes: 25 * MB,
  clipUploadMaxBytes: 100 * MB,
  packZipMaxBytes: 400 * MB,
  /** Длительность готового клипа. */
  clipMinDurationMs: 2_000,
  clipMaxDurationMs: 60_000,
  /** Исходник до обрезки может быть длиннее. */
  sourceMaxDurationMs: 10 * 60_000,
  maxClipsPerPack: 30,
  maxCharacters: 8,
  maxLinesPerClip: 200,
  lineTextMax: 200,
  titleMax: 80,
  descriptionMax: 500,
  /** Сколько раз игрок может перезалить дубль за раунд. */
  takesPerPlayerPerRound: 30,
  /** Допустимое смещение начала записи относительно видео. */
  takeOffsetAbsMaxMs: 10_000,
  socketPayloadBytes: 16 * 1024,
  twitchChannelMax: 25,
} as const;

export const PACK_FORMAT_VERSION = 1;
