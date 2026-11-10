import { createHash, timingSafeEqual } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  clipMarkupSchema,
  LIMITS,
  PACK_FORMAT_VERSION,
  packManifestSchema,
  packMetaSchema,
  type ClipMarkup,
  type ClipTrim,
  type EditorClip,
  type PackDetail,
  type PackManifest,
  type PackMeta,
  type PackSummary,
} from '@dubparty/shared';
import { ZipArchive } from 'archiver';
import { and, asc, eq } from 'drizzle-orm';
import yauzl from 'yauzl';
import type { AppContext } from '../app';
import { schema } from '../db';
import type { ClipRow, PackRow } from '../db/schema';
import { mediaUrl } from '../game/session';
import type { PackProvider, PlayablePack } from '../game/types';
import type { MediaTools } from '../media/pipeline';
import { withTempDir } from '../media/pipeline';
import { sniffFile } from '../media/sniff';
import { AppError } from '../util/errors';
import { hashToken, newId, newToken } from '../util/ids';

const { packs, clips } = schema;

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return slug || 'clip';
}

interface IngestOptions {
  packId: string;
  clipId: string;
  position: number;
  markup: ClipMarkup;
  music: 'none' | 'keep' | { file: string };
  /** Импортируемые клипы уже обрезаны: длиннее лимита быть не должны. */
  requireFinalLength: boolean;
}

export class PackService implements PackProvider {
  constructor(
    private readonly ctx: AppContext,
    private readonly tools: MediaTools,
  ) {}

  private get db() {
    return this.ctx.db;
  }

  // ── Чтение ──────────────────────────────────────────────────────────────

  private clipRows(packId: string): ClipRow[] {
    return this.db
      .select()
      .from(clips)
      .where(eq(clips.packId, packId))
      .orderBy(asc(clips.position))
      .all();
  }

  private toSummary(pack: PackRow, rows: ClipRow[]): PackSummary {
    return {
      id: pack.id,
      title: pack.title,
      description: pack.description,
      author: pack.author,
      language: pack.language,
      license: pack.license,
      builtin: pack.builtin,
      clipCount: rows.length,
      multiRoleClipCount: rows.filter((c) => c.characters.length > 1).length,
      posterUrl: rows[0] ? mediaUrl(rows[0].posterKey) : null,
    };
  }

  private toEditorClip(c: ClipRow): EditorClip {
    return {
      id: c.id,
      title: c.title,
      videoUrl: mediaUrl(c.videoKey),
      posterUrl: mediaUrl(c.posterKey),
      sourceUrl: mediaUrl(c.sourceKey),
      hasMusic: c.hasMusic,
      durationMs: c.durationMs,
      sourceDurationMs: c.sourceDurationMs,
      trimStartMs: c.trimStartMs,
      trimEndMs: c.trimEndMs,
      characters: c.characters,
      lines: c.lines,
      attribution: c.attribution,
    };
  }

  list(): PackSummary[] {
    return this.db
      .select()
      .from(packs)
      .where(eq(packs.hidden, false))
      .orderBy(asc(packs.createdAt))
      .all()
      .map((p) => this.toSummary(p, this.clipRows(p.id)))
      .sort((a, b) => Number(b.builtin) - Number(a.builtin));
  }

  getDetail(packId: string): PackDetail | null {
    const pack = this.db.select().from(packs).where(eq(packs.id, packId)).get();
    if (!pack) return null;
    const rows = this.clipRows(packId);
    return { ...this.toSummary(pack, rows), clips: rows.map((c) => this.toEditorClip(c)) };
  }

  exists(packId: string): boolean {
    return !!this.db.select({ id: packs.id }).from(packs).where(eq(packs.id, packId)).get();
  }

  getPlayable(packId: string): PlayablePack | null {
    const pack = this.db.select().from(packs).where(eq(packs.id, packId)).get();
    if (!pack) return null;
    return {
      id: pack.id,
      title: pack.title,
      clips: this.clipRows(packId).map((c) => ({
        id: c.id,
        title: c.title,
        videoKey: c.videoKey,
        posterKey: c.posterKey,
        hasMusic: c.hasMusic,
        durationMs: c.durationMs,
        characters: c.characters,
        lines: c.lines,
      })),
    };
  }

