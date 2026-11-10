import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

/**
 * Миграции — упорядоченный список SQL. Номер применённой версии хранится в
 * PRAGMA user_version; новые шаги добавляются только в конец списка.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE packs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT 'ru',
    license TEXT NOT NULL DEFAULT '',
    builtin INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,
    owner_token_hash TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE clips (
    pack_id TEXT NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    position INTEGER NOT NULL,
    title TEXT NOT NULL,
    video_key TEXT NOT NULL,
    poster_key TEXT NOT NULL,
    source_key TEXT NOT NULL,
    music_key TEXT,
    has_music INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL,
    source_duration_ms INTEGER NOT NULL,
    trim_start_ms INTEGER NOT NULL DEFAULT 0,
    trim_end_ms INTEGER NOT NULL,
    characters TEXT NOT NULL,
    lines TEXT NOT NULL,
    attribution TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (pack_id, id)
  );
  CREATE TABLE rooms (
    code TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    last_activity_at INTEGER NOT NULL,
    ended_at INTEGER
  );
  `,
];

export interface DbHandle {
  db: Db;
  close(): void;
}

export function openDb(file: string): DbHandle {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');

  const current = Number(sqlite.pragma('user_version', { simple: true }));
  for (let v = current; v < MIGRATIONS.length; v++) {
    const apply = sqlite.transaction(() => {
      sqlite.exec(MIGRATIONS[v]!);
      sqlite.pragma(`user_version = ${v + 1}`);
    });
    apply();
  }

  return {
    db: drizzle(sqlite, { schema }),
    close: () => sqlite.close(),
  };
}

export { schema };
