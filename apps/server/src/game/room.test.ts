import { MAX_PLAYERS } from '@dubparty/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestRoom } from './testkit';

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

describe('лобби', () => {
  it('первый игрок становится хостом, ники делаются уникальными', () => {
    const t = createTestRoom();
    const a = t.add('Аня');
    const b = t.add('аня');
    const c = t.add('Аня');
    expect(t.room.hostId).toBe(a.id);
    expect([a.nickname, b.nickname, c.nickname]).toEqual(['Аня', 'аня 2', 'Аня 3']);
  });

  it(`не пускает больше ${MAX_PLAYERS} игроков`, () => {
    const t = createTestRoom();
    for (let i = 0; i < MAX_PLAYERS; i++) t.add(`p${i}`);
    expect(() => t.add('extra')).toThrowError(/ROOM_FULL/);
  });

  it('настройки меняет только хост, неизвестный пак отклоняется', () => {
    const t = createTestRoom();
    const host = t.add('host');
    const guest = t.add('guest');
    expect(() => t.room.updateSettings(guest.id, { rounds: 5 })).toThrowError(/Only the host/);
    t.room.updateSettings(host.id, { rounds: 5, mode: 'roles' });
    expect(t.room.settings).toMatchObject({ rounds: 5, mode: 'roles' });
    expect(() => t.room.updateSettings(host.id, { packId: 'nope' })).toThrowError(/Pack not found/);
  });

  it('хост может исключить игрока и передать права', () => {
    const t = createTestRoom();
    const host = t.add('host');
    const guest = t.add('guest');
    const third = t.add('third');

    expect(() => t.room.kick(guest.id, third.id)).toThrowError(/Only the host/);
    expect(() => t.room.kick(host.id, host.id)).toThrowError(/yourself/);

    t.room.kick(host.id, third.id);
    expect(t.room.players.map((p) => p.id)).toEqual([host.id, guest.id]);
    expect(t.events.removed.at(-1)).toMatchObject({ reason: 'kicked' });
    // Токен исключённого больше не действует
    expect(() => t.room.authenticate(third.token)).toThrowError(/SESSION_EXPIRED/);

    t.room.transferHost(host.id, guest.id);
    expect(t.room.hostId).toBe(guest.id);
    expect(() => t.room.transferHost(host.id, guest.id)).toThrowError(/Only the host/);
  });

  it('профиль можно менять только в лобби', () => {
    const t = createTestRoom();
    const a = t.add('a');
    t.add('b');
    t.room.updateProfile(a.id, { nickname: 'b', avatar: 'cat' });
    expect(a).toMatchObject({ nickname: 'b 2', avatar: 'cat' });
    t.game.start(t.room, a.id);
    expect(() => t.room.updateProfile(a.id, { nickname: 'x' })).toThrowError(/Not allowed/);
  });
});

describe('переподключение', () => {
  it('возвращает игрока по токену и вытесняет старое соединение', () => {
    const t = createTestRoom();
    const a = t.add('a');
    const oldSocket = a.socketId;
    const again = t.room.authenticate(a.token);
    expect(again.id).toBe(a.id);
    t.room.attach(a.id, 'new-socket');
    expect(t.events.removed.at(-1)).toEqual({ socketId: oldSocket, reason: 'replaced' });
    // Запоздалое отключение старого сокета не трогает новое соединение
    t.room.detach(a.id, oldSocket!);
    expect(a.connected).toBe(true);
  });

  it('неверный токен отклоняется', () => {
    const t = createTestRoom();
    t.add('a');
    expect(() => t.room.authenticate('x'.repeat(43))).toThrowError(/SESSION_EXPIRED/);
  });

  it('в лобби место отключившегося держится ограниченное время', () => {
    const t = createTestRoom({ timings: { lobbyDisconnectMs: 5000 } });
    t.add('a');
    const b = t.add('b');
    t.room.detach(b.id, b.socketId!);
    expect(t.room.players).toHaveLength(2);
    expect(b.connected).toBe(false);

    vi.advanceTimersByTime(4000);
    t.room.attach(b.id, 'back');
    vi.advanceTimersByTime(10_000);
    expect(t.room.players).toHaveLength(2); // успел вернуться

    t.room.detach(b.id, 'back');
    vi.advanceTimersByTime(5001);
    expect(t.room.players.map((p) => p.nickname)).toEqual(['a']);
  });

  it('права хоста переходят, только если он не вернулся вовремя', () => {
    const t = createTestRoom({ timings: { hostGraceMs: 3000, lobbyDisconnectMs: 60_000 } });
    const host = t.add('host');
    const guest = t.add('guest');

    t.room.detach(host.id, host.socketId!);
    vi.advanceTimersByTime(2000);
    expect(t.room.hostId).toBe(host.id);
    t.room.attach(host.id, 'h2');
    vi.advanceTimersByTime(5000);
    expect(t.room.hostId).toBe(host.id);

    t.room.detach(host.id, 'h2');
    vi.advanceTimersByTime(3001);
    expect(t.room.hostId).toBe(guest.id);
  });

  it('когда хост выходит сам, права переходят сразу', () => {
    const t = createTestRoom();
    const host = t.add('host');
    const guest = t.add('guest');
    t.room.leave(host.id);
    expect(t.room.hostId).toBe(guest.id);
    expect(t.room.players).toHaveLength(1);
  });

  it('во время игры отключившийся остаётся в комнате и может вернуться', () => {
    const t = createTestRoom();
    const a = t.add('a');
    const b = t.add('b');
    t.game.start(t.room, a.id);
    t.room.detach(b.id, b.socketId!);
    vi.advanceTimersByTime(10 * 60_000);
    expect(t.room.getPlayer(b.id)).toMatchObject({ connected: false, left: false });
    t.room.attach(t.room.authenticate(b.token).id, 'b2');
    expect(b.connected).toBe(true);
  });
});

describe('снапшот', () => {
  it('содержит игроков, хоста и адресован конкретному игроку', () => {
    const t = createTestRoom();
    const a = t.add('a');
    const b = t.add('b');
    const state = t.room.snapshotFor(b.id);
    expect(state).toMatchObject({
      code: 'ABCD',
      youId: b.id,
      hostId: a.id,
      phase: 'lobby',
      round: null,
    });
    expect(state.players.map((p) => p.nickname)).toEqual(['a', 'b']);
    // Токены наружу не попадают
    expect(JSON.stringify(state)).not.toContain(a.token);
    expect(JSON.stringify(state)).not.toContain('tokenHash');
  });
});
