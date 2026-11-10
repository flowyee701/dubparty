import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { ClipCharacter, ClipLine } from '@dubparty/shared';

export const packs = sqliteTable('packs', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  author: text('author').notNull().default(''),
  language: text('language').notNull().default('ru'),
  license: text('license').notNull().default(''),
  builtin: integer('builtin', { mode: 'boolean' }).notNull().default(false),
  /** Скрытые паки не показываются в списке (калибровочный пак для тестов). */
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
  /** SHA-256 токена владельца. У встроенных паков — null: их нельзя редактировать. */
  ownerTokenHash: text('owner_token_hash'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const clips = sqliteTable(
  'clips',
  {
    packId: text('pack_id')
      .notNull()
      .references(() => packs.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    position: integer('position').notNull(),
    title: text('title').notNull(),
    /** Готовый (обрезанный) клип: H.264 + музыка, если она есть. */
    videoKey: text('video_key').notNull(),
    posterKey: text('poster_key').notNull(),
    /** Нормализованный исходник до обрезки — нужен редактору. */
    sourceKey: text('source_key').notNull(),
    /** Отдельная музыкальная дорожка (для экспорта пака). */
    musicKey: text('music_key'),
    hasMusic: integer('has_music', { mode: 'boolean' }).notNull().default(false),
    durationMs: integer('duration_ms').notNull(),
    sourceDurationMs: integer('source_duration_ms').notNull(),
    trimStartMs: integer('trim_start_ms').notNull().default(0),
    trimEndMs: integer('trim_end_ms').notNull(),
    characters: text('characters', { mode: 'json' }).$type<ClipCharacter[]>().notNull(),
    lines: text('lines', { mode: 'json' }).$type<ClipLine[]>().notNull(),
    attribution: text('attribution').notNull().default(''),
  },
  (t) => [primaryKey({ columns: [t.packId, t.id] })],
);

/** Учёт комнат, чтобы очистка файлов пережила перезапуск сервера. */
export const rooms = sqliteTable('rooms', {
  code: text('code').primaryKey(),
  createdAt: integer('created_at').notNull(),
  lastActivityAt: integer('last_activity_at').notNull(),
  endedAt: integer('ended_at'),
});

export type PackRow = typeof packs.$inferSelect;
export type ClipRow = typeof clips.$inferSelect;
export type RoomRow = typeof rooms.$inferSelect;
