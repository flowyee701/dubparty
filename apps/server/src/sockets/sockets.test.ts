import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type {
  Ack,
  ClientEventInput,
  ClientEventName,
  ClientEventResults,
  ClientToServerEvents,
  RoomState,
  ServerToClientEvents,
} from '@dubparty/shared';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type App } from '../app';
import { loadConfig } from '../config';
import { schema } from '../db';
import { silentLogger } from '../logger';
import { createGamePlugin, type Services } from '../plugins';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

const profile = (nickname: string) => ({ nickname, avatar: 'cat', color: '#3b82f6' }) as const;
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(600, 1)]);

describe('сокеты и HTTP вместе', () => {
  let app: App;
  let services: Services;
  let dir: string;
  let url: string;
  const clients: Client[] = [];

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'dubparty-sock-'));
    const config = loadConfig({
      NODE_ENV: 'test',
      DATA_DIR: path.join(dir, 'data'),
      STORAGE_DIR: path.join(dir, 'storage'),
      CLIENT_DIST: path.join(dir, 'none'),
      UPLOAD_RATE_LIMIT: '1000',
    });
    app = await createApp(config, silentLogger, [
      createGamePlugin({
        seed: false,
        media: { processTake: async () => {}, buildReview: async () => {} },
        timings: { introMs: 30, lobbyDisconnectMs: 60_000, hostGraceMs: 60_000 },
        onReady: (s) => (services = s),
      }),
    ]);
    const now = Date.now();
    app.ctx.db
      .insert(schema.packs)
      .values({ id: 'demo', title: 'Demo', builtin: true, createdAt: now, updatedAt: now })
      .run();
    app.ctx.db
      .insert(schema.clips)
      .values({
        packId: 'demo',
        id: 'c1',
        position: 0,
        title: 'Clip',
        videoKey: 'packs/demo/c1/source-x.mp4',
        posterKey: 'packs/demo/c1/poster-x.jpg',
        sourceKey: 'packs/demo/c1/source-x.mp4',
        durationMs: 5000,
        sourceDurationMs: 5000,
        trimEndMs: 5000,
        characters: [{ id: 'a', name: 'A', color: '#ff0000' }],
        lines: [],
      })
      .run();
    await app.ctx.storage.putBuffer('packs/demo/c1/source-x.mp4', Buffer.from('0123456789'));
    await app.fastify.listen({ port: 0, host: '127.0.0.1' });
    url = `http://127.0.0.1:${(app.fastify.server.address() as AddressInfo).port}`;
  });

  afterEach(() => {
    for (const c of clients.splice(0)) c.disconnect();
  });

  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function client(): Promise<Client> {
    const socket: Client = connect(url, { transports: ['websocket'], forceNew: true });
    clients.push(socket);
    return new Promise((resolve, reject) => {
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  }

  function call<E extends ClientEventName>(
    socket: Client,
    event: E,
    payload: ClientEventInput<E>,
  ): Promise<Ack<ClientEventResults[E]>> {
    return new Promise((resolve) => {
      (
        socket.emit as (e: string, p: unknown, ack: (r: Ack<ClientEventResults[E]>) => void) => void
      )(event, payload, resolve);
    });
  }

  async function ok<E extends ClientEventName>(
    socket: Client,
    event: E,
    payload: ClientEventInput<E>,
  ) {
    const res = await call(socket, event, payload);
    if (!res.ok) throw new Error(`${event} failed: ${res.error.code} ${res.error.message}`);
    return res.data;
  }

  function nextState(socket: Client, predicate: (s: RoomState) => boolean): Promise<RoomState> {
    return new Promise((resolve) => {
      const handler = (state: RoomState) => {
        if (!predicate(state)) return;
        socket.off('room:state', handler);
        resolve(state);
      };
      socket.on('room:state', handler);
    });
  }

  it('создание комнаты, вход по коду и рассылка состояния', async () => {
    const host = await client();
    const guest = await client();
    const created = await ok(host, 'room:create', profile('Хост'));
    expect(created.roomCode).toMatch(/^[A-Z]{4}$/);
    expect(created.state.players).toHaveLength(1);

    const hostSees = nextState(host, (s) => s.players.length === 2);
    const joined = await ok(guest, 'room:join', {
      ...profile('Гость'),
      roomCode: created.roomCode.toLowerCase(),
    });
    expect(joined.state.hostId).toBe(created.playerId);
    expect((await hostSees).players.map((p) => p.nickname)).toEqual(['Хост', 'Гость']);
  });

  it('некорректные данные отклоняются валидацией, а не доходят до логики', async () => {
    const socket = await client();
    const bad = await call(socket, 'room:create', {
      nickname: '',
      avatar: 'cat',
      color: '#3b82f6',
    });
    expect(bad).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });

    const hacked = await call(socket, 'room:create', {
      nickname: 'x',
      avatar: 'dragon',
      color: 'red',
    } as never);
    expect(hacked).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });

    expect(await call(socket, 'room:join', { ...profile('x'), roomCode: 'ZZZZ' })).toMatchObject({
      ok: false,
      error: { code: 'ROOM_NOT_FOUND' },
    });
    // Действия без комнаты
    expect(await call(socket, 'game:start', undefined)).toMatchObject({
      ok: false,
      error: { code: 'NOT_IN_ROOM' },
    });
  });

  it('переподключение по токену возвращает в ту же комнату тем же игроком', async () => {
    const host = await client();
    const created = await ok(host, 'room:create', profile('Хост'));
    host.disconnect();

    const again = await client();
    const resumed = await ok(again, 'session:resume', {
      roomCode: created.roomCode,
      sessionToken: created.sessionToken,
    });
    expect(resumed.playerId).toBe(created.playerId);
    expect(resumed.state.players[0]).toMatchObject({ nickname: 'Хост', connected: true });

    expect(
      await call(again, 'session:resume', {
        roomCode: created.roomCode,
        sessionToken: 'x'.repeat(43),
      }),
    ).toMatchObject({ ok: false, error: { code: 'SESSION_EXPIRED' } });
  });

  it('исключённый игрок получает уведомление и теряет доступ', async () => {
    const host = await client();
    const guest = await client();
    const created = await ok(host, 'room:create', profile('Хост'));
    const joined = await ok(guest, 'room:join', {
      ...profile('Гость'),
      roomCode: created.roomCode,
    });

    expect(await call(guest, 'lobby:kick', { playerId: created.playerId })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });

    const closed = new Promise((resolve) => guest.once('room:closed', resolve));
    await ok(host, 'lobby:kick', { playerId: joined.playerId });
    expect(await closed).toEqual({ reason: 'kicked' });
    expect(await call(guest, 'player:update', { nickname: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_IN_ROOM' },
    });
  });

  it('ограничивает частоту событий', async () => {
    const socket = await client();
    const results = await Promise.all(
      Array.from({ length: 120 }, () => call(socket, 'time:sync', { clientTime: 1 })),
    );
    const limited = results.filter((r) => !r.ok && r.error.code === 'RATE_LIMITED');
    expect(limited.length).toBeGreaterThan(50);
    expect(results.some((r) => r.ok)).toBe(true);
  });

  it('синхронизация часов возвращает время сервера', async () => {
    const socket = await client();
    const before = Date.now();
    const res = await ok(socket, 'time:sync', { clientTime: 42 });
    expect(res.clientTime).toBe(42);
    expect(res.serverTime).toBeGreaterThanOrEqual(before);
  });

  it('игра: старт только хостом, загрузка дубля по HTTP с токеном сессии', async () => {
    const host = await client();
    const guest = await client();
    const created = await ok(host, 'room:create', profile('Хост'));
    const joined = await ok(guest, 'room:join', {
      ...profile('Гость'),
      roomCode: created.roomCode,
    });
    const takeUrl = `${url}/api/rooms/${created.roomCode}/take?round=0&offsetMs=12&effect=robot`;
    const upload = (token: string | null, body: Buffer = WEBM) =>
      fetch(takeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'audio/webm',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body,
      });

    expect(await call(guest, 'game:start', undefined)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    // До старта игры дубли не принимаются
    expect((await upload(created.sessionToken)).status).toBe(409);

    const recording = nextState(host, (s) => s.phase === 'recording');
    await ok(host, 'game:start', undefined);
    const state = await recording;
    expect(state.round!.clip.videoUrl).toBe('/api/media/packs/demo/c1/source-x.mp4');

    expect((await upload(null)).status).toBe(401);
    expect((await upload('wrong-token-wrong-token-wrong')).status).toBe(401);

    // Файл с неизвестной сигнатурой отклоняется, даже если Content-Type «правильный»
    const fake = await upload(
      created.sessionToken,
      Buffer.from('<script>alert(1)</script>'.repeat(20)),
    );
    expect(fake.status).toBe(415);
    expect(await fake.json()).toMatchObject({ error: { code: 'UNSUPPORTED_MEDIA' } });

    const status = new Promise((resolve) => host.once('take:status', resolve));
    const good = await upload(created.sessionToken);
    expect(good.status).toBe(200);
    expect(await good.json()).toEqual({ status: 'ready' });
    expect(await status).toMatchObject({ roundIndex: 0 });

    const playback = nextState(guest, (s) => s.phase === 'playback');
    expect((await upload(joined.sessionToken)).status).toBe(200);
    const shown = await playback;
    expect(shown.round!.entries).toHaveLength(2);

    // Клиент не может сам сменить фазу или проголосовать вне очереди
    expect(await call(guest, 'vote:cast', { category: 'funniest', targetId: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'BAD_PHASE' },
    });
    expect(await call(guest, 'playback:control', { action: 'finish' })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(await call(guest, 'phase:continue', undefined)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('медиа отдаётся с поддержкой Range, закрытые файлы недоступны', async () => {
    const full = await fetch(`${url}/api/media/packs/demo/c1/source-x.mp4`);
    expect(full.status).toBe(200);
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    expect(full.headers.get('content-type')).toBe('video/mp4');
    expect(await full.text()).toBe('0123456789');

    const part = await fetch(`${url}/api/media/packs/demo/c1/source-x.mp4`, {
      headers: { Range: 'bytes=2-5' },
    });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await part.text()).toBe('2345');

    const bad = await fetch(`${url}/api/media/packs/demo/c1/source-x.mp4`, {
      headers: { Range: 'bytes=50-' },
    });
    expect(bad.status).toBe(416);

    await app.ctx.storage.putBuffer('rooms/ABCD/r0/takes/p-1.webm', Buffer.from('secret'));
    expect((await fetch(`${url}/api/media/rooms/ABCD/r0/takes/p-1.webm`)).status).toBe(404);
    expect((await fetch(`${url}/api/media/..%2F..%2Fdata%2Fdubparty.sqlite`)).status).toBe(404);
  });

  it('пустая комната удаляется при очистке вместе с файлами', async () => {
    const host = await client();
    const created = await ok(host, 'room:create', profile('Хост'));
    await app.ctx.storage.putBuffer(`rooms/${created.roomCode}/r0/entries/x.mp4`, Buffer.from('x'));
    await ok(host, 'room:leave', undefined);
    await services.manager.sweep();
    expect(services.manager.get(created.roomCode)).toBeUndefined();
    expect(await app.ctx.storage.stat(`rooms/${created.roomCode}/r0/entries/x.mp4`)).toBeNull();
    expect(
      await call(await client(), 'room:join', { ...profile('x'), roomCode: created.roomCode }),
    ).toMatchObject({
      ok: false,
      error: { code: 'ROOM_NOT_FOUND' },
    });
  });

  it('завершённая комната удаляется по истечении срока хранения', async () => {
    const host = await client();
    const created = await ok(host, 'room:create', profile('Хост'));
    const room = services.manager.get(created.roomCode)!;
    room.endedAt = Date.now();
    await services.manager.sweep(Date.now() + 3_600_000);
    expect(services.manager.get(created.roomCode)).toBeDefined();

    const closed = new Promise((resolve) => host.once('room:closed', resolve));
    await services.manager.sweep(Date.now() + 7 * 3_600_000);
    expect(await closed).toEqual({ reason: 'expired' });
    expect(services.manager.get(created.roomCode)).toBeUndefined();
  });
});
