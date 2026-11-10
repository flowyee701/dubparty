import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type App } from './app';
import { loadConfig } from './config';
import { silentLogger } from './logger';

describe('HTTP-каркас', () => {
  let app: App;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'dubparty-test-'));
    const config = loadConfig({
      NODE_ENV: 'test',
      DATA_DIR: path.join(dir, 'data'),
      STORAGE_DIR: path.join(dir, 'storage'),
      CLIENT_DIST: path.join(dir, 'no-client'),
    });
    app = await createApp(config, silentLogger);
  });

  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('отвечает на healthcheck', async () => {
    const res = await app.fastify.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });

  it('неизвестный маршрут — 404 в едином формате ошибок', async () => {
    const res = await app.fastify.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });
});

describe('loadConfig', () => {
  it('отклоняет некорректные значения', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET/);
  });

  it('разбирает булевы значения и списки', () => {
    const config = loadConfig({
      TRUST_PROXY: 'true',
      CORS_ORIGINS: 'https://a.example, https://b.example',
    });
    expect(config.TRUST_PROXY).toBe(true);
    expect(config.corsOrigins).toEqual(['https://a.example', 'https://b.example']);
  });
});
