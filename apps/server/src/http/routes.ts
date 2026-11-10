import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  clipTrimSchema,
  idSchema,
  LIMITS,
  roomCodeSchema,
  takeUploadQuerySchema,
  type PublicConfig,
} from '@dubparty/shared';
import { ZipArchive } from 'archiver';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { APP_VERSION, type AppContext } from '../app';
import type { GameController } from '../game/controller';
import type { RoomManager } from '../game/manager';
import { TAKE_EXTENSIONS, type TakeExtension } from '../game/session';
import { withTempDir } from '../media/pipeline';
import { sniffFile } from '../media/sniff';
import type { PackService } from '../packs/service';
import { contentTypeFor } from '../storage';
import { AppError } from '../util/errors';
import {
  attachment,
  bearerToken,
  isPublicMediaKey,
  packToken,
  parseRange,
  receiveToFile,
  registerRawBodyParser,
} from './util';

export interface RouteServices {
  manager: RoomManager;
  game: GameController;
  packs: PackService;
}

const packParams = z.object({ id: idSchema });
const clipParams = z.object({ id: idSchema, clipId: idSchema });
const addClipQuery = z.object({
  title: z.string().min(1).max(LIMITS.titleMax),
  keepAudio: z
    .enum(['0', '1'])
    .default('0')
    .transform((v) => v === '1'),
});
const moveBody = z.object({ direction: z.enum(['up', 'down']) });
const TAKE_KINDS: readonly string[] = TAKE_EXTENSIONS;

function safeName(value: string): string {
  return (
    value
      .replace(/[^\p{L}\p{N}_ -]/gu, '')
      .trim()
      .slice(0, 40) || 'player'
  );
}