  // ── Права ───────────────────────────────────────────────────────────────

  private requireOwned(packId: string, token: string | undefined): PackRow {
    const pack = this.db.select().from(packs).where(eq(packs.id, packId)).get();
    if (!pack) throw new AppError('NOT_FOUND', 'Pack not found');
    if (pack.builtin || !pack.ownerTokenHash) {
      throw new AppError('FORBIDDEN', 'Built-in packs are read-only');
    }
    const given = Buffer.from(hashToken(token ?? ''), 'hex');
    const expected = Buffer.from(pack.ownerTokenHash, 'hex');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new AppError('FORBIDDEN', 'You are not the owner of this pack');
    }
    return pack;
  }

  private requireClip(packId: string, clipId: string): ClipRow {
    const clip = this.db
      .select()
      .from(clips)
      .where(and(eq(clips.packId, packId), eq(clips.id, clipId)))
      .get();
    if (!clip) throw new AppError('NOT_FOUND', 'Clip not found');
    return clip;
  }

  private touchPack(packId: string): void {
    this.db.update(packs).set({ updatedAt: Date.now() }).where(eq(packs.id, packId)).run();
  }

  // ── Паки ────────────────────────────────────────────────────────────────

  createPack(input: unknown): { pack: PackDetail; ownerToken: string } {
    const meta = packMetaSchema.parse(input);
    const ownerToken = newToken();
    const id = newId(8);
    const now = Date.now();
    this.db
      .insert(packs)
      .values({
        id,
        ...meta,
        ownerTokenHash: hashToken(ownerToken),
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return { pack: this.getDetail(id)!, ownerToken };
  }

  updatePack(packId: string, token: string | undefined, input: unknown): PackDetail {
    this.requireOwned(packId, token);
    const meta: PackMeta = packMetaSchema.parse(input);
    this.db
      .update(packs)
      .set({ ...meta, updatedAt: Date.now() })
      .where(eq(packs.id, packId))
      .run();
    return this.getDetail(packId)!;
  }

  async deletePack(packId: string, token: string | undefined): Promise<void> {
    this.requireOwned(packId, token);
    await this.removePack(packId);
  }

  private async removePack(packId: string): Promise<void> {
    this.db.delete(packs).where(eq(packs.id, packId)).run();
    await this.ctx.storage.deletePrefix(`packs/${packId}`);
  }

  // ── Клипы ───────────────────────────────────────────────────────────────

  /**
   * Принимает видео: проверяет сигнатуру и содержимое, нормализует, делает постер
   * и сохраняет клип. Общий путь для загрузки из редактора, импорта и встроенных паков.
   */
  private async ingestClip(videoFile: string, options: IngestOptions): Promise<ClipRow> {
    const { packId, clipId, markup } = options;
    const kind = await sniffFile(videoFile);
    if (kind !== 'mp4' && kind !== 'webm') {
      throw new AppError('UNSUPPORTED_MEDIA', 'Video must be MP4, MOV or WebM');
    }
    const info = await this.tools.probe(videoFile);
    if (!info.hasVideo) throw new AppError('UNSUPPORTED_MEDIA', 'File has no video stream');
    if (info.durationMs < LIMITS.clipMinDurationMs)
      throw new AppError('TOO_LONG', 'Video is too short');
    const maxMs = options.requireFinalLength
      ? LIMITS.clipMaxDurationMs + 500
      : LIMITS.sourceMaxDurationMs;
    if (info.durationMs > maxMs) throw new AppError('TOO_LONG', 'Video is too long');

    const music = options.music === 'keep' && !info.hasAudio ? 'none' : options.music;
    const base = `packs/${packId}/${clipId}`;
    const rev = newId(4);
    const sourceKey = `${base}/source-${rev}.mp4`;
    const posterKey = `${base}/poster-${rev}.jpg`;

    return withTempDir(async (dir) => {
      const source = path.join(dir, 'source.mp4');
      await this.tools.normalizeVideo(videoFile, source, { music });
      const normalized = await this.tools.probe(source);
      const sourceDurationMs = normalized.durationMs;
      const trimEndMs = Math.min(sourceDurationMs, LIMITS.clipMaxDurationMs);

      // Если исходник укладывается в лимит, готовый клип — это он же.
      let videoKey = sourceKey;
      let video = source;
      if (trimEndMs < sourceDurationMs) {
        videoKey = `${base}/video-${rev}.mp4`;
        video = path.join(dir, 'video.mp4');
        await this.tools.normalizeVideo(source, video, {
          startMs: 0,
          endMs: trimEndMs,
          music: normalized.hasAudio ? 'keep' : 'none',
        });
      }
      const poster = path.join(dir, 'poster.jpg');
      await this.tools.poster(video, poster, Math.min(1000, trimEndMs / 2));

      await this.ctx.storage.putFile(sourceKey, source);
      if (videoKey !== sourceKey) await this.ctx.storage.putFile(videoKey, video);
      await this.ctx.storage.putFile(posterKey, poster);

      const durationMs = trimEndMs;
      const row: ClipRow = {
        packId,
        id: clipId,
        position: options.position,
        title: markup.title,
        videoKey,
        posterKey,
        sourceKey,
        hasMusic: normalized.hasAudio,
        durationMs,
        sourceDurationMs,
        trimStartMs: 0,
        trimEndMs,
        characters: markup.characters,
        lines: markup.lines
          .filter((l) => l.startMs < durationMs)
          .map((l) => ({
            ...l,
            endMs: Math.min(l.endMs, durationMs),
          })),
        attribution: markup.attribution ?? '',
      };
      this.db.insert(clips).values(row).run();
      this.touchPack(packId);
      return row;
    });
  }

  async addClip(
    packId: string,
    token: string | undefined,
    videoFile: string,
    input: { title: string; keepAudio: boolean },
  ): Promise<EditorClip> {
    this.requireOwned(packId, token);
    const rows = this.clipRows(packId);
    if (rows.length >= LIMITS.maxClipsPerPack) {
      throw new AppError('LIMIT_REACHED', 'Too many clips in this pack');
    }
    const markup = clipMarkupSchema.parse({
      title: input.title,
      characters: [{ id: 'a', name: 'A', color: '#f59e0b' }],
      lines: [],
    });
    const row = await this.ingestClip(videoFile, {
      packId,
      clipId: `${slugify(input.title)}-${newId(3)}`,
      position: (rows.at(-1)?.position ?? -1) + 1,
      markup,
      music: input.keepAudio ? 'keep' : 'none',
      requireFinalLength: false,
    });
    return this.toEditorClip(row);
  }

  updateClipMarkup(
    packId: string,
    clipId: string,
    token: string | undefined,
    input: unknown,
  ): EditorClip {
    this.requireOwned(packId, token);
    const clip = this.requireClip(packId, clipId);
    const markup = clipMarkupSchema.parse(input);
    if (markup.lines.some((l) => l.endMs > clip.durationMs + 500)) {
      throw new AppError('VALIDATION', 'A line ends after the clip');
    }
    this.db
      .update(clips)
      .set({
        title: markup.title,
        characters: markup.characters,
        lines: [...markup.lines].sort((a, b) => a.startMs - b.startMs),
        attribution: markup.attribution ?? '',
      })
      .where(and(eq(clips.packId, packId), eq(clips.id, clipId)))
      .run();
    this.touchPack(packId);
    return this.toEditorClip(this.requireClip(packId, clipId));
  }

  /** Перерезает клип из исходника. Таймкоды реплик сдвигаются вместе с началом. */
  async trimClip(
    packId: string,
    clipId: string,
    token: string | undefined,
    trim: ClipTrim,
  ): Promise<EditorClip> {
    this.requireOwned(packId, token);
    const clip = this.requireClip(packId, clipId);
    const startMs = Math.min(trim.startMs, clip.sourceDurationMs);
    const endMs = Math.min(trim.endMs, clip.sourceDurationMs);
    if (endMs - startMs < LIMITS.clipMinDurationMs)
      throw new AppError('VALIDATION', 'Clip is too short');

    const base = `packs/${packId}/${clipId}`;
    const rev = newId(4);
    const whole = startMs === 0 && endMs === clip.sourceDurationMs;
    const videoKey = whole ? clip.sourceKey : `${base}/video-${rev}.mp4`;
    const posterKey = `${base}/poster-${rev}.jpg`;
    const durationMs = endMs - startMs;

    const source = await this.ctx.storage.toLocalFile(clip.sourceKey);
    try {
      await withTempDir(async (dir) => {
        let video = source.path;
        if (!whole) {
          video = path.join(dir, 'video.mp4');
          await this.tools.normalizeVideo(source.path, video, {
            startMs,
            endMs,
            music: clip.hasMusic ? 'keep' : 'none',
          });
          await this.ctx.storage.putFile(videoKey, video);
        }
        const poster = path.join(dir, 'poster.jpg');
        await this.tools.poster(video, poster, Math.min(1000, durationMs / 2));
        await this.ctx.storage.putFile(posterKey, poster);
      });
    } finally {
      await source.release();
    }

    // Реплики привязаны к готовому клипу: сдвигаем на разницу начал и отсекаем выпавшие.
    const shift = clip.trimStartMs - startMs;
    const lines = clip.lines
      .map((l) => ({ ...l, startMs: l.startMs + shift, endMs: l.endMs + shift }))
      .filter((l) => l.endMs > 0 && l.startMs < durationMs)
      .map((l) => ({ ...l, startMs: Math.max(0, l.startMs), endMs: Math.min(durationMs, l.endMs) }))
      .filter((l) => l.endMs > l.startMs);

    this.db
      .update(clips)
      .set({ videoKey, posterKey, durationMs, trimStartMs: startMs, trimEndMs: endMs, lines })
      .where(and(eq(clips.packId, packId), eq(clips.id, clipId)))
      .run();
    this.touchPack(packId);

    if (clip.videoKey !== clip.sourceKey) await this.ctx.storage.delete(clip.videoKey);
    await this.ctx.storage.delete(clip.posterKey);
    return this.toEditorClip(this.requireClip(packId, clipId));
  }

  moveClip(
    packId: string,
    clipId: string,
    token: string | undefined,
    direction: 'up' | 'down',
  ): void {
    this.requireOwned(packId, token);
    const rows = this.clipRows(packId);
    const index = rows.findIndex((c) => c.id === clipId);
    const other = rows[direction === 'up' ? index - 1 : index + 1];
    const clip = rows[index];
    if (!clip) throw new AppError('NOT_FOUND', 'Clip not found');
    if (!other) return;
    this.db.transaction((tx) => {
      const set = (id: string, position: number) =>
        tx
          .update(clips)
          .set({ position })
          .where(and(eq(clips.packId, packId), eq(clips.id, id)))
          .run();
      set(clip.id, other.position);
      set(other.id, clip.position);
    });
    this.touchPack(packId);
  }

  async deleteClip(packId: string, clipId: string, token: string | undefined): Promise<void> {
    this.requireOwned(packId, token);
    this.requireClip(packId, clipId);
    this.db
      .delete(clips)
      .where(and(eq(clips.packId, packId), eq(clips.id, clipId)))
      .run();
    this.touchPack(packId);
    await this.ctx.storage.deletePrefix(`packs/${packId}/${clipId}`);
  }

  // ── Экспорт и импорт ────────────────────────────────────────────────────

  buildManifest(packId: string): PackManifest {
    const pack = this.db.select().from(packs).where(eq(packs.id, packId)).get();
    if (!pack) throw new AppError('NOT_FOUND', 'Pack not found');
    const rows = this.clipRows(packId);
    if (rows.length === 0) throw new AppError('VALIDATION', 'Pack has no clips');
    return {
      formatVersion: PACK_FORMAT_VERSION,
      id: pack.id,
      title: pack.title,
      description: pack.description,
      author: pack.author,
      language: pack.language,
      license: pack.license,
      clips: rows.map((c) => ({
        id: c.id,
        title: c.title,
        video: `clips/${c.id}/video.mp4`,
        ...(c.hasMusic ? { music: `clips/${c.id}/music.m4a` } : {}),
        durationMs: c.durationMs,
        characters: c.characters,
        lines: c.lines,
        ...(c.attribution ? { attribution: c.attribution } : {}),
      })),
    };
  }

  /** Собирает zip пака во временный файл и отдаёт путь; вызывающий удаляет каталог. */
  async exportZip(packId: string, dir: string): Promise<{ file: string; filename: string }> {
    const manifest = this.buildManifest(packId);
    const rows = this.clipRows(packId);
    const file = path.join(dir, 'pack.zip');
    const archive = new ZipArchive({ zlib: { level: 1 } });
    const done = pipeline(archive, createWriteStream(file));
    const releases: (() => Promise<void>)[] = [];
    try {
      archive.append(JSON.stringify(manifest, null, 2), { name: 'pack.json' });
      for (const clip of rows) {
        const video = await this.ctx.storage.toLocalFile(clip.videoKey);
        releases.push(video.release);
        archive.file(video.path, { name: `clips/${clip.id}/video.mp4` });
        if (clip.hasMusic) {
          const music = path.join(dir, `${clip.id}.m4a`);
          await this.tools.extractAudio(video.path, music);
          archive.file(music, { name: `clips/${clip.id}/music.m4a` });
        }
      }
      await archive.finalize();
      await done;
    } finally {
      await Promise.all(releases.map((r) => r().catch(() => {})));
    }
    return { file, filename: `${slugify(manifest.title) || 'pack'}.dubpack.zip` };
  }

  /** Импорт пака из zip. Из архива достаются только файлы, названные в pack.json. */
  async importZip(zipFile: string): Promise<{ pack: PackDetail; ownerToken: string }> {
    if ((await sniffFile(zipFile)) !== 'zip') {
      throw new AppError('UNSUPPORTED_MEDIA', 'File is not a zip archive');
    }
    return withTempDir(async (dir) => {
      const zip = await openZip(zipFile);
      try {
        const entries = await readEntries(zip);
        const manifestEntry = entries.get('pack.json');
        if (!manifestEntry) throw new AppError('VALIDATION', 'pack.json is missing');
        const manifestPath = path.join(dir, 'pack.json');
        await extractEntry(zip, manifestEntry, manifestPath, 1024 * 1024);
        const manifest = parseManifest(await readFile(manifestPath, 'utf8'));

        const ownerToken = newToken();
        const packId = newId(8);
        const now = Date.now();
        this.db
          .insert(packs)
          .values({
            id: packId,
            title: manifest.title,
            description: manifest.description,
            author: manifest.author,
            language: manifest.language,
            license: manifest.license,
            ownerTokenHash: hashToken(ownerToken),
            createdAt: now,
            updatedAt: now,
          })
          .run();

        try {
          let budget = LIMITS.packZipMaxBytes;
          for (const [position, clip] of manifest.clips.entries()) {
            const extract = async (name: string, target: string) => {
              const entry = entries.get(name);
              if (!entry)
                throw new AppError('VALIDATION', `File "${name}" is missing in the archive`);
              const limit = Math.min(LIMITS.clipUploadMaxBytes, budget);
              budget -= await extractEntry(zip, entry, target, limit);
            };
            const video = path.join(dir, `v${position}`);
            await extract(clip.video, video);
            let music: IngestOptions['music'] = 'none';
            if (clip.music) {
              const musicFile = path.join(dir, `m${position}`);
              await extract(clip.music, musicFile);
              const info = await this.tools.probe(musicFile);
              if (!info.hasAudio)
                throw new AppError('UNSUPPORTED_MEDIA', 'Music file has no audio');
              music = { file: musicFile };
            }
            await this.ingestClip(video, {
              packId,
              clipId: clip.id,
              position,
              markup: {
                title: clip.title,
                characters: clip.characters,
                lines: clip.lines,
                attribution: clip.attribution,
              },
              music,
              requireFinalLength: true,
            });
          }
        } catch (err) {
          // Наполовину импортированный пак не оставляем.
          await this.removePack(packId);
          throw err;
        }
        return { pack: this.getDetail(packId)!, ownerToken };
      } finally {
        zip.close();
      }
    });
  }

  /**
   * Засевает встроенный пак из каталога (pack.json + файлы). Повторный запуск с тем же
   * pack.json ничего не делает; изменившийся пак пересоздаётся.
   */
  async seedBuiltin(dir: string, options: { hidden?: boolean } = {}): Promise<void> {
    const raw = await readFile(path.join(dir, 'pack.json'), 'utf8');
    const manifest = parseManifest(raw);
    const seedHash = createHash('sha256').update(raw).digest('hex');
    const existing = this.db.select().from(packs).where(eq(packs.id, manifest.id)).get();
    if (
      existing?.seedHash === seedHash &&
      this.clipRows(manifest.id).length === manifest.clips.length
    ) {
      return;
    }
    if (existing) await this.removePack(manifest.id);

    const now = Date.now();
    this.db
      .insert(packs)
      .values({
        id: manifest.id,
        title: manifest.title,
        description: manifest.description,
        author: manifest.author,
        language: manifest.language,
        license: manifest.license,
        builtin: true,
        hidden: options.hidden ?? false,
        seedHash: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    for (const [position, clip] of manifest.clips.entries()) {
      await this.ingestClip(path.join(dir, clip.video), {
        packId: manifest.id,
        clipId: clip.id,
        position,
        markup: {
          title: clip.title,
          characters: clip.characters,
          lines: clip.lines,
          attribution: clip.attribution,
        },
        music: clip.music ? { file: path.join(dir, clip.music) } : 'none',
        requireFinalLength: true,
      });
    }
    // Хэш записываем последним: прерванный посев будет повторён при следующем запуске.
    this.db.update(packs).set({ seedHash }).where(eq(packs.id, manifest.id)).run();
    this.ctx.logger.info(
      { pack: manifest.id, clips: manifest.clips.length },
      'built-in pack seeded',
    );
  }
}

function parseManifest(raw: string): PackManifest {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new AppError('VALIDATION', 'pack.json is not valid JSON');
  }
  const parsed = packManifestSchema.safeParse(json);
  if (!parsed.success) {
    const details = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new AppError('VALIDATION', `pack.json: ${details}`);
  }
  return parsed.data;
}

// ── zip ───────────────────────────────────────────────────────────────────

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err || !zip) reject(new AppError('UNSUPPORTED_MEDIA', 'Cannot read the zip archive'));
      else resolve(zip);
    });
  });
}

