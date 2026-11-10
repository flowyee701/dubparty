import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ByteRange } from '../storage';
import { AppError } from '../util/errors';

/**
 * Тела загрузок (видео, аудио, zip) приходят «как есть» и не буферизуются в памяти:
 * обработчик получает поток и сам пишет его на диск с подсчётом байтов.
 */
export function registerRawBodyParser(fastify: FastifyInstance): void {
  fastify.addContentTypeParser('*', (_request, payload, done) => done(null, payload));
}

export async function receiveToFile(
  request: FastifyRequest,
  dir: string,
  maxBytes: number,
): Promise<{ file: string; size: number }> {
  const body = request.body;
  if (!(body instanceof Readable)) throw new AppError('VALIDATION', 'Request body is required');
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    body.resume();
    throw new AppError('TOO_LARGE', 'File is too large');
  }
  const file = path.join(dir, 'upload.bin');
  let size = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      size += chunk.length;
      // Content-Length можно подделать или не прислать — считаем сами.
      if (size > maxBytes) cb(new AppError('TOO_LARGE', 'File is too large'));
      else cb(null, chunk);
    },
  });
  try {
    await pipeline(body, counter, createWriteStream(file));
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('VALIDATION', 'Upload was interrupted');
  }
  if (size === 0) throw new AppError('VALIDATION', 'File is empty');
  return { file, size };
}

export function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice(7).trim() || undefined;
}

export function packToken(request: FastifyRequest): string | undefined {
  const header = request.headers['x-pack-token'];
  return typeof header === 'string' && header ? header : undefined;
}

/** Разбор заголовка Range (один диапазон). null — заголовка нет, 'invalid' — неудовлетворим. */
export function parseRange(header: string | undefined, size: number): ByteRange | null | 'invalid' {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return 'invalid';
  let start: number;
  let end: number;
  if (match[1] === '') {
    // «Последние N байт»
    const suffix = Number(match[2]);
    if (suffix === 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start >= size || start > end) return 'invalid';
  return { start, end };
}

/** Заголовок Content-Disposition с именем в UTF-8 и безопасным ASCII-запасным вариантом. */
export function attachment(filename: string): string {
  const clean = filename.replace(/[\\/:*?"<>|\p{Cc}]/gu, '_').slice(0, 120);
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

const PUBLIC_MEDIA = [
  /^packs\/[\w-]+\/[\w-]+\/(source|video|poster)-[\w-]+\.(mp4|jpg)$/,
  /^rooms\/[A-Z]{4}\/r\d+\/entries\/[\w-]+\.mp4$/,
];

/** Раздаются только готовые клипы и собранные записи; сырые дубли наружу не отдаются. */
export function isPublicMediaKey(key: string): boolean {
  return PUBLIC_MEDIA.some((re) => re.test(key));
}
