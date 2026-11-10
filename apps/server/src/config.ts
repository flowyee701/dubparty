import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Корень репозитория: поднимаемся вверх до pnpm-workspace.yaml. */
function findRoot(): string {
  if (process.env.DUBPARTY_ROOT) return path.resolve(process.env.DUBPARTY_ROOT);
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export const ROOT_DIR = findRoot();

const envFile = path.join(ROOT_DIR, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const bool = z
  .string()
  .transform((v) => ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase()));
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3001),
  PUBLIC_URL: optionalString,
  CORS_ORIGINS: optionalString,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: bool.default(false),

  DATA_DIR: z.string().default('./data'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_DIR: z.string().default('./storage'),
  S3_BUCKET: optionalString,
  S3_REGION: z.string().default('auto'),
  S3_ENDPOINT: optionalString,
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_FORCE_PATH_STYLE: bool.default(true),
  S3_PREFIX: z.string().default(''),

  FFMPEG_PATH: optionalString,
  FFPROBE_PATH: optionalString,
  FFMPEG_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),

  ROOM_TTL_HOURS: z.coerce
    .number()
    .min(0)
    .max(24 * 30)
    .default(6),
  ROOM_IDLE_HOURS: z.coerce
    .number()
    .min(0.01)
    .max(24 * 30)
    .default(12),

  MAX_ROOMS: z.coerce.number().int().min(1).default(500),
  MAX_ROOM_FILES: z.coerce.number().int().min(10).default(600),
  MAX_ROOM_MB: z.coerce.number().min(10).default(2048),
  HTTP_RATE_LIMIT: z.coerce.number().int().min(10).default(600),
  UPLOAD_RATE_LIMIT: z.coerce.number().int().min(1).default(60),

  /** Каталог собранного клиента. По умолчанию apps/client/dist. */
  CLIENT_DIST: optionalString,
  /** Переопределение длительностей фаз (JSON) — для тестов. */
  DUBPARTY_TIMINGS: optionalString,
  /** Засеять калибровочный пак для теста синхронизации. */
  SEED_CALIBRATION_PACK: bool.default(false),
});

export type Env = z.infer<typeof envSchema>;

export interface Config extends Env {
  rootDir: string;
  dataDir: string;
  storageDir: string;
  clientDist: string;
  corsOrigins: string[];
  isProd: boolean;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Некорректная конфигурация окружения: ${details}`);
  }
  const env = parsed.data;
  if (env.STORAGE_DRIVER === 's3' && !env.S3_BUCKET) {
    throw new Error('STORAGE_DRIVER=s3 требует S3_BUCKET');
  }
  const resolve = (p: string) => (path.isAbsolute(p) ? p : path.resolve(ROOT_DIR, p));
  return {
    ...env,
    rootDir: ROOT_DIR,
    dataDir: resolve(env.DATA_DIR),
    storageDir: resolve(env.STORAGE_DIR),
    clientDist: resolve(env.CLIENT_DIST ?? 'apps/client/dist'),
    corsOrigins: (env.CORS_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    isProd: env.NODE_ENV === 'production',
  };
}
