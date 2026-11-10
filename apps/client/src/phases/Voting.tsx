import {
  VOTE_CATEGORIES,
  type RoomState,
  type RoundState,
  type VoteCategory,
  type VoteTarget,
} from '@dubparty/shared';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { playSfx } from '../audio/sfx';
import { Authors, authorNames, PlayerChips } from '../components/PlayerChips';
import { Badge, Button, Card, cx, Modal, Notice } from '../components/ui';
import { formatClock, useErrorText, useRemainingMs } from '../lib/hooks';
import { request } from '../net/socket';
import { toast } from '../store/toasts';

export const CATEGORY_ICONS: Record<VoteCategory | 'audience', string> = {
  funniest: '😂',
  acting: '🎭',
  audience: '📺',
};

function CategoryVote({
  category,
  state,
  round,
  onRewatch,
}: {
  category: VoteCategory;
  state: RoomState;
  round: RoundState;
  onRewatch(target: VoteTarget): void;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const legendId = useId();
  const chosen = round.yourVotes[category];

  const vote = (targetId: string) => {
    if (targetId === chosen) return;
    playSfx('vote');
    void request('vote:cast', { category, targetId }).catch((err) => toast.error(errorText(err)));
  };

  return (
    <Card as="section" aria-labelledby={legendId} className="flex flex-col gap-3">
      <h2 id={legendId} className="text-xl font-black">
        <span aria-hidden="true">{CATEGORY_ICONS[category]}</span>{' '}
        {t(`voting.categories.${category}`)}
      </h2>
      <div role="radiogroup" aria-labelledby={legendId} className="flex flex-col gap-2">
        {round.voteTargets.map((target, i) => {
          const own = target.authorIds.includes(state.youId);
          const selected = chosen === target.id;
          return (
            <div key={target.id} className="flex items-stretch gap-2">
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={own}
                onClick={() => vote(target.id)}
                className={cx(
                  'flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-2xl border px-3 text-left transition-colors',
                  selected
                    ? 'border-accent bg-accent-soft ring-2 ring-accent'
                    : 'border-border bg-surface-2 hover:border-accent/60',
                  own && 'cursor-not-allowed opacity-50 hover:border-border',
                )}
              >
                <span
                  aria-hidden="true"
                  className="grid size-7 shrink-0 place-items-center rounded-full bg-surface text-sm font-black tabular-nums"
                >
                  {i + 1}
                </span>
                <Authors players={state.players} authorIds={target.authorIds} size="sm" />
                {own && <Badge className="ml-auto">{t('voting.you')}</Badge>}
                {selected && (
                  <span aria-hidden="true" className="ml-auto text-xl text-accent">
                    ✓
                  </span>
                )}
              </button>
              <Button
                size="sm"
                variant="ghost"
                className="min-h-14"
                aria-label={t('voting.rewatchOf', {
                  names: authorNames(state.players, target.authorIds),
                })}
                title={t('voting.rewatch')}
                onClick={() => onRewatch(target)}
              >
                <span aria-hidden="true">▶</span>
              </Button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function Voting({ state, round }: { state: RoomState; round: RoundState }) {
  const { t } = useTranslation();
  const remaining = useRemainingMs(state.phaseEndsAt);
  const [rewatch, setRewatch] = useState<VoteTarget | null>(null);
  const canVote = round.voteTargets.some((x) => !x.authorIds.includes(state.youId));
  const done = round.votedIds.includes(state.youId);
  const rewatchEntry = rewatch ? round.entries.find((e) => e.id === rewatch.entryId) : undefined;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <Card className="flex flex-col gap-3 !p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black">{t('voting.title')}</h1>
            <p className="text-muted">{t('voting.text')}</p>
          </div>
          {remaining !== null && (
            <span
              role="timer"
              aria-label={t('studio.timeLeft')}
              className={cx(
                'rounded-full px-4 py-1.5 text-lg font-black tabular-nums',
                remaining < 10_000 ? 'bg-danger-soft text-danger' : 'bg-surface-2',
              )}
            >
              ⏱ {formatClock(remaining)}
            </span>
          )}
        </div>
        <PlayerChips
          players={state.players}
          doneIds={round.votedIds}
          doneLabel={t('voting.voted')}
          pendingLabel={t('voting.notVoted')}
        />
      </Card>

      {!canVote ? (
        <Notice tone="info">{t('voting.noTargets')}</Notice>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {VOTE_CATEGORIES.map((category) => (
            <CategoryVote
              key={category}
              category={category}
              state={state}
              round={round}
              onRewatch={setRewatch}
            />
          ))}
        </div>
      )}

      <div aria-live="polite">
        {canVote && done && <Notice tone="success">{t('voting.doneHint')}</Notice>}
      </div>

      {state.twitch.status === 'connected' && (
        <Notice tone="info" title={`${CATEGORY_ICONS.audience} ${t('voting.twitchTitle')}`}>
          {t('voting.twitchHint', { max: round.voteTargets.length })}{' '}
          <strong>{t('voting.audienceVotes', { count: round.audienceVotes })}</strong>
        </Notice>
      )}

      <Modal
        open={!!rewatch && !!rewatchEntry}
        onClose={() => setRewatch(null)}
        title={rewatch ? authorNames(state.players, rewatch.authorIds) : ''}
      >
        {rewatchEntry && (
          <video
            src={rewatchEntry.url}
            controls
            autoPlay
            playsInline
            className="aspect-video w-full rounded-2xl bg-black"
          />
        )}
      </Modal>
    </div>
  );
}
