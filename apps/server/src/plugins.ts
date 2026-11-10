import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Timings } from '@dubparty/shared';
import type { Server } from 'socket.io';
import type { AppPlugin } from './app';
import { GameController } from './game/controller';
import { RoomManager } from './game/manager';
import type { MediaPipeline, TwitchVoteSource } from './game/types';
import { registerRoutes } from './http/routes';
import { configureFfmpeg, resolveFfmpegPaths } from './media/ffmpeg';
import { createMediaPipeline, createMediaTools, type MediaTools } from './media/pipeline';
import { PackService } from './packs/service';
import { attachSockets } from './sockets';
import { TmiVoteSource } from './twitch/source';

export interface Services {
  manager: RoomManager;
  game: GameController;
  packs: PackService;
  tools: MediaTools;
  io: Server;
}

export interface GamePluginOptions {
  /** Подмена конвейера обработки (в тестах — чтобы не запускать ffmpeg). */
  media?: MediaPipeline;
  createTwitch?: () => TwitchVoteSource;
  timings?: Partial<Timings>;
  /** Засевать встроенные паки из каталога assets. */
  seed?: boolean;
  onReady?(services: Services): void;
}

/** Каталог assets лежит рядом с src (в разработке) и рядом с dist (в сборке). */
export function assetsDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets');
}

function parseTimings(raw: string | undefined): Partial<Timings> {
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object')
    throw new Error('DUBPARTY_TIMINGS must be a JSON object');
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`DUBPARTY_TIMINGS.${key} must be a non-negative number`);
    }
    out[key] = value;
  }
  return out;
}

export function createGamePlugin(options: GamePluginOptions = {}): AppPlugin {
  return async (fastify, ctx) => {
    const { config, logger, storage } = ctx;
    const paths = resolveFfmpegPaths(config);
    configureFfmpeg(paths);
    logger.debug({ paths }, 'ffmpeg binaries');

    const tools = createMediaTools(ctx);
    const packs = new PackService(ctx, tools);

    if (options.seed ?? true) {
      const demo = path.join(assetsDir(), 'demo-pack');
      if (existsSync(path.join(demo, 'pack.json'))) await packs.seedBuiltin(demo);
      else logger.warn({ dir: demo }, 'demo pack assets not found — run "pnpm demo:generate"');

      const calibration = path.join(assetsDir(), 'calibration-pack');
      if (config.SEED_CALIBRATION_PACK && existsSync(path.join(calibration, 'pack.json'))) {
        await packs.seedBuiltin(calibration, { hidden: true });
      }
    }

    const manager = new RoomManager(ctx, {
      packs,
      media: options.media ?? createMediaPipeline(storage, tools),
      createTwitch: options.createTwitch ?? (() => new TmiVoteSource()),
      timings: { ...parseTimings(config.DUBPARTY_TIMINGS), ...options.timings },
    });
    await manager.start();

    const game = new GameController();
    const io = attachSockets(fastify, ctx, manager, game);
    registerRoutes(fastify, ctx, { manager, game, packs });
    options.onReady?.({ manager, game, packs, tools, io });

    return async () => {
      // Предупреждаем клиентов, чтобы они показали понятное сообщение, а не «обрыв связи».
      io.emit('server:shutdown');
      await manager.stop();
      io.disconnectSockets(true);
      await new Promise<void>((resolve) => setImmediate(resolve));
    };
  };
}

/** Подсистемы сервера в порядке запуска. */
export const plugins: AppPlugin[] = [createGamePlugin()];
