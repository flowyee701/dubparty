import { describe, expect, it } from 'vitest';
import { assignTroupes, charactersOf, findTroupeOf, lineWindows } from './roles';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

describe('assignTroupes', () => {
  it('два игрока и два персонажа — одна труппа, по роли каждому', () => {
    const troupes = assignTroupes(ids(2), ['a', 'b']);
    expect(troupes).toHaveLength(1);
    expect(troupes[0]!.members).toEqual([
      { playerId: 'p1', characterIds: ['a'] },
      { playerId: 'p2', characterIds: ['b'] },
    ]);
  });

  it('игроков меньше, чем персонажей — кто-то получает несколько ролей', () => {
    const troupes = assignTroupes(ids(2), ['a', 'b', 'c']);
    expect(troupes).toHaveLength(1);
    expect(troupes[0]!.members[0]!.characterIds).toEqual(['a', 'c']);
    expect(troupes[0]!.members[1]!.characterIds).toEqual(['b']);
  });

  it('игроков больше, чем персонажей — несколько трупп', () => {
    const troupes = assignTroupes(ids(5), ['a', 'b']);
    expect(troupes).toHaveLength(3);
    expect(troupes.map((t) => t.members.length)).toEqual([2, 2, 1]);
    // Одиночка играет обе роли
    expect(troupes[2]!.members[0]!.characterIds).toEqual(['a', 'b']);
  });

  it.each([2, 3, 4, 5, 6, 7, 8])('при %i игроках каждый в одной труппе и с ролью', (n) => {
    for (const chars of [['a'], ['a', 'b'], ['a', 'b', 'c']]) {
      const players = ids(n);
      const troupes = assignTroupes(players, chars);
      const seen = troupes.flatMap((t) => t.members.map((m) => m.playerId));
      expect(seen.sort()).toEqual([...players].sort());
      for (const troupe of troupes) {
        expect(troupe.members.length).toBeLessThanOrEqual(chars.length);
        // Все персонажи сыграны ровно один раз в каждой труппе
        expect(troupe.members.flatMap((m) => m.characterIds).sort()).toEqual([...chars].sort());
        for (const m of troupe.members) expect(m.characterIds.length).toBeGreaterThan(0);
      }
    }
  });

  it('пустой список игроков', () => {
    expect(assignTroupes([], ['a'])).toEqual([]);
  });

  it('поиск труппы и ролей игрока', () => {
    const troupes = assignTroupes(ids(4), ['a', 'b']);
    expect(findTroupeOf(troupes, 'p4')?.id).toBe('t2');
    expect(charactersOf(troupes, 'p4')).toEqual(['b']);
    expect(charactersOf(troupes, 'nobody')).toEqual([]);
  });
});

describe('lineWindows', () => {
  const lines = [
    { characterId: 'a', startMs: 1000, endMs: 2000 },
    { characterId: 'b', startMs: 2100, endMs: 3000 },
    { characterId: 'a', startMs: 2300, endMs: 2600 },
    { characterId: 'a', startMs: 9800, endMs: 10000 },
  ];

  it('берёт только свои реплики, добавляет запас и склеивает пересечения', () => {
    expect(lineWindows(lines, ['a'], 10_000, 200)).toEqual([
      { startMs: 800, endMs: 2800 },
      { startMs: 9600, endMs: 10_000 },
    ]);
  });

  it('несколько ролей у одного игрока', () => {
    expect(lineWindows(lines, ['a', 'b'], 10_000, 0)).toEqual([
      { startMs: 1000, endMs: 2000 },
      { startMs: 2100, endMs: 3000 },
      { startMs: 9800, endMs: 10_000 },
    ]);
  });

  it('без реплик — пусто', () => {
    expect(lineWindows(lines, ['z'], 10_000)).toEqual([]);
  });
});
