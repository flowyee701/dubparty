import { SCORING } from '@dubparty/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestRoom, TEST_PACK, type TestRoom } from './testkit';

const TIMINGS = {
  introMs: 1000,
  recordGraceMs: 500,
  recordMinExtraMs: 1000,
  playbackPrerollMs: 1000,
  playbackGapMs: 200,
  votingMs: 20_000,
  resultsMs: 5000,
};

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

/** Даёт отработать цепочкам промисов без продвижения таймеров. */
const flush = () => vi.advanceTimersByTimeAsync(0);

function setup(players: number, options: Parameters<typeof createTestRoom>[0] = {}) {
  const t = createTestRoom({ timings: TIMINGS, ...options });
  const list = Array.from({ length: players }, (_, i) => t.add(`p${i + 1}`));
  return { t, players: list, host: list[0]! };
}

async function toRecording(t: TestRoom, hostId: string) {
  t.game.start(t.room, hostId);
  expect(t.room.phase).toBe('intro');
  await vi.advanceTimersByTimeAsync(TIMINGS.introMs);
  expect(t.room.phase).toBe('recording');
}

/** Дожидается конца таймера записи вместе с окном дозагрузки. */
async function pastRecordingDeadline(t: TestRoom) {
  const state = t.room.snapshotFor(t.room.hostId);
  await vi.advanceTimersByTimeAsync(state.phaseEndsAt! - state.serverTime + TIMINGS.recordGraceMs);
  await flush();
}

async function toVoting(t: TestRoom, hostId: string, ids: string[]) {
  await toRecording(t, hostId);
  for (const id of ids) await t.submit(id);
  await flush();
  expect(t.room.phase).toBe('playback');
  t.session().playbackControl(hostId, { action: 'finish' });
  expect(t.room.phase).toBe('voting');
}

describe('запуск игры', () => {
  it('нужны хост, минимум два подключённых игрока и непустой пак', () => {
    const { t, host } = setup(1);
    expect(() => t.game.start(t.room, host.id)).toThrowError(/At least 2/);
    const guest = t.add('guest');
    expect(() => t.game.start(t.room, guest.id)).toThrowError(/Only the host/);

    const empty = createTestRoom({ pack: { ...TEST_PACK, clips: [] } });
    const h = empty.add('h');
    empty.add('g');
    expect(() => empty.game.start(empty.room, h.id)).toThrowError(/no clips/);
  });

  it('во время игры войти нельзя', async () => {
    const { t, host } = setup(2);
    await toRecording(t, host.id);
    expect(() => t.add('late')).toThrowError(/GAME_IN_PROGRESS/);
  });

  it('отключившиеся в лобби в игру не попадают', () => {
    const { t, players, host } = setup(3);
    t.room.detach(players[2]!.id, players[2]!.socketId!);
    t.game.start(t.room, host.id);
    expect(t.room.players).toHaveLength(2);
  });
});

