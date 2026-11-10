import { rankPlayers, type PublicPlayer, type ScoreDelta } from '@dubparty/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePrefersReducedMotion } from '../lib/hooks';
import { AvatarBubble, cx } from './ui';

const ROW_REM = 3.75;

function useCountUp(from: number, to: number, run: boolean, durationMs = 900): number {
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState(from);
  useEffect(() => {
    if (!run) return;
    if (reduced || from === to) {
      setValue(to);
      return;
    }
    const started = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - started) / durationMs);
      setValue(Math.round(from + (to - from) * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [from, to, run, durationMs, reduced]);
  return run ? value : from;
}

function Row({
  player,
  place,
  index,
  score,
  delta,
  maxScore,
  revealed,
  isYou,
}: {
  player: PublicPlayer;
  place: number;
  index: number;
  score: number;
  delta: number;
  maxScore: number;
  revealed: boolean;
  isYou: boolean;
}) {
  const { t } = useTranslation();
  const shown = useCountUp(score - delta, score, revealed);
  return (
    <li
      className="absolute inset-x-0 transition-transform duration-700 ease-out"
      style={{ transform: `translateY(${index * ROW_REM}rem)`, height: `${ROW_REM - 0.5}rem` }}
    >
      <div
        className={cx(
          'relative flex h-full items-center gap-3 overflow-hidden rounded-2xl border px-3',
          isYou ? 'border-accent bg-accent-soft' : 'border-border bg-surface-2',
          player.left && 'opacity-50',
        )}
      >
        <div
          aria-hidden="true"
          className="absolute inset-y-0 left-0 bg-accent/15 transition-[width] duration-1000 ease-out"
          style={{ width: `${maxScore > 0 ? (shown / maxScore) * 100 : 0}%` }}
        />
        <span className="relative w-6 text-center text-lg font-black tabular-nums">{place}</span>
        <AvatarBubble avatar={player.avatar} color={player.color} size="sm" className="relative" />
        <span className="relative min-w-0 flex-1 truncate font-bold">{player.nickname}</span>
        {revealed && delta > 0 && (
          <span className="relative animate-pop rounded-full bg-success-soft px-2 py-0.5 text-sm font-black text-success tabular-nums">
            +{delta}
          </span>
        )}
        <span className="relative w-16 text-right text-lg font-black tabular-nums">
          {shown}
          <span className="sr-only"> {t('common.points', { count: shown })}</span>
        </span>
      </div>
    </li>
  );
}

/**
 * Таблица лидеров. Сначала показывает положение до раунда, затем очки «набегают»,
 * а строки переезжают на новые места.
 */
export function Scoreboard({
  players,
  deltas,
  youId,
}: {
  players: PublicPlayer[];
  deltas: Record<string, ScoreDelta> | null;
  youId: string;
}) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setRevealed(true), 700);
    return () => window.clearTimeout(id);
  }, []);

  const order = players.map((p) => p.id);
  const deltaOf = (id: string) => deltas?.[id]?.total ?? 0;
  const before = rankPlayers(
    Object.fromEntries(players.map((p) => [p.id, p.score - deltaOf(p.id)])),
    order,
  );
  const after = rankPlayers(Object.fromEntries(players.map((p) => [p.id, p.score])), order);
  const ranking = revealed ? after : before;
  const maxScore = Math.max(1, ...players.map((p) => p.score));

  return (
    <ol
      aria-label={t('results.scoreboard')}
      className="relative"
      style={{ height: `${players.length * ROW_REM}rem` }}
    >
      {players.map((player) => {
        const index = ranking.findIndex((r) => r.id === player.id);
        return (
          <Row
            key={player.id}
            player={player}
            index={index}
            place={ranking[index]!.place}
            score={player.score}
            delta={deltaOf(player.id)}
            maxScore={maxScore}
            revealed={revealed}
            isYou={player.id === youId}
          />
        );
      })}
    </ol>
  );
}
