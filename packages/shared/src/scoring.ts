import { SCORING, VOTE_CATEGORIES, type VoteCategory } from './constants';

export interface ScoreTarget {
  id: string;
  authorIds: string[];
}

export interface CastVote {
  voterId: string;
  category: VoteCategory;
  targetId: string;
}

export type TallyCategory = VoteCategory | 'audience';

export interface ScoreDelta {
  votes: number;
  wins: number;
  voted: number;
  audience: number;
  total: number;
}

export interface RoundScore {
  /** Число голосов по каждой цели и категории. */
  tallies: Record<string, Record<TallyCategory, number>>;
  /** Лидеры категорий (несколько при ничьей; пусто, если голосов не было). */
  winners: Record<TallyCategory, string[]>;
  /** Начисления игрокам. */
  deltas: Record<string, ScoreDelta>;
}

/** Можно ли игроку голосовать за цель: нельзя за ту, где он сам автор. */
export function canVoteFor(target: ScoreTarget | undefined, voterId: string): boolean {
  return !!target && !target.authorIds.includes(voterId);
}

export function eligibleTargets<T extends ScoreTarget>(
  targets: readonly T[],
  voterId: string,
): T[] {
  return targets.filter((t) => !t.authorIds.includes(voterId));
}

function emptyDelta(): ScoreDelta {
  return { votes: 0, wins: 0, voted: 0, audience: 0, total: 0 };
}

function leaders(tallies: Record<string, Record<TallyCategory, number>>, category: TallyCategory) {
  let best = 0;
  let ids: string[] = [];
  for (const [id, t] of Object.entries(tallies)) {
    const n = t[category];
    if (n > best) {
      best = n;
      ids = [id];
    } else if (n === best && n > 0) {
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Подсчёт очков раунда. Чистая функция: некорректные голоса (за себя, за
 * несуществующую цель, повторные в одной категории) отбрасываются, а не ломают подсчёт —
 * сервер их и так не принимает, это вторая линия защиты.
 */
export function computeRoundScore(input: {
  targets: readonly ScoreTarget[];
  votes: readonly CastVote[];
  /** Голоса зрителей: цель → число голосов. */
  audience?: Readonly<Record<string, number>>;
  /** Игроки, участвующие в раунде (для нулевых строк в таблице). */
  playerIds: readonly string[];
}): RoundScore {
  const { targets, votes, audience = {}, playerIds } = input;
  const byId = new Map(targets.map((t) => [t.id, t]));

  const tallies: RoundScore['tallies'] = {};
  for (const t of targets) tallies[t.id] = { funniest: 0, acting: 0, audience: 0 };

  const deltas: Record<string, ScoreDelta> = {};
  for (const id of playerIds) deltas[id] = emptyDelta();
  const deltaOf = (id: string) => (deltas[id] ??= emptyDelta());

  const seen = new Set<string>();
  const votedCategories = new Map<string, Set<VoteCategory>>();
  for (const v of votes) {
    const key = `${v.voterId}:${v.category}`;
    if (seen.has(key)) continue;
    const target = byId.get(v.targetId);
    if (!target || !canVoteFor(target, v.voterId)) continue;
    seen.add(key);
    tallies[target.id]![v.category] += 1;
    for (const a of target.authorIds) deltaOf(a).votes += SCORING.perVote;
    let set = votedCategories.get(v.voterId);
    if (!set) votedCategories.set(v.voterId, (set = new Set()));
    set.add(v.category);
  }

  for (const [targetId, n] of Object.entries(audience)) {
    if (tallies[targetId] && n > 0) tallies[targetId].audience = Math.floor(n);
  }

  const winners = {
    funniest: leaders(tallies, 'funniest'),
    acting: leaders(tallies, 'acting'),
    audience: leaders(tallies, 'audience'),
  };

  for (const category of VOTE_CATEGORIES) {
    for (const id of winners[category]) {
      for (const a of byId.get(id)!.authorIds) deltaOf(a).wins += SCORING.categoryWin;
    }
  }
  for (const id of winners.audience) {
    for (const a of byId.get(id)!.authorIds) deltaOf(a).audience += SCORING.audienceWin;
  }

  for (const [voterId, set] of votedCategories) {
    if (set.size === VOTE_CATEGORIES.length) deltaOf(voterId).voted += SCORING.votedBonus;
  }

  for (const d of Object.values(deltas)) d.total = d.votes + d.wins + d.voted + d.audience;
  return { tallies, winners, deltas };
}

export interface Ranked {
  id: string;
  score: number;
  /** Место с 1; при равных очках место общее (1, 1, 3). */
  place: number;
}

export function rankPlayers(
  scores: Readonly<Record<string, number>>,
  order: readonly string[],
): Ranked[] {
  const rows = order
    .map((id, i) => ({ id, score: scores[id] ?? 0, i }))
    .sort((a, b) => b.score - a.score || a.i - b.i);
  let place = 0;
  let prev: number | null = null;
  return rows.map((r, idx) => {
    if (prev === null || r.score !== prev) place = idx + 1;
    prev = r.score;
    return { id: r.id, score: r.score, place };
  });
}
