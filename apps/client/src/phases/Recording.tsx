import { charactersOf, type EffectId, type RoomState, type RoundState } from '@dubparty/shared';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { Take } from '../audio/takeSession';
import { PlayerChips } from '../components/PlayerChips';
import { Studio } from '../components/Studio';
import { Card, Spinner } from '../components/ui';
import { uploadTake } from '../net/api';
import { ApiErr } from '../net/socket';
import { useRoom } from '../store/room';

export function Recording({ state, round }: { state: RoomState; round: RoundState }) {
  const { t } = useTranslation();
  const token = useRoom((s) => s.token);
  const mine = round.troupes ? charactersOf(round.troupes, state.youId) : null;
  const names = mine?.map((id) => round.clip.characters.find((c) => c.id === id)?.name ?? id);

  const submit = useCallback(
    async (take: Take, effect: EffectId) => {
      if (!token) throw new ApiErr('NOT_IN_ROOM');
      await uploadTake({
        code: state.code,
        token,
        round: round.index,
        blob: take.blob,
        mimeType: take.mimeType,
        offsetMs: take.offsetMs,
        effect,
      });
    },
    [token, state.code, round.index],
  );

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 !p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-xl font-black">{round.clip.title}</h1>
          {names && names.length > 0 && (
            <p className="font-bold text-accent">
              {t('game.youPlay', { names: names.join(', ') })}
            </p>
          )}
        </div>
        <PlayerChips
          players={state.players}
          doneIds={round.submittedIds}
          doneLabel={t('game.takeSubmitted')}
          pendingLabel={t('game.takePending')}
        />
      </Card>
      <Studio
        key={round.index}
        clip={round.clip}
        mine={mine}
        effectsEnabled={state.settings.effectsEnabled}
        onSubmit={submit}
        deadline={state.phaseEndsAt}
        serverStatus={round.yourTake.status}
      />
    </div>
  );
}

export function Processing() {
  const { t } = useTranslation();
  return (
    <Card className="mx-auto mt-10 max-w-md animate-pop text-center" role="status">
      <Spinner className="size-10 text-accent" />
      <h1 className="mt-4 text-2xl font-black">{t('game.processingTitle')}</h1>
      <p className="mt-1 text-muted">{t('game.processingText')}</p>
    </Card>
  );
}
