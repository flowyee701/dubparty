import { describe, expect, it } from 'vitest';
import { SCORING } from './constants';
import { canVoteFor, computeRoundScore, eligibleTargets, rankPlayers } from './scoring';

const solo = (id: string) => ({ id: `e-${id}`, authorIds: [id] });

describe('computeRoundScore', () => {
  const targets = [solo('a'), solo('b'), solo('c')];
  const playerIds = ['a', 'b', 'c'];

  it('начисляет очки за голоса, победу в категории и участие в голосовании', () => {
    const score = computeRoundScore({
      targets,
      playerIds,
      votes: [
        { voterId: 'a', category: 'funniest', targetId: 'e-b' },
        { voterId: 'c', category: 'funniest', targetId: 'e-b' },
        { voterId: 'b', category: 'funniest', targetId: 'e-a' },
        { voterId: 'a', category: 'acting', targetId: 'e-c' },
        { voterId: 'b', category: 'acting', targetId: 'e-c' },
        { voterId: 'c', category: 'acting', targetId: 'e-a' },
      ],
    });

    expect(score.tallies['e-b']).toEqual({ funniest: 2, acting: 0, audience: 0 });
    expect(score.winners.funniest).toEqual(['e-b']);
    expect(score.winners.acting).toEqual(['e-c']);
    expect(score.winners.audience).toEqual([]);

    // b: 2 голоса + победа + бонус за голосование
    expect(score.deltas.b).toEqual({
      votes: 2 * SCORING.perVote,
      wins: SCORING.categoryWin,
      voted: SCORING.votedBonus,
      audience: 0,
      total: 2 * SCORING.perVote + SCORING.categoryWin + SCORING.votedBonus,
    });
    // a: по одному голосу в каждой категории, побед нет
    expect(score.deltas.a!.total).toBe(2 * SCORING.perVote + SCORING.votedBonus);
  });

  it('отбрасывает голос за себя', () => {
    const score = computeRoundScore({
      targets,
      playerIds,
      votes: [{ voterId: 'a', category: 'funniest', targetId: 'e-a' }],
    });
    expect(score.tallies['e-a']!.funniest).toBe(0);
    expect(score.deltas.a!.total).toBe(0);
    expect(score.winners.funniest).toEqual([]);
  });

  it('учитывает только первый голос игрока в категории и игнорирует несуществующие цели', () => {
    const score = computeRoundScore({
      targets,
      playerIds,
      votes: [
        { voterId: 'a', category: 'funniest', targetId: 'e-b' },
        { voterId: 'a', category: 'funniest', targetId: 'e-c' },
        { voterId: 'b', category: 'funniest', targetId: 'nope' },
      ],
    });
    expect(score.tallies['e-b']!.funniest).toBe(1);
    expect(score.tallies['e-c']!.funniest).toBe(0);
    expect(Object.keys(score.tallies)).toHaveLength(3);
  });

  it('при ничьей победителями считаются все лидеры', () => {
    const score = computeRoundScore({
      targets,
      playerIds,
      votes: [
        { voterId: 'a', category: 'funniest', targetId: 'e-b' },
        { voterId: 'b', category: 'funniest', targetId: 'e-a' },
      ],
    });
    expect(score.winners.funniest.sort()).toEqual(['e-a', 'e-b']);
    expect(score.deltas.a!.wins).toBe(SCORING.categoryWin);
    expect(score.deltas.b!.wins).toBe(SCORING.categoryWin);
    expect(score.deltas.c!.wins).toBe(0);
  });

  it('бонус за голосование даётся только за все категории', () => {
    const score = computeRoundScore({
      targets,
      playerIds,
      votes: [{ voterId: 'a', category: 'funniest', targetId: 'e-b' }],
    });
    expect(score.deltas.a!.voted).toBe(0);
  });

  it('в трупповой записи очки получают все авторы', () => {
    const score = computeRoundScore({
      targets: [
        { id: 't1', authorIds: ['a', 'b'] },
        { id: 't2', authorIds: ['c', 'd'] },
      ],
      playerIds: ['a', 'b', 'c', 'd'],
      votes: [
        { voterId: 'c', category: 'acting', targetId: 't1' },
        { voterId: 'd', category: 'acting', targetId: 't1' },
        { voterId: 'a', category: 'acting', targetId: 't1' }, // своя труппа — отброшен
      ],
    });
    expect(score.tallies.t1!.acting).toBe(2);
    expect(score.deltas.a!.votes).toBe(2 * SCORING.perVote);
    expect(score.deltas.b!.votes).toBe(2 * SCORING.perVote);
    expect(score.deltas.a!.wins).toBe(SCORING.categoryWin);
  });

  it('голоса зрителей — отдельная категория и не влияют на основные', () => {
    const score = computeRoundScore({
      targets,
      playerIds,
      votes: [{ voterId: 'a', category: 'funniest', targetId: 'e-b' }],
      audience: { 'e-c': 7, 'e-a': 2, ghost: 99 },
    });
    expect(score.winners.audience).toEqual(['e-c']);
    expect(score.winners.funniest).toEqual(['e-b']);
    expect(score.deltas.c!.audience).toBe(SCORING.audienceWin);
    expect(score.deltas.c!.votes).toBe(0);
    expect(score.tallies.ghost).toBeUndefined();
  });

  it('без голосов никто ничего не получает', () => {
    const score = computeRoundScore({ targets, playerIds, votes: [] });
    expect(Object.values(score.deltas).every((d) => d.total === 0)).toBe(true);
    expect(score.winners).toEqual({ funniest: [], acting: [], audience: [] });
  });
});

describe('право голоса', () => {
  it('нельзя голосовать за запись, где ты автор', () => {
    expect(canVoteFor({ id: 'x', authorIds: ['a', 'b'] }, 'a')).toBe(false);
    expect(canVoteFor({ id: 'x', authorIds: ['a', 'b'] }, 'c')).toBe(true);
    expect(canVoteFor(undefined, 'c')).toBe(false);
  });

  it('eligibleTargets исключает собственные записи', () => {
    const targets = [solo('a'), solo('b')];
    expect(eligibleTargets(targets, 'a').map((t) => t.id)).toEqual(['e-b']);
  });
});

describe('rankPlayers', () => {
  it('делит места при равных очках', () => {
    const ranked = rankPlayers({ a: 100, b: 300, c: 100, d: 0 }, ['a', 'b', 'c', 'd']);
    expect(ranked.map((r) => [r.id, r.place])).toEqual([
      ['b', 1],
      ['a', 2],
      ['c', 2],
      ['d', 4],
    ]);
  });
});
