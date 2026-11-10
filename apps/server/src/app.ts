import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { Config } from './config';
import { openDb, type DbHandle } from './db';
import type { Logger } from './logger';
import { createStorage, type StorageAdapter } from './storage';
import { AppError } from './util/errors';

export const APP_VERSION = '1.0.0';

export interface AppContext {
  config: Config;
  logger: Logger;
  db: DbHandle['db'];
  storage: StorageAdapter;
}

export interface App {
  fastify: FastifyInstance;
  ctx: AppContext;
  /** Останавливает приём соединений и освобождает ресурсы. */
  close(): Promise<void>;
}

export type AppPlugin = (
  fastify: FastifyInstance,
  ctx: AppContext,
) => Promise<(() => Promise<void>) | void>;

export async function createApp(
  config: Config,
  logger: Logger,
  plugins: AppPlugin[] = [],
  overrides: { storage?: StorageAdapter } = {},
): Promise<App> {
  const dbHandle = openDb(
    config.NODE_ENV === 'test' && config.DATA_DIR === ':memory:'
      ? ':memory:'
      : path.join(config.dataDir, 'dubparty.sqlite'),
  );
  const storage = overrides.storage ?? createStorage(config);
  const ctx: AppContext = { config, logger, db: dbHandle.db, storage };

  const fastify = Fastify({
    loggerInstance: logger as FastifyBaseLogger,
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
    // Запросы к API и медиа не логируем: их много, а полезное пишется в обработчиках.
    logController: new LogController({ disableRequestLogging: true }),
  });

  fastify.setErrorHandler((err, request, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: err.toJSON() });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION',
          message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        },
      });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) {
      return reply
        .status(429)
        .send({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
    }
    if (status === 413) {
      return reply.status(413).send({ error: { code: 'TOO_LARGE', message: 'Payload too large' } });
    }
    if (status && status >= 400 && status < 500) {
      return reply
        .status(status)
        .send({ error: { code: 'VALIDATION', message: (err as Error).message } });
    }
    request.log.error({ err, url: request.url }, 'unhandled request error');
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Internal error' } });
  });

  await fastify.register(fastifyCors, {
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : !config.isProd,
    exposedHeaders: ['Content-Disposition'],
  });

  await fastify.register(fastifyRateLimit, {
    max: config.HTTP_RATE_LIMIT,
    timeWindow: '1 minute',
    // Медиа раздаётся кусками по Range — это много запросов на один просмотр.
    allowList: (req) => req.url.startsWith('/api/media/') || !req.url.startsWith('/api/'),
  });

  fastify.get('/api/health', async () => ({
    ok: true,
    version: APP_VERSION,
    uptime: process.uptime(),
  }));

  const cleanups: (() => Promise<void>)[] = [];
  for (const plugin of plugins) {
    const cleanup = await plugin(fastify, ctx);
    if (cleanup) cleanups.push(cleanup);
  }

  // В продакшене тот же процесс раздаёт собранный клиент.
  if (existsSync(path.join(config.clientDist, 'index.html'))) {
    await fastify.register(fastifyStatic, {
      root: config.clientDist,
      wildcard: false,
      setHeaders: (res, filePath) => {
        const immutable = filePath.includes(`${path.sep}assets${path.sep}`);
        void res.header(
          'Cache-Control',
          immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    });
    fastify.setNotFoundHandler((request, reply) => {
      if (
        request.method !== 'GET' ||
        request.url.startsWith('/api/') ||
        request.url.startsWith('/socket.io/')
      ) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
      }
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    });
  } else {
    fastify.setNotFoundHandler((_request, reply) =>
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } }),
    );
  }

  let closed = false;
  return {
    fastify,
    ctx,
    async close() {
      if (closed) return;
      closed = true;
      for (const cleanup of cleanups.reverse()) {
        await cleanup().catch((err) => logger.error({ err }, 'cleanup failed'));
      }
      await fastify.close();
      await storage.close();
      dbHandle.close();
    },
  };
}
