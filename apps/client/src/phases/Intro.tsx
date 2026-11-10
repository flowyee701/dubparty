import { charactersOf, type RoomState, type RoundState } from '@dubparty/shared';
import { useTranslation } from 'react-i18next';
import { AvatarBubble, Badge, Card } from '../components/ui';
import { useRemainingMs } from '../lib/hooks';

/** Заставка раунда: какой клип, какой режим и кто кого играет. */
export function Intro({ state, round }: { state: RoomState; round: RoundState }) {
  const { t } = useTranslation();
  const remaining = useRemainingMs(state.phaseEndsAt);
  const mine = round.troupes ? charactersOf(round.troupes, state.youId) : null;
  const name = (id: string) => round.clip.characters.find((c) => c.id === id)?.name ?? id;

  return (
    <Card className="mx-auto max-w-3xl animate-pop text-center">
      <p className="text-sm font-bold tracking-wide text-accent uppercase">
        {t('game.roundOf', { n: round.index + 1, total: state.totalRounds })}
      </p>
      <h1 className="mt-1 text-3xl font-black text-balance sm:text-4xl">{round.clip.title}</h1>
      <div className="mt-2 flex justify-center">
        <Badge tone="accent">{t(`modes.${round.mode}.name`)}</Badge>
      </div>

      <div className="relative mx-auto mt-5 aspect-video max-w-xl overflow-hidden rounded-3xl bg-black">
        <img src={round.clip.posterUrl} alt="" className="size-full object-cover" />
        {/* Клип начинает грузиться заранее, чтобы запись стартовала без ожидания. */}
        <video src={round.clip.videoUrl} preload="auto" muted playsInline className="hidden" />
        {remaining !== null && (
          <div
            className="absolute right-3 bottom-3 rounded-full bg-black/70 px-3 py-1 text-sm font-bold text-white tabular-nums"
            role="timer"
          >
            {t('game.startsIn', { count: Math.ceil(remaining / 1000) })}
          </div>
        )}
      </div>

      <p className="mx-auto mt-4 max-w-xl text-pretty text-muted">
        {t(`game.introHint.${round.mode}`)}
      </p>

      {mine && mine.length > 0 && (
        <p className="mt-4 text-lg font-bold" role="status">
          {t('game.youPlay', { names: mine.map(name).join(', ') })}
        </p>
      )}

      {round.troupes && (
        <ul className="mt-4 grid gap-2 text-left sm:grid-cols-2">
          {round.troupes.map((troupe, i) => (
            <li key={troupe.id} className="rounded-2xl border border-border bg-surface-2 p-3">
              {round.troupes!.length > 1 && (
                <p className="mb-2 text-xs font-bold text-muted uppercase">
                  {t('game.troupe', { n: i + 1 })}
                </p>
              )}
              <ul className="flex flex-col gap-1.5">
                {troupe.members.map((m) => {
                  const player = state.players.find((p) => p.id === m.playerId);
                  if (!player) return null;
                  return (
                    <li key={m.playerId} className="flex items-center gap-2 text-sm">
                      <AvatarBubble avatar={player.avatar} color={player.color} size="sm" />
                      <span className="font-semibold">{player.nickname}</span>
                      <span className="text-muted">— {m.characterIds.map(name).join(', ')}</span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