export function registerRoutes(
  fastify: FastifyInstance,
  ctx: AppContext,
  services: RouteServices,
): void {
  const { config, storage } = ctx;
  const { manager, game, packs } = services;
  const uploadLimit = { rateLimit: { max: config.UPLOAD_RATE_LIMIT, timeWindow: '1 minute' } };

  registerRawBodyParser(fastify);

  fastify.get('/api/config', async (): Promise<PublicConfig> => ({
    version: APP_VERSION,
    twitchEnabled: config.TWITCH_ENABLED,
    limits: {
      clipUploadMaxBytes: LIMITS.clipUploadMaxBytes,
      clipMaxDurationMs: LIMITS.clipMaxDurationMs,
      sourceMaxDurationMs: LIMITS.sourceMaxDurationMs,
      takeMaxBytes: LIMITS.takeMaxBytes,
    },
  }));

  // ── Медиа ───────────────────────────────────────────────────────────────

  fastify.get('/api/media/*', async (request, reply) => {
    const key = (request.params as { '*': string })['*'];
    if (!isPublicMediaKey(key)) throw new AppError('NOT_FOUND', 'Not found');
    const info = await storage.stat(key);
    if (!info) throw new AppError('NOT_FOUND', 'Not found');

    void reply
      .header('Accept-Ranges', 'bytes')
      .header('Content-Type', contentTypeFor(key))
      .header(
        'Cache-Control',
        // В ключах паков есть ревизия, поэтому их можно кэшировать навсегда.
        key.startsWith('packs/') ? 'public, max-age=31536000, immutable' : 'private, max-age=3600',
      );

    const range = parseRange(request.headers.range, info.size);
    if (range === 'invalid') {
      return reply.code(416).header('Content-Range', `bytes */${info.size}`).send();
    }
    if (range) {
      return reply
        .code(206)
        .header('Content-Range', `bytes ${range.start}-${range.end}/${info.size}`)
        .header('Content-Length', range.end - range.start + 1)
        .send(await storage.createReadStream(key, range));
    }
    return reply.header('Content-Length', info.size).send(await storage.createReadStream(key));
  });

  // ── Дубли ───────────────────────────────────────────────────────────────

  fastify.post(
    '/api/rooms/:code/take',
    { bodyLimit: LIMITS.takeMaxBytes, config: uploadLimit },
    async (request) => {
      const code = roomCodeSchema.parse((request.params as { code: string }).code);
      const query = takeUploadQuerySchema.parse(request.query);
      const { room, player } = manager.authenticate(code, bearerToken(request));
      const session = game.of(room);
      // Проверяем фазу и лимиты до приёма тела, чтобы не принимать заведомо лишнее.
      session.prepareTake(player.id, query.round, 'webm');

      return withTempDir(async (dir) => {
        const { file, size } = await receiveToFile(request, dir, LIMITS.takeMaxBytes);
        const kind = await sniffFile(file);
        if (!TAKE_KINDS.includes(kind)) {
          throw new AppError('UNSUPPORTED_MEDIA', 'Unsupported audio format');
        }
        const { rawKey, seq } = session.prepareTake(player.id, query.round, kind as TakeExtension);
        await storage.putFile(rawKey, file);
        return session.submitTake(player.id, {
          rawKey,
          seq,
          size,
          offsetMs: query.offsetMs,
          effect: query.effect,
        });
      });
    },
  );

  // ── Экспорт озвучек ─────────────────────────────────────────────────────

  fastify.get('/api/rooms/:code/entries/:entryId/download', async (request, reply) => {
    const params = z.object({ code: roomCodeSchema, entryId: idSchema }).parse(request.params);
    const { room, player } = manager.authenticate(params.code, bearerToken(request));
    const found = game.of(room).findEntry(params.entryId);
    if (!found) throw new AppError('NOT_FOUND', 'Entry not found');
    // Свою озвучку может скачать автор, любую — хост.
    if (!found.entry.authorIds.includes(player.id) && room.hostId !== player.id) {
      throw new AppError('FORBIDDEN', 'You can only download your own dub');
    }
    const info = await storage.stat(found.entry.key);
    if (!info) throw new AppError('NOT_FOUND', 'File is no longer available');
    const authors = found.entry.authorIds
      .map((id) => safeName(room.getPlayer(id)?.nickname ?? ''))
      .join('+');
    return reply
      .header('Content-Type', 'video/mp4')
      .header('Content-Length', info.size)
      .header('Content-Disposition', attachment(`dubparty-r${found.round + 1}-${authors}.mp4`))
      .send(await storage.createReadStream(found.entry.key));
  });

  fastify.get('/api/rooms/:code/rounds/:round/download', async (request, reply) => {
    const params = z
      .object({ code: roomCodeSchema, round: z.coerce.number().int().min(0).max(20) })
      .parse(request.params);
    const { room, player } = manager.authenticate(params.code, bearerToken(request));
    room.requireHost(player.id);
    const round = game.of(room).entriesOf(params.round);
    if (!round || round.entries.length === 0) throw new AppError('NOT_FOUND', 'Nothing to export');

    const archive = new ZipArchive({ zlib: { level: 0 } });
    archive.on('error', (err) => request.log.error({ err }, 'round export failed'));
    for (const [i, entry] of round.entries.entries()) {
      const authors = entry.authorIds
        .map((id) => safeName(room.getPlayer(id)?.nickname ?? ''))
        .join('+');
      archive.append(await storage.createReadStream(entry.key), {
        name: `${String(i + 1).padStart(2, '0')}-${authors}.mp4`,
      });
    }
    void archive.finalize();
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', attachment(`dubparty-${room.code}-r${params.round + 1}.zip`))
      .send(archive);
  });

  // ── Паки ────────────────────────────────────────────────────────────────

  fastify.get('/api/packs', async () => ({ packs: packs.list() }));

  fastify.get('/api/packs/:id', async (request) => {
    const { id } = packParams.parse(request.params);
    const pack = packs.getDetail(id);
    if (!pack) throw new AppError('NOT_FOUND', 'Pack not found');
    return { pack };
  });

  fastify.post('/api/packs', { config: uploadLimit }, async (request) =>
    packs.createPack(request.body),
  );

  fastify.patch('/api/packs/:id', async (request) => {
    const { id } = packParams.parse(request.params);
    return { pack: packs.updatePack(id, packToken(request), request.body) };
  });

  fastify.delete('/api/packs/:id', async (request) => {
    const { id } = packParams.parse(request.params);
    await packs.deletePack(id, packToken(request));
    return { ok: true };
  });

  fastify.post(
    '/api/packs/:id/clips',
    { bodyLimit: LIMITS.clipUploadMaxBytes, config: uploadLimit },
    async (request) => {
      const { id } = packParams.parse(request.params);
      const query = addClipQuery.parse(request.query);
      return withTempDir(async (dir) => {
        const { file } = await receiveToFile(request, dir, LIMITS.clipUploadMaxBytes);
        return { clip: await packs.addClip(id, packToken(request), file, query) };
      });
    },
  );

  fastify.put('/api/packs/:id/clips/:clipId/markup', async (request) => {
    const { id, clipId } = clipParams.parse(request.params);
    return { clip: packs.updateClipMarkup(id, clipId, packToken(request), request.body) };
  });

  fastify.put('/api/packs/:id/clips/:clipId/trim', { config: uploadLimit }, async (request) => {
    const { id, clipId } = clipParams.parse(request.params);
    const trim = clipTrimSchema.parse(request.body);
    return { clip: await packs.trimClip(id, clipId, packToken(request), trim) };
  });

  fastify.post('/api/packs/:id/clips/:clipId/move', async (request) => {
    const { id, clipId } = clipParams.parse(request.params);
    packs.moveClip(id, clipId, packToken(request), moveBody.parse(request.body).direction);
    return { pack: packs.getDetail(id) };
  });

  fastify.delete('/api/packs/:id/clips/:clipId', async (request) => {
    const { id, clipId } = clipParams.parse(request.params);
    await packs.deleteClip(id, clipId, packToken(request));
    return { ok: true };
  });

  fastify.get('/api/packs/:id/export', { config: uploadLimit }, async (request, reply) => {
    const { id } = packParams.parse(request.params);
    // Каталог живёт, пока файл отдаётся; удаляем по завершении потока.
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dubparty-export-'));
    const cleanup = () => void rm(dir, { recursive: true, force: true });
    try {
      const { file, filename } = await packs.exportZip(id, dir);
      const stream = createReadStream(file);
      stream.on('close', cleanup);
      return reply
        .header('Content-Type', 'application/zip')
        .header('Content-Disposition', attachment(filename))
        .send(stream);
    } catch (err) {
      cleanup();
      throw err;
    }
  });

  fastify.post(
    '/api/packs/import',
    { bodyLimit: LIMITS.packZipMaxBytes, config: uploadLimit },
    async (request) =>
      withTempDir(async (dir) => {
        const { file } = await receiveToFile(request, dir, LIMITS.packZipMaxBytes);
        return packs.importZip(file);
      }),
  );
}
