import { z } from 'zod';
import {
  AVATARS,
  LIMITS,
  MODES,
  NICKNAME_MAX,
  PACK_FORMAT_VERSION,
  PLAYER_COLORS,
  RECORD_SECONDS_MAX,
  RECORD_SECONDS_MIN,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROUNDS_MAX,
  ROUNDS_MIN,
  VOTE_CATEGORIES,
} from './constants';
import { EFFECT_IDS } from './effects';

// ── Игроки и комнаты ──────────────────────────────────────────────────────

/** Убираем управляющие символы и схлопываем пробелы: ник попадает в интерфейс всем игрокам. */
function cleanText(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
    .replace(/ {2,}/g, ' ')
    .trim();
}

export const nicknameSchema = z
  .string()
  .max(NICKNAME_MAX * 4)
  .transform(cleanText)
  .pipe(z.string().min(1).max(NICKNAME_MAX));

export const avatarSchema = z.enum(AVATARS);
export const colorSchema = z.enum(PLAYER_COLORS);

export const profileSchema = z.object({
  nickname: nicknameSchema,
  avatar: avatarSchema,
  color: colorSchema,
});
export type Profile = z.infer<typeof profileSchema>;

export const roomCodeSchema = z
  .string()
  .max(16)
  .transform((s) => s.trim().toUpperCase())
  .pipe(z.string().regex(new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`)));

export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
export const sessionTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{20,128}$/);

export const settingsSchema = z.object({
  mode: z.enum(MODES),
  rounds: z.number().int().min(ROUNDS_MIN).max(ROUNDS_MAX),
  recordSeconds: z.number().int().min(RECORD_SECONDS_MIN).max(RECORD_SECONDS_MAX),
  packId: idSchema,
  effectsEnabled: z.boolean(),
  hideCode: z.boolean(),
});
export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  mode: 'parallel',
  rounds: 3,
  recordSeconds: 90,
  packId: 'demo',
  effectsEnabled: true,
  hideCode: false,
};

export const effectIdSchema = z.enum(EFFECT_IDS);
export const voteCategorySchema = z.enum(VOTE_CATEGORIES);

// ── Паки ──────────────────────────────────────────────────────────────────

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Относительный путь внутри архива пака: без «..», абсолютных путей и обратных слэшей. */
export const packPathSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/)
  .refine((p) => !p.split('/').some((seg) => seg === '.' || seg === '..'), 'unsafe path');

export const characterSchema = z.object({
  id: idSchema,
  name: z.string().transform(cleanText).pipe(z.string().min(1).max(40)),
  color: hexColorSchema,
});
export type ClipCharacter = z.infer<typeof characterSchema>;

export const lineSchema = z
  .object({
    id: idSchema,
    characterId: idSchema,
    startMs: z.number().int().min(0),
    endMs: z.number().int().min(1),
    text: z.string().transform(cleanText).pipe(z.string().min(1).max(LIMITS.lineTextMax)),
  })
  .refine((l) => l.endMs > l.startMs, { message: 'endMs must be greater than startMs' });
export type ClipLine = z.infer<typeof lineSchema>;

function uniqueIds(items: { id: string }[]): boolean {
  return new Set(items.map((i) => i.id)).size === items.length;
}

/** Разметка клипа: персонажи и реплики. Используется и в pack.json, и в редакторе. */
export const clipMarkupSchema = z
  .object({
    title: z.string().transform(cleanText).pipe(z.string().min(1).max(LIMITS.titleMax)),
    characters: z.array(characterSchema).min(1).max(LIMITS.maxCharacters),
    lines: z.array(lineSchema).max(LIMITS.maxLinesPerClip),
    attribution: z.string().max(300).optional(),
  })
  .refine((c) => uniqueIds(c.characters), { message: 'duplicate character id' })
  .refine((c) => uniqueIds(c.lines), { message: 'duplicate line id' })
  .refine((c) => c.lines.every((l) => c.characters.some((ch) => ch.id === l.characterId)), {
    message: 'line references unknown character',
  });
export type ClipMarkup = z.infer<typeof clipMarkupSchema>;

export const packClipSchema = z
  .object({
    id: idSchema,
    title: z.string().transform(cleanText).pipe(z.string().min(1).max(LIMITS.titleMax)),
    /** Путь к видео внутри архива. Звук видео при импорте отбрасывается. */
    video: packPathSchema,
    /** Необязательная музыкальная дорожка, которая остаётся во время озвучки. */
    music: packPathSchema.optional(),
    durationMs: z.number().int().min(LIMITS.clipMinDurationMs).max(LIMITS.clipMaxDurationMs),
    characters: z.array(characterSchema).min(1).max(LIMITS.maxCharacters),
    lines: z.array(lineSchema).max(LIMITS.maxLinesPerClip),
    attribution: z.string().max(300).optional(),
  })
  .refine((c) => uniqueIds(c.characters), { message: 'duplicate character id' })
  .refine((c) => uniqueIds(c.lines), { message: 'duplicate line id' })
  .refine((c) => c.lines.every((l) => c.characters.some((ch) => ch.id === l.characterId)), {
    message: 'line references unknown character',
  })
  .refine((c) => c.lines.every((l) => l.endMs <= c.durationMs + 500), {
    message: 'line ends after the clip',
  });
export type PackClip = z.infer<typeof packClipSchema>;

export const packMetaSchema = z.object({
  title: z.string().transform(cleanText).pipe(z.string().min(1).max(LIMITS.titleMax)),
  description: z.string().max(LIMITS.descriptionMax).default(''),
  author: z.string().max(80).default(''),
  language: z
    .string()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
    .default('ru'),
  license: z.string().max(80).default(''),
});
export type PackMeta = z.infer<typeof packMetaSchema>;

/** Схема файла pack.json. */
export const packManifestSchema = packMetaSchema
  .extend({
    formatVersion: z.literal(PACK_FORMAT_VERSION),
    id: idSchema,
    clips: z.array(packClipSchema).min(1).max(LIMITS.maxClipsPerPack),
  })
  .refine((p) => uniqueIds(p.clips), { message: 'duplicate clip id' });
export type PackManifest = z.infer<typeof packManifestSchema>;

// ── Полезные нагрузки событий ─────────────────────────────────────────────

/** События без данных: что бы ни прислал клиент (undefined по сети превращается в null), игнорируем. */
export const emptySchema = z.unknown().transform((): null => null);

export const roomCreateSchema = profileSchema;
export const roomJoinSchema = profileSchema.extend({ roomCode: roomCodeSchema });
export const sessionResumeSchema = z.object({
  roomCode: roomCodeSchema,
  sessionToken: sessionTokenSchema,
});
export const playerUpdateSchema = profileSchema.partial();
export const settingsUpdateSchema = settingsSchema.partial();
export const playerRefSchema = z.object({ playerId: idSchema });
export const playbackControlSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('play') }),
  z.object({ action: z.literal('pause') }),
  z.object({
    action: z.literal('seek'),
    positionMs: z.number().min(0).max(LIMITS.clipMaxDurationMs),
  }),
  z.object({ action: z.literal('next') }),
  z.object({ action: z.literal('prev') }),
  z.object({ action: z.literal('finish') }),
]);
export type PlaybackControl = z.infer<typeof playbackControlSchema>;
export const voteCastSchema = z.object({ category: voteCategorySchema, targetId: idSchema });
export const timeSyncSchema = z.object({ clientTime: z.number() });

/** Параметры загрузки дубля (query-строка запроса). */
export const takeUploadQuerySchema = z.object({
  round: z.coerce.number().int().min(0).max(ROUNDS_MAX),
  offsetMs: z.coerce.number().min(-LIMITS.takeOffsetAbsMaxMs).max(LIMITS.takeOffsetAbsMaxMs),
  effect: effectIdSchema.default('none'),
});
export type TakeUploadQuery = z.infer<typeof takeUploadQuerySchema>;

export const clipTrimSchema = z
  .object({
    startMs: z.number().int().min(0),
    endMs: z.number().int().min(1),
  })
  .refine((t) => t.endMs - t.startMs >= LIMITS.clipMinDurationMs, { message: 'clip is too short' })
  .refine((t) => t.endMs - t.startMs <= LIMITS.clipMaxDurationMs, { message: 'clip is too long' });
export type ClipTrim = z.infer<typeof clipTrimSchema>;
