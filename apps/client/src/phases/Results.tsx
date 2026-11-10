import { VOTE_CATEGORIES, type RoomState, type RoundState } from '@dubparty/shared';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { playSfx } from '../audio/sfx';
import { RoundDownloads } from '../components/Downloads';
import { authorNames } from '../components/PlayerChips';
import { Scoreboard } from '../components/Scoreboard';
import { Button, Card, Notice } from '../components/ui';
import { useErrorText, useRemainingMs } from '../lib/hooks';
import { request } from '../net/socket';
import { toast } from '../store/toasts';
import { CATEGORY_ICONS } from './Voting';

export function Results({ state, round }: { state: RoomState; round: RoundState }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const remaining = useRemainingMs(state.phaseEndsAt, 1000);
  const isHost = state.hostId === state.youId;
  const results = round.results;
  const isLast = state.roundIndex + 1 >= state.totalRounds;

  useEffect(() => {
    playSfx('success');
  }, []);

  const winners = VOTE_CATEGORIES.flatMap((category) => {
    const ids = results?.winners[category] ?? [];
    if (ids.length === 0) return [];
    const names = ids
      .map((id) => {
        const target = round.voteTargets.find((x) => x.id === id);
        return target ? authorNames(state.players, target.authorIds) : '?';
      })
      .join(' · ');
    return [{ category, names, votes: results!.tallies[ids[0]!]![category] }];
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Card className="animate-pop">
        <p className="text-sm font-bold tracking-wide text-accent uppercase">
          {t('game.roundOf', { n: round.index + 1, total: state.totalRounds })}
        </p>
        <h1 className="text-3xl font-black">{t('results.title')}</h1>

        {round.entries.length === 0 ? (
          <div className="mt-4">
            <Notice tone="warn">{t('results.noEntries')}</Notice>
          </div>
        ) : winners.length === 0 ? (
          <p className="mt-3 text-muted">{t('results.noVotes')}</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {winners.map((w) => (
              <li
                key={w.category}
                className="flex animate-rise items-center gap-3 rounded-2xl border border-border bg-surface-2 p-3"
              >
                <span aria-hidden="true" className="text-3xl">
                  {CATEGORY_ICONS[w.category]}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-muted">
                    {t(`voting.categories.${w.category}`)}
                  </p>
                  <p className="truncate text-lg font-black">{w.names}</p>
                </div>
                <span className="ml-auto text-sm font-bold whitespace-nowrap text-muted">
                  {t('results.votes', { count: w.votes })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card as="section" aria-labelledby="scores-title">
        <h2 id="scores-title" className="mb-3 text-xl font-black">
          {t('results.scoreboard')}
        </h2>
        <Scoreboard players={state.players} deltas={results?.deltas ?? null} youId={state.youId} />
      </Card>

      {round.entries.length > 0 && (
        <Card as="section" aria-labelledby="dl-title" className="!p-4">
          <h2 id="dl-title" className="mb-2 font-bold">
            {t('results.downloads')}
          </h2>
          <RoundDownloads
            state={state}
            round={{
              index: round.index,
              clipTitle: round.clip.title,
              mode: round.mode,
              entries: round.entries,
            }}
          />
          {!isHost && !round.entries.some((e) => e.authorIds.includes(state.youId)) && (
            <p className="text-sm text-muted">{t('results.nothingToDownload')}</p>
          )}
        </Card>
      )}

      <div className="flex flex-col items-center gap-2">
        {isHost ? (
          <Button
            variant="primary"
            size="lg"
            onClick={() =>
              void request('phase:continue').catch((err) => toast.error(errorText(err)))
            }
          >
            {isLast ? t('results.toFinal') : t('results.nextRound')}
          </Button>
        ) : (
          <p className="text-muted">{t('results.waitHost')}</p>
        )}
        {remaining !== null && (
          <p className="text-sm text-muted tabular-nums" role="timer">
            {t('results.autoContinue', { count: Math.ceil(remaining / 1000) })}
          </p>
        )}
      </div>
    </div>
  );
}