describe('раунд Parallel: полный цикл', () => {
  it('запись → обработка → просмотр → голосование → итоги → финал', async () => {
    const { t, players } = setup(3);
    const [a, b, c] = players.map((p) => p.id) as [string, string, string];
    t.room.updateSettings(a, { rounds: 1 });
    await toRecording(t, a);

    // До просмотра чужих записей не видно
    expect(t.room.snapshotFor(b).round).toMatchObject({
      entries: [],
      voteTargets: [],
      results: null,
    });

    expect(await t.submit(a, 120)).toEqual({ status: 'ready', errorCode: undefined });
    await t.submit(b, -40);
    expect(t.room.phase).toBe('recording');
    expect(t.room.snapshotFor(c).round!.submittedIds.sort()).toEqual([a, b].sort());
    expect(t.room.snapshotFor(c).round!.yourTake.status).toBe('none');

    await t.submit(c);
    await flush();
    // Все сдали — раунд не ждёт таймера
    expect(t.room.phase).toBe('playback');
    expect(t.calls.processTake).toHaveLength(3);
    expect(t.calls.processTake[0]).toMatchObject({
      offsetMs: 120,
      effect: 'none',
      windows: undefined,
    });
    expect(t.calls.buildReview).toBe(3);

    const round = t.room.snapshotFor(a).round!;
    expect(round.entries).toHaveLength(3);
    expect(round.entries.every((e) => e.authorIds.length === 1)).toBe(true);
    expect(round.entries[0]!.url).toMatch(/^\/api\/media\/rooms\/ABCD\/r0\/entries\/.+\.mp4$/);
    expect(round.playback).toMatchObject({ entryIndex: 0, playing: true, positionMs: 0 });

    t.session().playbackControl(a, { action: 'finish' });
    expect(t.room.phase).toBe('voting');
    const targets = t.room.snapshotFor(a).round!.voteTargets;
    const targetOf = (id: string) => targets.find((x) => x.authorIds[0] === id)!.id;

    // За себя нельзя
    expect(() => t.session().castVote(a, 'funniest', targetOf(a))).toThrowError(/yourself/);
    expect(() => t.session().castVote(a, 'funniest', 'nope')).toThrowError(/Unknown vote target/);

    t.session().castVote(a, 'funniest', targetOf(b));
    t.session().castVote(a, 'acting', targetOf(b));
    t.session().castVote(b, 'funniest', targetOf(c));
    t.session().castVote(b, 'funniest', targetOf(a)); // передумал
    t.session().castVote(b, 'acting', targetOf(c));
    // Чужие голоса до итогов не раскрываются
    expect(t.room.snapshotFor(c).round!.yourVotes).toEqual({});
    expect(t.room.snapshotFor(c).round!.votedIds.sort()).toEqual([a, b].sort());
    expect(t.room.snapshotFor(c).round!.results).toBeNull();

    t.session().castVote(c, 'funniest', targetOf(b));
    t.session().castVote(c, 'acting', targetOf(b));
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.room.phase).toBe('results');

    const results = t.room.snapshotFor(a).round!.results!;
    expect(results.tallies[targetOf(b)]).toEqual({ funniest: 2, acting: 2 });
    expect(results.winners.funniest).toEqual([targetOf(b)]);
    const score = (id: string) => t.room.getPlayer(id)!.score;
    expect(score(b)).toBe(4 * SCORING.perVote + 2 * SCORING.categoryWin + SCORING.votedBonus);
    expect(score(a)).toBe(SCORING.perVote + SCORING.votedBonus);
    expect(score(c)).toBe(SCORING.perVote + SCORING.votedBonus);

    // Продолжить может только хост
    expect(() => t.session().continuePhase(b)).toThrowError(/Only the host/);
    t.session().continuePhase(a);
    expect(t.room.phase).toBe('final');
    expect(t.room.endedAt).not.toBeNull();
    expect(t.events.ended).toBe(1);
    expect(t.room.snapshotFor(a).history).toHaveLength(1);
  });

  it('несколько раундов: клипы не повторяются, очки копятся', async () => {
    const { t, players, host } = setup(2);
    const ids = players.map((p) => p.id);
    t.room.updateSettings(host.id, { rounds: 2 });
    await toVoting(t, host.id, ids);
    const first = t.room.snapshotFor(host.id).round!.clip.id;
    await vi.advanceTimersByTimeAsync(TIMINGS.votingMs);
    expect(t.room.phase).toBe('results');
    await vi.advanceTimersByTimeAsync(TIMINGS.resultsMs);
    expect(t.room.phase).toBe('intro');
    expect(t.room.snapshotFor(host.id)).toMatchObject({ roundIndex: 1, totalRounds: 2 });
    expect(t.room.snapshotFor(host.id).round!.clip.id).not.toBe(first);
  });

  it('возврат в лобби обнуляет очки и убирает ушедших', async () => {
    const { t, players, host } = setup(3);
    const ids = players.map((p) => p.id);
    t.room.updateSettings(host.id, { rounds: 1 });
    await toVoting(t, host.id, ids);
    t.room.leave(ids[2]!);
    await vi.advanceTimersByTimeAsync(TIMINGS.votingMs + TIMINGS.resultsMs);
    expect(t.room.phase).toBe('final');
    expect(() => t.game.restart(t.room, ids[1]!)).toThrowError(/Only the host/);
    t.game.restart(t.room, host.id);
    expect(t.room.phase).toBe('lobby');
    expect(t.room.players).toHaveLength(2);
    expect(t.room.players.every((p) => p.score === 0)).toBe(true);
  });
});

