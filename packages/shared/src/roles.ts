export interface TroupeMember {
  playerId: string;
  characterIds: string[];
}

export interface Troupe {
  id: string;
  members: TroupeMember[];
}

/**
 * Делит игроков на труппы и раздаёт персонажей.
 *
 * - Трупп столько, чтобы в каждой было не больше игроков, чем персонажей.
 * - Игроки распределяются по труппам максимально ровно.
 * - Внутри труппы персонажи раздаются по кругу: если игроков меньше, чем персонажей,
 *   кто-то получает несколько ролей; каждый игрок получает минимум одну.
 *
 * Порядок игроков задаёт вызывающая сторона (сервер перемешивает их заранее),
 * поэтому функция детерминирована.
 */
export function assignTroupes(
  playerIds: readonly string[],
  characterIds: readonly string[],
): Troupe[] {
  if (playerIds.length === 0) return [];
  const chars = characterIds.length > 0 ? characterIds : [];
  const perTroupe = Math.max(1, chars.length);
  const troupeCount = Math.ceil(playerIds.length / perTroupe);

  const troupes: Troupe[] = Array.from({ length: troupeCount }, (_, i) => ({
    id: `t${i + 1}`,
    members: [],
  }));

  playerIds.forEach((playerId, i) => {
    troupes[i % troupeCount]!.members.push({ playerId, characterIds: [] });
  });

  for (const troupe of troupes) {
    chars.forEach((characterId, i) => {
      troupe.members[i % troupe.members.length]!.characterIds.push(characterId);
    });
  }
  return troupes;
}

export function findTroupeOf(troupes: readonly Troupe[], playerId: string): Troupe | undefined {
  return troupes.find((t) => t.members.some((m) => m.playerId === playerId));
}

export function charactersOf(troupes: readonly Troupe[], playerId: string): string[] {
  for (const troupe of troupes) {
    const member = troupe.members.find((m) => m.playerId === playerId);
    if (member) return member.characterIds;
  }
  return [];
}

export interface TimeWindow {
  startMs: number;
  endMs: number;
}

/**
 * Окна времени, в которых звучит игрок: его реплики с запасом по краям,
 * пересекающиеся окна склеены. Сервер по ним вырезает голос при сведении труппы.
 */
export function lineWindows(
  lines: readonly { characterId: string; startMs: number; endMs: number }[],
  characterIds: readonly string[],
  durationMs: number,
  padMs = 250,
): TimeWindow[] {
  const mine = lines
    .filter((l) => characterIds.includes(l.characterId))
    .map((l) => ({
      startMs: Math.max(0, l.startMs - padMs),
      endMs: Math.min(durationMs, l.endMs + padMs),
    }))
    .filter((w) => w.endMs > w.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  const merged: TimeWindow[] = [];
  for (const w of mine) {
    const last = merged[merged.length - 1];
    if (last && w.startMs <= last.endMs) last.endMs = Math.max(last.endMs, w.endMs);
    else merged.push({ ...w });
  }
  return merged;
}
