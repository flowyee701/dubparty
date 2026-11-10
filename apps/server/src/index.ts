import { createApp } from './app';
import { loadConfig } from './config';
import { createLogger } from './logger';
import { plugins } from './plugins';

async function main() {
  const config = loadConfig();
  const logger = createLogger(config);
  const app = await createApp(config, logger, plugins);

  await app.fastify.listen({ host: config.HOST, port: config.PORT });
  logger.info(
    { storage: app.ctx.storage.kind, env: config.NODE_ENV },
    `DubParty server ready${config.PUBLIC_URL ? ` — ${config.PUBLIC_URL}` : ''}`,
  );

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    // Страховка: если что-то зависло, выходим принудительно.
    const force = setTimeout(() => {
      logger.error('forced exit after shutdown timeout');
      process.exit(1);
    }, 10_000);
    force.unref();
    app
      .close()
      .then(() => process.exit(0))
      .catch((err) => {
        logger.error({ err }, 'shutdown failed');
        process.exit(1);
      });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Ошибка в одном обработчике не должна ронять сервер со всеми комнатами.
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'uncaught exception');
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