describe('запись', () => {
  it('по таймеру раунд идёт дальше с теми дублями, что есть', async () => {
    const { t, players, host } = setup(3);
    await toRecording(t, host.id);
    await t.submit(players[1]!.id);
    const state = t.room.snapshotFor(host.id);
    const wait = state.phaseEndsAt! - state.serverTime;
    await vi.advanceTimersByTimeAsync(wait);
    expect(t.room.phase).toBe('recording'); // ещё идёт окно дозагрузки
    await vi.advanceTimersByTimeAsync(TIMINGS.recordGraceMs);
    await flush();
    expect(t.room.phase).toBe('playback');
    expect(t.room.snapshotFor(host.id).round!.entries).toHaveLength(1);
  });

  it('если никто ничего не записал — сразу итоги без очков', async () => {
    const { t, host } = setup(2);
    await toRecording(t, host.id);
    await pastRecordingDeadline(t);
    expect(t.room.phase).toBe('results');
    expect(t.room.snapshotFor(host.id).round).toMatchObject({ entries: [], voteTargets: [] });
    expect(t.room.players.every((p) => p.score === 0)).toBe(true);
  });

  it('время на запись не меньше длины клипа с запасом', async () => {
    const pack = { ...TEST_PACK, clips: [{ ...TEST_PACK.clips[0]!, durationMs: 58_000 }] };
    const { t, host } = setup(2, { pack });
    t.room.updateSettings(host.id, { recordSeconds: 30 });
    await toRecording(t, host.id);
    const state = t.room.snapshotFor(host.id);
    expect(state.phaseEndsAt! - state.serverTime).toBe(58_000 + TIMINGS.recordMinExtraMs);
  });

  it('перезапись заменяет дубль; неудачная обработка не считается сдачей', async () => {
    const failTakeFor = new Set<string>();
    const { t, players, host } = setup(2, { failTakeFor });
    const [a, b] = players.map((p) => p.id) as [string, string];
    await toRecording(t, host.id);

    failTakeFor.add(a);
    expect(await t.submit(a)).toEqual({ status: 'failed', errorCode: 'PROCESSING_FAILED' });
    await t.submit(b);
    await flush();
    expect(t.room.phase).toBe('recording'); // a ещё не сдал
    expect(t.room.snapshotFor(a).round!.yourTake).toEqual({
      status: 'failed',
      errorCode: 'PROCESSING_FAILED',
    });

    failTakeFor.delete(a);
    await t.submit(a, 55);
    await flush();
    expect(t.room.phase).toBe('playback');
    expect(t.calls.processTake.filter((c) => c.rawKey.includes(`/${a}-`))).toHaveLength(2);
  });

  it('дубль не принимается вне фазы записи и для чужого раунда', async () => {
    const { t, players, host } = setup(2);
    t.game.start(t.room, host.id);
    expect(() => t.session().prepareTake(host.id, 0, 'webm')).toThrowError(/Recording is over/);
    await vi.advanceTimersByTimeAsync(TIMINGS.introMs);
    expect(() => t.session().prepareTake(host.id, 1, 'webm')).toThrowError(/Recording is over/);
    expect(() => t.session().prepareTake('stranger', 0, 'webm')).toThrowError(/NOT_IN_ROOM/);
    expect(t.session().prepareTake(players[1]!.id, 0, 'mp4').rawKey).toMatch(
      /^rooms\/ABCD\/r0\/takes\/.+-1\.mp4$/,
    );
  });

  it('выключенные эффекты игнорируются сервером', async () => {
    const { t, host } = setup(2);
    t.room.updateSettings(host.id, { effectsEnabled: false });
    await toRecording(t, host.id);
    const s = t.session();
    const { rawKey, seq } = s.prepareTake(host.id, 0, 'webm');
    await s.submitTake(host.id, { rawKey, seq, size: 10, offsetMs: 0, effect: 'robot' });
    expect(t.calls.processTake[0]!.effect).toBe('none');
  });

  it('сбой сборки видео убирает запись, но не ломает раунд', async () => {
    const { t, players, host } = setup(2, { failReview: true });
    await toRecording(t, host.id);
    for (const p of players) await t.submit(p.id);
    await flush();
    expect(t.room.phase).toBe('results');
    expect(t.room.snapshotFor(host.id).round!.entries).toEqual([]);
  });
});

