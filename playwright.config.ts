import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;

/**
 * E2E идут против продакшен-сборки: один сервер раздаёт и API, и клиент.
 * Перед запуском: pnpm build.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    locale: 'ru-RU',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'node apps/server/dist/index.js',
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      NODE_ENV: 'production',
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATA_DIR: './.e2e-data/data',
      STORAGE_DIR: './.e2e-data/storage',
      LOG_LEVEL: 'warn',
      SEED_CALIBRATION_PACK: 'true',
      TWITCH_ENABLED: 'false',
      // Короткие фазы, чтобы полный цикл укладывался в разумное время.
      DUBPARTY_TIMINGS: JSON.stringify({
        introMs: 2500,
        playbackPrerollMs: 1500,
        playbackGapMs: 500,
        votingMs: 60_000,
        resultsMs: 60_000,
      }),
    },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['microphone'],
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
          ],
        },
      },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