function readEntries(zip: yauzl.ZipFile): Promise<Map<string, yauzl.Entry>> {
  return new Promise((resolve, reject) => {
    const entries = new Map<string, yauzl.Entry>();
    zip.on('entry', (entry: yauzl.Entry) => {
      // Каталоги пропускаем; имена с «..» yauzl отклоняет сам (ошибкой).
      if (!entry.fileName.endsWith('/')) entries.set(entry.fileName, entry);
      if (entries.size > 500) reject(new AppError('VALIDATION', 'Too many files in the archive'));
      else zip.readEntry();
    });
    zip.on('end', () => resolve(entries));
    zip.on('error', () =>
      reject(new AppError('UNSUPPORTED_MEDIA', 'The zip archive is corrupted')),
    );
    zip.readEntry();
  });
}

/** Распаковывает одну запись с жёстким лимитом размера (защита от zip-бомб). */
async function extractEntry(
  zip: yauzl.ZipFile,
  entry: yauzl.Entry,
  target: string,
  maxBytes: number,
): Promise<number> {
  if (entry.uncompressedSize > maxBytes)
    throw new AppError('TOO_LARGE', 'A file in the archive is too large');
  const stream = await new Promise<Readable>((resolve, reject) => {
    zip.openReadStream(entry, (err, s) => (err || !s ? reject(err) : resolve(s)));
  });
  let written = 0;
  stream.on('data', (chunk: Buffer) => {
    written += chunk.length;
    // Заголовку не верим: считаем реальные байты.
    if (written > maxBytes)
      stream.destroy(new AppError('TOO_LARGE', 'A file in the archive is too large'));
  });
  await pipeline(stream, createWriteStream(target));
  return written;
}