describe('просмотр', () => {
  async function toPlayback(count = 2) {
    const s = setup(count);
    await toRecording(s.t, s.host.id);
    for (const p of s.players) await s.t.submit(p.id);
    await flush();
    expect(s.t.room.phase).toBe('playback');
    return s;
  }
  const playback = (t: TestRoom) => t.room.snapshotFor(t.room.hostId).round!.playback!;

  it('старт привязан к моменту в будущем (преролл), записи идут друг за другом сами', async () => {
    const { t } = await toPlayback(2);
    const first = playback(t);
    expect(first.serverTime - Date.now()).toBe(TIMINGS.playbackPrerollMs);
    const duration = t.room.snapshotFor(t.room.hostId).round!.entries[0]!.durationMs;

    await vi.advanceTimersByTimeAsync(TIMINGS.playbackPrerollMs + duration + TIMINGS.playbackGapMs);
    expect(playback(t)).toMatchObject({ entryIndex: 1, playing: true, positionMs: 0 });
    expect(playback(t).rev).toBeGreaterThan(first.rev);

    await vi.advanceTimersByTimeAsync(TIMINGS.playbackPrerollMs + duration + TIMINGS.playbackGapMs);
    expect(t.room.phase).toBe('voting');
  });

  it('пауза, перемотка и продолжение — только от хоста, позиция считается сервером', async () => {
    const { t, players, host } = await toPlayback(2);
    const guest = players[1]!.id;
    expect(() => t.session().playbackControl(guest, { action: 'pause' })).toThrowError(
      /Only the host/,
    );

    await vi.advanceTimersByTimeAsync(TIMINGS.playbackPrerollMs + 2500);
    t.session().playbackControl(host.id, { action: 'pause' });
    expect(playback(t)).toMatchObject({ playing: false, positionMs: 2500 });

    // На паузе ничего не продвигается
    await vi.advanceTimersByTimeAsync(60_000);
    expect(playback(t)).toMatchObject({ entryIndex: 0, playing: false, positionMs: 2500 });

    t.session().playbackControl(host.id, { action: 'seek', positionMs: 7000 });
    expect(playback(t)).toMatchObject({ playing: false, positionMs: 7000 });

    t.session().playbackControl(host.id, { action: 'play' });
    expect(playback(t)).toMatchObject({ playing: true, positionMs: 7000, serverTime: Date.now() });

    // События рассылаются всем при каждом изменении
    expect(t.events.playback.at(-1)).toEqual(playback(t));

    const duration = t.room.snapshotFor(host.id).round!.entries[0]!.durationMs;
    await vi.advanceTimersByTimeAsync(duration - 7000 + TIMINGS.playbackGapMs);
    expect(playback(t).entryIndex).toBe(1);
  });

  it('следующая / предыдущая запись', async () => {
    const { t, host } = await toPlayback(3);
    t.session().playbackControl(host.id, { action: 'next' });
    expect(playback(t).entryIndex).toBe(1);
    t.session().playbackControl(host.id, { action: 'prev' });
    expect(playback(t).entryIndex).toBe(0);
    t.session().playbackControl(host.id, { action: 'prev' });
    expect(playback(t).entryIndex).toBe(0);
    t.session().playbackControl(host.id, { action: 'next' });
    t.session().playbackControl(host.id, { action: 'next' });
    t.session().playbackControl(host.id, { action: 'next' });
    expect(t.room.phase).toBe('voting');
    expect(() => t.session().playbackControl(host.id, { action: 'pause' })).toThrowError(
      /Not allowed/,
    );
  });
});

