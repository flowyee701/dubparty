import pino, { type Logger } from 'pino';
import type { Config } from './config';

export type { Logger };

export function createLogger(config: Pick<Config, 'LOG_LEVEL' | 'NODE_ENV'>): Logger {
  return pino({
    level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
    // Токены сессий и владельцев паков в логи не попадают.
    redact: {
      paths: ['req.headers.authorization', 'req.headers["x-pack-token"]', 'req.headers.cookie'],
      remove: true,
    },
    ...(config.NODE_ENV === 'development'
      ? {
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
  });
}

export const silentLogger: Logger = pino({ level: 'silent' });
