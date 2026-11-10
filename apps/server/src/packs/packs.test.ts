import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { EditorClip, PackDetail, PackSummary } from '@dubparty/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type App } from '../app';
import { loadConfig } from '../config';
import { silentLogger } from '../logger';
import { assetsDir, createGamePlugin, type Services } from '../plugins';

const DEMO = path.join(assetsDir(), 'demo-pack');

describe('паки: HTTP API, обработка видео, импорт и экспорт', () => {
  let app: App;
  let services: Services;
  let dir: string;
  let packId: string;
  let token: string;
  let clip: EditorClip;
  let exported: Buffer;

  const call = async (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    options: { body?: unknown; raw?: Buffer; token?: string; type?: string } = {},
  ) => {
    const res = await app.fastify.inject({
      method,
      url,
      headers: {
        ...(options.token ? { 'x-pack-token': options.token } : {}),
        ...(options.raw ? { 'content-type': options.type ?? 'video/mp4' } : {}),
      },
      ...(options.raw
        ? { payload: options.raw }
        : options.body !== undefined
          ? { payload: options.body as object }
          : {}),
    });
    return res;
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'dubparty-packs-'));
    const config = loadConfig({
      NODE_ENV: 'test',
      DATA_DIR: path.join(dir, 'data'),
      STORAGE_DIR: path.join(dir, 'storage'),
      CLIENT_DIST: path.join(dir, 'none'),
      UPLOAD_RATE_LIMIT: '1000',
    });
    app = await createApp(config, silentLogger, [
      createGamePlugin({ seed: false, onReady: (s) => (services = s) }),
    ]);
  });

  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('встроенный пак засевается из каталога и повторно не пересоздаётся', async () => {
    await services.packs.seedBuiltin(DEMO);
    const first = services.packs.getDetail('demo')!;
    expect(first.builtin).toBe(true);
    expect(first.clips.map((c) => c.id)).toEqual(['robots', 'weather', 'catdog', 'space']);
    expect(first.clips.find((c) => c.id === 'robots')).toMatchObject({ hasMusic: true });
    expect(first.clips.find((c) => c.id === 'weather')).toMatchObject({ hasMusic: false });
    expect(first.multiRoleClipCount).toBe(3);

    await services.packs.seedBuiltin(DEMO);
    const second = services.packs.getDetail('demo')!;
    expect(second.clips.map((c) => c.videoUrl)).toEqual(first.clips.map((c) => c.videoUrl));

    const playable = services.packs.getPlayable('demo')!;
    expect(playable.clips).toHaveLength(4);
    expect(await app.ctx.storage.stat(playable.clips[0]!.videoKey)).not.toBeNull();
    expect(await app.ctx.storage.stat(playable.clips[0]!.posterKey)).not.toBeNull();
  }, 120_000);

  it('встроенный пак нельзя менять', async () => {
    const res = await call('PATCH', '/api/packs/demo', {
      body: { title: 'Взлом' },
      token: 'x'.repeat(43),
    });
    expect(res.statusCode).toBe(403);
    expect((await call('DELETE', '/api/packs/demo/clips/robots', { token: 'x' })).statusCode).toBe(
      403,
    );
  });

  it('создание пака выдаёт токен владельца', async () => {
    const bad = await call('POST', '/api/packs', { body: { title: '' } });
    expect(bad.statusCode).toBe(400);

    const res = await call('POST', '/api/packs', {
      body: { title: '  Мой пак ', description: 'Тест' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ pack: PackDetail; ownerToken: string }>();
    expect(body.pack).toMatchObject({ title: 'Мой пак', builtin: false, clipCount: 0 });
    expect(body.ownerToken).toMatch(/^[\w-]{40,}$/);
    packId = body.pack.id;
    token = body.ownerToken;

    const list = (await call('GET', '/api/packs')).json<{ packs: PackSummary[] }>().packs;
    expect(list.map((p) => p.id)).toEqual(['demo', packId]);
  });

  it('загрузка видео: проверка сигнатуры, прав и содержимого', async () => {
    const video = readFileSync(path.join(DEMO, 'clips/weather/video.mp4'));
    const url = `/api/packs/${packId}/clips?title=${encodeURIComponent('Погода')}`;

    expect((await call('POST', url, { raw: video })).statusCode).toBe(403);
    expect((await call('POST', url, { raw: video, token: 'wrong' })).statusCode).toBe(403);

    // Не видео, хоть и названо видео
    const text = await call('POST', url, { raw: Buffer.from('not a video '.repeat(100)), token });
    expect(text.statusCode).toBe(415);
    // Сигнатура mp4 есть, содержимого нет
    const fake = Buffer.concat([Buffer.from('\0\0\0\x20ftypisom', 'latin1'), Buffer.alloc(2000)]);
    expect((await call('POST', url, { raw: fake, token })).statusCode).toBe(415);
    // Аудиофайл без видеодорожки
    const audio = readFileSync(path.join(DEMO, 'clips/robots/music.m4a'));
    expect((await call('POST', url, { raw: audio, token })).statusCode).toBe(415);

    const res = await call('POST', url, { raw: video, token });
    expect(res.statusCode).toBe(200);
    clip = res.json<{ clip: EditorClip }>().clip;
    expect(clip).toMatchObject({ title: 'Погода', hasMusic: false, trimStartMs: 0 });
    expect(Math.abs(clip.durationMs - 13_000)).toBeLessThan(100);
    expect(clip.characters).toHaveLength(1);

    const media = await app.fastify.inject({
      method: 'GET',
      url: clip.videoUrl,
      headers: { range: 'bytes=0-99' },
    });
    expect(media.statusCode).toBe(206);
    expect(
      (await app.fastify.inject({ method: 'GET', url: clip.posterUrl })).headers['content-type'],
    ).toBe('image/jpeg');
  }, 120_000);

  it('разметка реплик проверяется и сохраняется', async () => {
    const url = `/api/packs/${packId}/clips/${clip.id}/markup`;
    const markup = {
      title: 'Прогноз',
      characters: [
        { id: 'a', name: 'Ведущий', color: '#3b82f6' },
        { id: 'b', name: 'Гость', color: '#ef4444' },
      ],
      lines: [
        { id: 'l2', characterId: 'b', startMs: 7000, endMs: 9000, text: 'Вторая' },
        { id: 'l1', characterId: 'a', startMs: 3000, endMs: 5000, text: '  Первая   реплика ' },
      ],
    };
    expect((await call('PUT', url, { body: markup })).statusCode).toBe(403);

    const unknown = { ...markup, lines: [{ ...markup.lines[0]!, characterId: 'zzz' }] };
    expect((await call('PUT', url, { body: unknown, token })).statusCode).toBe(400);
    const late = { ...markup, lines: [{ ...markup.lines[0]!, startMs: 50_000, endMs: 55_000 }] };
    expect((await call('PUT', url, { body: late, token })).statusCode).toBe(400);

    const res = await call('PUT', url, { body: markup, token });
    expect(res.statusCode).toBe(200);
    clip = res.json<{ clip: EditorClip }>().clip;
    // Реплики отсортированы по времени, текст вычищен
    expect(clip.lines.map((l) => l.id)).toEqual(['l1', 'l2']);
    expect(clip.lines[0]!.text).toBe('Первая реплика');
    expect(clip.title).toBe('Прогноз');
  });

  it('обрезка перерезает клип и сдвигает таймкоды реплик', async () => {
    const url = `/api/packs/${packId}/clips/${clip.id}/trim`;
    expect((await call('PUT', url, { body: { startMs: 0, endMs: 500 }, token })).statusCode).toBe(
      400,
    );

    const before = clip.videoUrl;
    const res = await call('PUT', url, { body: { startMs: 2000, endMs: 8000 }, token });
    expect(res.statusCode).toBe(200);
    clip = res.json<{ clip: EditorClip }>().clip;
    expect(Math.abs(clip.durationMs - 6000)).toBeLessThan(100);
    expect(clip).toMatchObject({ trimStartMs: 2000, trimEndMs: 8000 });
    expect(clip.videoUrl).not.toBe(before);
    // Первая реплика сдвинулась на 2 с назад, вторая обрезана по концу клипа
    expect(clip.lines).toMatchObject([
      { id: 'l1', startMs: 1000, endMs: 3000 },
      { id: 'l2', startMs: 5000, endMs: 6000 },
    ]);

    const key = clip.videoUrl.replace('/api/media/', '');
    const local = await app.ctx.storage.toLocalFile(key);
    const info = await services.tools.probe(local.path);
    expect(Math.abs(info.durationMs - 6000)).toBeLessThan(100);

    // Возврат к исходной длине: клип снова совпадает с исходником
    const back = await call('PUT', url, { body: { startMs: 0, endMs: 13_000 }, token });
    clip = back.json<{ clip: EditorClip }>().clip;
    expect(clip.videoUrl).toBe(clip.sourceUrl);
    expect(clip.lines[0]).toMatchObject({ startMs: 3000, endMs: 5000 });
  }, 120_000);

  it('клип с музыкой: звук исходника остаётся как музыкальная дорожка', async () => {
    // Собираем видео со звуком из демо-клипа и его музыки
    const withAudio = path.join(dir, 'with-audio.mp4');
    await services.tools.normalizeVideo(path.join(DEMO, 'clips/robots/video.mp4'), withAudio, {
      music: { file: path.join(DEMO, 'clips/robots/music.m4a') },
    });
    const raw = readFileSync(withAudio);
    const keep = await call('POST', `/api/packs/${packId}/clips?title=Robots&keepAudio=1`, {
      raw,
      token,
    });
    expect(keep.json<{ clip: EditorClip }>().clip.hasMusic).toBe(true);
    const drop = await call('POST', `/api/packs/${packId}/clips?title=Silent`, { raw, token });
    expect(drop.json<{ clip: EditorClip }>().clip.hasMusic).toBe(false);

    const pack = (await call('GET', `/api/packs/${packId}`)).json<{ pack: PackDetail }>().pack;
    expect(pack.clips.map((c) => c.title)).toEqual(['Прогноз', 'Robots', 'Silent']);

    // Порядок клипов
    const last = pack.clips[2]!;
    const moved = await call('POST', `/api/packs/${packId}/clips/${last.id}/move`, {
      body: { direction: 'up' },
      token,
    });
    expect(moved.json<{ pack: PackDetail }>().pack.clips.map((c) => c.title)).toEqual([
      'Прогноз',
      'Silent',
      'Robots',
    ]);

    expect(
      (await call('DELETE', `/api/packs/${packId}/clips/${last.id}`, { token })).statusCode,
    ).toBe(200);
    expect(await app.ctx.storage.stat(last.videoUrl.replace('/api/media/', ''))).toBeNull();
  }, 180_000);

  it('экспорт в zip и импорт обратно дают тот же пак', async () => {
    const res = await call('GET', `/api/packs/${packId}/export`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(String(res.headers['content-disposition'])).toContain('.dubpack.zip');
    exported = res.rawPayload;
    expect(exported.subarray(0, 2).toString()).toBe('PK');

    const imported = await call('POST', '/api/packs/import', {
      raw: exported,
      type: 'application/zip',
    });
    expect(imported.statusCode).toBe(200);
    const body = imported.json<{ pack: PackDetail; ownerToken: string }>();
    expect(body.pack.id).not.toBe(packId);
    expect(body.pack).toMatchObject({ title: 'Мой пак', description: 'Тест', clipCount: 2 });
    const [weather, robots] = body.pack.clips;
    expect(weather).toMatchObject({ title: 'Прогноз', hasMusic: false });
    expect(weather!.lines.map((l) => l.text)).toEqual(['Первая реплика', 'Вторая']);
    expect(weather!.characters.map((c) => c.name)).toEqual(['Ведущий', 'Гость']);
    // Музыка пережила круг экспорт → импорт
    expect(robots).toMatchObject({ title: 'Robots', hasMusic: true });

    // Импортированный пак — свой: его можно редактировать выданным токеном
    const renamed = await call('PATCH', `/api/packs/${body.pack.id}`, {
      body: { title: 'Копия' },
      token: body.ownerToken,
    });
    expect(renamed.json<{ pack: PackDetail }>().pack.title).toBe('Копия');

    expect((await call('DELETE', `/api/packs/${body.pack.id}`, { token })).statusCode).toBe(403);
    expect(
      (await call('DELETE', `/api/packs/${body.pack.id}`, { token: body.ownerToken })).statusCode,
    ).toBe(200);
    expect((await call('GET', `/api/packs/${body.pack.id}`)).statusCode).toBe(404);
  }, 180_000);

  it('импорт отклоняет не-архивы, архивы без pack.json и с битым манифестом', async () => {
    const send = (raw: Buffer) =>
      call('POST', '/api/packs/import', { raw, type: 'application/zip' });
    expect((await send(Buffer.from('hello world, definitely not a zip'))).statusCode).toBe(415);

    const { ZipArchive } = await import('archiver');
    const zip = async (files: Record<string, string | Buffer>) => {
      const archive = new ZipArchive();
      const chunks: Buffer[] = [];
      archive.on('data', (c: Buffer) => chunks.push(c));
      for (const [name, content] of Object.entries(files)) archive.append(content, { name });
      await archive.finalize();
      return Buffer.concat(chunks);
    };

    const noManifest = await send(await zip({ 'readme.txt': 'hi' }));
    expect(noManifest.statusCode).toBe(400);
    expect(noManifest.json()).toMatchObject({
      error: { message: expect.stringContaining('pack.json') },
    });

    const broken = await send(await zip({ 'pack.json': '{ not json' }));
    expect(broken.statusCode).toBe(400);

    const manifest = {
      formatVersion: 1,
      id: 'evil',
      title: 'Evil',
      clips: [
        {
          id: 'c',
          title: 'C',
          video: '../../etc/passwd',
          durationMs: 5000,
          characters: [{ id: 'a', name: 'A', color: '#ffffff' }],
          lines: [],
        },
      ],
    };
    // Путь с выходом из архива отклоняется схемой
    expect((await send(await zip({ 'pack.json': JSON.stringify(manifest) }))).statusCode).toBe(400);

    // Файл, названный в манифесте, отсутствует — пак не остаётся наполовину созданным
    manifest.clips[0]!.video = 'clips/c/video.mp4';
    const before = services.packs.list().length;
    const missing = await send(await zip({ 'pack.json': JSON.stringify(manifest) }));
    expect(missing.statusCode).toBe(400);
    // Вместо видео подложен текст
    const notVideo = await send(
      await zip({ 'pack.json': JSON.stringify(manifest), 'clips/c/video.mp4': 'plain text' }),
    );
    expect(notVideo.statusCode).toBe(415);
    expect(services.packs.list()).toHaveLength(before);
  }, 60_000);

  it('удаление пака убирает и его файлы', async () => {
    writeFileSync(path.join(dir, 'export.zip'), exported);
    const key = clip.sourceUrl.replace('/api/media/', '');
    expect(await app.ctx.storage.stat(key)).not.toBeNull();
    expect((await call('DELETE', `/api/packs/${packId}`, { token })).statusCode).toBe(200);
    expect(await app.ctx.storage.stat(key)).toBeNull();
    expect(services.packs.exists(packId)).toBe(false);
  });
});