describe('голосование', () => {
  it('по таймеру подводятся итоги с теми голосами, что есть', async () => {
    const { t, players, host } = setup(3);
    const ids = players.map((p) => p.id);
    await toVoting(t, host.id, ids);
    const target = t.room
      .snapshotFor(ids[0]!)
      .round!.voteTargets.find((x) => x.authorIds[0] === ids[1])!;
    t.session().castVote(ids[0]!, 'funniest', target.id);
    await vi.advanceTimersByTimeAsync(TIMINGS.votingMs);
    expect(t.room.phase).toBe('results');
    expect(t.room.getPlayer(ids[1]!)!.score).toBe(SCORING.perVote + SCORING.categoryWin);
    // Проголосовал только в одной категории — бонуса нет
    expect(t.room.getPlayer(ids[0]!)!.score).toBe(0);
  });

  it('вне фазы голосования голос не принимается', async () => {
    const { t, host } = setup(2);
    await toRecording(t, host.id);
    expect(() => t.session().castVote(host.id, 'funniest', 'x')).toThrowError(/Not allowed/);
  });

  it('при одной записи её автора не ждут: голосовать ему не за кого', async () => {
    const { t, players, host } = setup(2);
    const [a, b] = players.map((p) => p.id) as [string, string];
    await toRecording(t, host.id);
    await t.submit(a);
    await pastRecordingDeadline(t);
    t.session().playbackControl(a, { action: 'finish' });
    expect(t.room.phase).toBe('voting');
    const [only] = t.room.snapshotFor(b).round!.voteTargets;
    t.session().castVote(b, 'funniest', only!.id);
    t.session().castVote(b, 'acting', only!.id);
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.room.phase).toBe('results');
  });
});

describe('режим Roles', () => {
  it('четыре игрока и два персонажа — две труппы, по одной общей записи на труппу', async () => {
    const { t, players, host } = setup(4);
    const ids = players.map((p) => p.id);
    t.room.updateSettings(host.id, { mode: 'roles', rounds: 1 });
    await toRecording(t, host.id);

    const round = t.room.snapshotFor(host.id).round!;
    expect(round.clip.id).toBe('duo'); // клип с несколькими персонажами выбирается первым
    expect(round.troupes).toHaveLength(2);
    expect(round.troupes!.flatMap((tr) => tr.members.map((m) => m.playerId)).sort()).toEqual(
      [...ids].sort(),
    );

    for (const id of ids) await t.submit(id);
    await flush();
    expect(t.room.phase).toBe('playback');

    // Голос каждого игрока вырезается по окнам его реплик
    const first = round.troupes![0]!.members[0]!;
    const call = t.calls.processTake.find((c) => c.rawKey.includes(`/${first.playerId}-`))!;
    const line = TEST_PACK.clips[0]!.lines.find((l) => l.characterId === first.characterIds[0])!;
    expect(call.windows).toEqual([{ startMs: line.startMs - 250, endMs: line.endMs + 250 }]);

    const entries = t.room.snapshotFor(host.id).round!.entries;
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.authorIds.length === 2)).toBe(true);
    expect(t.calls.buildReview).toBe(2);

    t.session().playbackControl(host.id, { action: 'finish' });
    const targets = t.room.snapshotFor(host.id).round!.voteTargets;
    const own = targets.find((x) => x.authorIds.includes(host.id))!;
    const other = targets.find((x) => !x.authorIds.includes(host.id))!;
    expect(() => t.session().castVote(host.id, 'acting', own.id)).toThrowError(/yourself/);
    t.session().castVote(host.id, 'acting', other.id);
    await vi.advanceTimersByTimeAsync(TIMINGS.votingMs);
    // Очки за голос получают оба участника труппы
    for (const id of other.authorIds) {
      expect(t.room.getPlayer(id)!.score).toBe(SCORING.perVote + SCORING.categoryWin);
    }
  });

  it('единственная труппа: одна запись, а голосуют за участников', async () => {
    const { t, players, host } = setup(2);
    const [a, b] = players.map((p) => p.id) as [string, string];
    t.room.updateSettings(host.id, { mode: 'roles', rounds: 1 });
    await toVoting(t, host.id, [a, b]);
    const round = t.room.snapshotFor(a).round!;
    expect(round.entries).toHaveLength(1);
    expect(round.voteTargets).toHaveLength(2);
    expect(round.voteTargets.every((x) => x.entryId === round.entries[0]!.id)).toBe(true);

    const targetB = round.voteTargets.find((x) => x.authorIds[0] === b)!;
    t.session().castVote(a, 'acting', targetB.id);
    await vi.advanceTimersByTimeAsync(TIMINGS.votingMs);
    expect(t.room.getPlayer(b)!.score).toBe(SCORING.perVote + SCORING.categoryWin);
    expect(t.room.getPlayer(a)!.score).toBe(0);
  });

  it('труппа, где записался только один, всё равно попадает в просмотр', async () => {
    const { t, players, host } = setup(2);
    t.room.updateSettings(host.id, { mode: 'roles' });
    await toRecording(t, host.id);
    await t.submit(players[0]!.id);
    await pastRecordingDeadline(t);
    const entries = t.room.snapshotFor(host.id).round!.entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.authorIds).toEqual([players[0]!.id]);
  });
});

