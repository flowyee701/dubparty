import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import ffmpeg, { type FfmpegCommand, type FfprobeData } from 'fluent-ffmpeg';
import { AppError } from '../util/errors';

const require = createRequire(import.meta.url);

function optionalPath(load: () => unknown): string | undefined {
  try {
    const value = load();
    return typeof value === 'string' && existsSync(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export interface FfmpegPaths {
  ffmpeg: string;
  ffprobe: string;
}

/**
 * Порядок поиска бинарников: явный путь из окружения → npm-пакеты
 * ffmpeg-static / ffprobe-static → системные из PATH.
 */
export function resolveFfmpegPaths(env: {
  FFMPEG_PATH?: string;
  FFPROBE_PATH?: string;
}): FfmpegPaths {
  return {
    ffmpeg: env.FFMPEG_PATH ?? optionalPath(() => require('ffmpeg-static')) ?? 'ffmpeg',
    ffprobe:
      env.FFPROBE_PATH ??
      optionalPath(() => (require('ffprobe-static') as { path: string }).path) ??
      'ffprobe',
  };
}

export function configureFfmpeg(paths: FfmpegPaths): void {
  ffmpeg.setFfmpegPath(paths.ffmpeg);
  ffmpeg.setFfprobePath(paths.ffprobe);
}

/** Ограничивает число одновременных задач ffmpeg, чтобы всплеск загрузок не положил сервер. */
export class Semaphore {
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

export interface RunOptions {
  timeoutMs?: number;
}

/** Запускает команду ffmpeg и превращает её события в промис. Зависший процесс убивается. */
export function runFfmpeg(
  build: (cmd: FfmpegCommand) => FfmpegCommand,
  { timeoutMs = 120_000 }: RunOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = build(ffmpeg({ logger: undefined }));
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      cmd.kill('SIGKILL');
      reject(new AppError('PROCESSING_FAILED', 'ffmpeg timed out'));
    }, timeoutMs);
    cmd
      .on('end', () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      })
      .on('error', (err: Error, _stdout: string | null, stderr: string | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const tail = (stderr ?? '').trim().split('\n').slice(-6).join('\n');
        const error = new AppError('PROCESSING_FAILED', 'ffmpeg failed');
        error.cause = new Error(`${err.message}\n${tail}`);
        reject(error);
      })
      .run();
  });
}

export interface ProbeResult {
  durationMs: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width: number;
  height: number;
  formatName: string;
  videoCodec: string | null;
  audioCodec: string | null;
}

export function probe(file: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(file, (err: Error | null, data: FfprobeData) => {
      if (err) {
        reject(new AppError('UNSUPPORTED_MEDIA', 'File is not a readable media file'));
        return;
      }
      const video = data.streams.find(
        // Обложки в аудиофайлах помечены как видеопоток — их не считаем.
        (s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1,
      );
      const audio = data.streams.find((s) => s.codec_type === 'audio');
      // Длительность берём по видеодорожке: звук из-за заполнения кодека бывает чуть длиннее.
      const duration = [video?.duration, data.format.duration, audio?.duration]
        .map((d) => Number(d))
        .find((d) => Number.isFinite(d) && d > 0);
      resolve({
        durationMs: duration ? Math.round(duration * 1000) : 0,
        hasVideo: !!video,
        hasAudio: !!audio,
        width: video?.width ?? 0,
        height: video?.height ?? 0,
        formatName: data.format.format_name ?? '',
        videoCodec: video?.codec_name ?? null,
        audioCodec: audio?.codec_name ?? null,
      });
    });
  });
}
