import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppContext } from '../app';
import type { MediaPipeline } from '../game/types';
import type { StorageAdapter } from '../storage';
import { AppError } from '../util/errors';
import { probe, runFfmpeg, Semaphore, type ProbeResult } from './ffmpeg';
import { buildReviewGraph, buildTakeGraph, SAMPLE_RATE, VIDEO_FILTER } from './filters';

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dubparty-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const X264 = [
  '-c:v libx264',
  '-preset veryfast',
  '-crf 23',
  '-profile:v high',
  '-pix_fmt yuv420p',
  // Ключевой кадр каждую секунду — перемотка при общем просмотре попадает точно.
  '-g 30',
  '-keyint_min 30',
  '-sc_threshold 0',
  '-movflags +faststart',
];

export interface NormalizeOptions {
  startMs?: number;
  endMs?: number;
  /**
   * Что делать со звуком: 'none' — убрать, 'keep' — оставить дорожку исходника как музыку,
   * либо путь к отдельному файлу с музыкой.
   */
  music: 'none' | 'keep' | { file: string };
}

/** Все операции ffmpeg. Работает с локальными файлами; хранилище подключается выше. */
export class MediaTools {
  private readonly semaphore: Semaphore;

  constructor(concurrency: number) {
    this.semaphore = new Semaphore(concurrency);
  }

  probe(file: string): Promise<ProbeResult> {
    return probe(file);
  }

  /** Приводит видео к единому формату: H.264 ≤720p 30 fps (+ AAC, если нужна музыка). */
  normalizeVideo(input: string, output: string, options: NormalizeOptions): Promise<void> {
    const { startMs, endMs, music } = options;
    return this.semaphore.run(() =>
      runFfmpeg(
        (cmd) => {
          // Обрезка задаётся на входе: при перекодировании ffmpeg режет точно по кадрам,
          // а отдельный файл с музыкой (если он есть) при этом не сдвигается.
          const trim: string[] = [];
          if (startMs !== undefined) trim.push(`-ss ${(startMs / 1000).toFixed(3)}`);
          if (endMs !== undefined) trim.push(`-to ${(endMs / 1000).toFixed(3)}`);
          cmd.input(input).inputOptions(trim);

          const out = ['-map 0:v:0', `-vf ${VIDEO_FILTER}`, ...X264];
          if (music === 'none') {
            out.push('-an');
          } else {
            if (music === 'keep') out.push('-map 0:a:0');
            else {
              cmd.input(music.file);
              out.push('-map 1:a:0', '-shortest');
            }
            out.push('-c:a aac', '-b:a 160k', `-ar ${SAMPLE_RATE}`, '-ac 2');
          }
          out.push('-map_metadata -1', '-map_chapters -1');
          return cmd.outputOptions(out).output(output);
        },
        { timeoutMs: 10 * 60_000 },
      ),
    );
  }

  /** Вынимает звуковую дорожку в отдельный m4a (для экспорта пака). */
  extractAudio(input: string, output: string): Promise<void> {
    return this.semaphore.run(() =>
      runFfmpeg((cmd) =>
        cmd
          .input(input)
          .outputOptions([
            '-vn',
            '-map 0:a:0',
            '-c:a aac',
            '-b:a 160k',
            `-ar ${SAMPLE_RATE}`,
            '-ac 2',
          ])
          .output(output),
      ),
    );
  }

  poster(input: string, output: string, atMs: number): Promise<void> {
    return this.semaphore.run(() =>
      runFfmpeg((cmd) =>
        cmd
          .input(input)
          .inputOptions([`-ss ${(atMs / 1000).toFixed(3)}`])
          .outputOptions(['-frames:v 1', '-vf scale=640:-2', '-q:v 4', '-update 1'])
          .output(output),
      ),
    );
  }

  /** Дубль → WAV, выровненный по видео, с эффектом. */
  processTake(
    input: string,
    output: string,
    graph: Parameters<typeof buildTakeGraph>[0],
  ): Promise<void> {
    return this.semaphore.run(() =>
      runFfmpeg(
        (cmd) =>
          cmd
            .input(input)
            .complexFilter(buildTakeGraph(graph))
            .outputOptions(['-map [out]', '-c:a pcm_s16le', `-ar ${SAMPLE_RATE}`, '-ac 1'])
            .output(output),
        { timeoutMs: 90_000 },
      ),
    );
  }

  /** Клип + голоса → готовый mp4. Видео копируется без перекодирования. */
  buildReview(
    video: string,
    voices: string[],
    output: string,
    options: { hasMusic: boolean; durationMs: number },
  ): Promise<void> {
    return this.semaphore.run(() =>
      runFfmpeg(
        (cmd) => {
          cmd.input(video);
          for (const voice of voices) cmd.input(voice);
          return cmd
            .complexFilter(buildReviewGraph(voices.length, options.hasMusic, options.durationMs))
            .outputOptions([
              '-map 0:v:0',
              '-map [a]',
              '-c:v copy',
              '-c:a aac',
              '-b:a 160k',
              `-ar ${SAMPLE_RATE}`,
              '-ac 2',
              '-movflags +faststart',
              '-map_metadata -1',
            ])
            .output(output);
        },
        { timeoutMs: 120_000 },
      ),
    );
  }
}

async function nonEmpty(file: string): Promise<void> {
  const s = await stat(file).catch(() => null);
  if (!s || s.size === 0) throw new AppError('PROCESSING_FAILED', 'ffmpeg produced no output');
}

/** Реализация игрового конвейера поверх хранилища. */
export function createMediaPipeline(storage: StorageAdapter, tools: MediaTools): MediaPipeline {
  return {
    async processTake({ rawKey, outKey, offsetMs, effect, durationMs, windows }) {
      const raw = await storage.toLocalFile(rawKey);
      try {
        await withTempDir(async (dir) => {
          const out = path.join(dir, 'voice.wav');
          await tools.processTake(raw.path, out, { offsetMs, effect, durationMs, windows });
          await nonEmpty(out);
          await storage.putFile(outKey, out);
        });
      } finally {
        await raw.release();
      }
    },

    async buildReview({ videoKey, hasMusic, voiceKeys, outKey, durationMs }) {
      const video = await storage.toLocalFile(videoKey);
      const voices = await Promise.all(voiceKeys.map((k) => storage.toLocalFile(k)));
      try {
        await withTempDir(async (dir) => {
          const out = path.join(dir, 'review.mp4');
          await tools.buildReview(
            video.path,
            voices.map((v) => v.path),
            out,
            { hasMusic, durationMs },
          );
          await nonEmpty(out);
          await storage.putFile(outKey, out);
        });
      } finally {
        await Promise.all([video.release(), ...voices.map((v) => v.release())]);
      }
    },
  };
}

export function createMediaTools(ctx: Pick<AppContext, 'config'>): MediaTools {
  return new MediaTools(ctx.config.FFMPEG_CONCURRENCY);
}