describe('режим Free', () => {
  it('клиентам не отдаются реплики-подсказки', async () => {
    const { t, host } = setup(2);
    t.room.updateSettings(host.id, { mode: 'free' });
    await toRecording(t, host.id);
    const round = t.room.snapshotFor(host.id).round!;
    expect(round.mode).toBe('free');
    expect(round.clip.lines).toEqual([]);
    expect(round.troupes).toBeNull();
  });
});

describe('игроки уходят во время игры', () => {
  it('ушедший помечается, его голоса не считаются, игра продолжается', async () => {
    const { t, players, host } = setup(3);
    const [a, b, c] = players.map((p) => p.id) as [string, string, string];
    await toVoting(t, host.id, [a, b, c]);
    const targets = t.room.snapshotFor(a).round!.voteTargets;
    const targetOf = (id: string) => targets.find((x) => x.authorIds[0] === id)!.id;
    t.session().castVote(c, 'funniest', targetOf(a));
    t.room.kick(a, c);
    expect(t.room.getPlayer(c)).toMatchObject({ left: true, connected: false });
    expect(() => t.room.authenticate(c.toString())).toThrow();
    await vi.advanceTimersByTimeAsync(TIMINGS.votingMs);
    expect(t.room.phase).toBe('results');
    expect(t.room.getPlayer(a)!.score).toBe(0);
  });

  it('если остался один игрок — игра завершается', async () => {
    const { t, players, host } = setup(2);
    await toRecording(t, host.id);
    t.room.leave(players[1]!.id);
    expect(t.room.phase).toBe('final');
    expect(t.events.ended).toBe(1);
  });

  it('отключившегося перестают ждать не сразу, а через паузу', async () => {
    const { t, players, host } = setup(3);
    const [a, b, c] = players.map((p) => p.id) as [string, string, string];
    await toRecording(t, host.id);
    await t.submit(a);
    await t.submit(b);
    t.room.detach(c, players[2]!.socketId!);
    await flush();
    expect(t.room.phase).toBe('recording'); // возможно, просто обновил страницу
    await vi.advanceTimersByTimeAsync(10_000);
    await flush();
    expect(t.room.phase).toBe('playback');
  });

  it('хост ушёл во время игры — управление переходит следующему', async () => {
    const { t, players, host } = setup(3);
    await toRecording(t, host.id);
    t.room.leave(host.id);
    expect(t.room.hostId).toBe(players[1]!.id);
    expect(t.room.phase).toBe('recording');
  });
});
