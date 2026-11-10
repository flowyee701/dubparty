import { rankPlayers, type RoomState } from '@dubparty/shared';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { playSfx } from '../audio/sfx';
import { RoundDownloads } from '../components/Downloads';
import { AvatarBubble, Button, Card, cx } from '../components/ui';
import { useErrorText } from '../lib/hooks';
import { request } from '../net/socket';
import { toast } from '../store/toasts';

const CONFETTI = ['🎉', '✨', '🎊', '⭐', '🎈'];
const PODIUM_HEIGHT = { 1: 'h-32 sm:h-40', 2: 'h-24 sm:h-28', 3: 'h-16 sm:h-20' } as const;
const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' } as const;

function Confetti() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-10 overflow-hidden motion-reduce:hidden"
    >
      {Array.from({ length: 28 }, (_, i) => (
        <span
          key={i}
          className="absolute -top-10 animate-[fall_linear_forwards] text-2xl"
          style={{
            left: `${(i * 37) % 100}%`,
            animationDuration: `${3 + ((i * 7) % 30) / 10}s`,
            animationDelay: `${((i * 13) % 20) / 10}s`,
          }}
        >
          {CONFETTI[i % CONFETTI.length]}
        </span>
      ))}
    </div>
  );
}

/** Итоги игры: подиум, полная таблица и скачивание озвучек всех раундов. */
export function Final({ state, onLeave }: { state: RoomState; onLeave(): void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const isHost = state.hostId === state.youId;
  const hostName = state.players.find((p) => p.id === state.hostId)?.nickname ?? '';
  const ranking = rankPlayers(
    Object.fromEntries(state.players.map((p) => [p.id, p.score])),
    state.players.map((p) => p.id),
  ).map((r) => ({ ...r, player: state.players.find((p) => p.id === r.id)! }));
  const top = ranking.filter((r) => r.place <= 3).slice(0, 3);
  // Классическая расстановка подиума: второе место слева, первое по центру, третье справа.
  const podium = [top[1], top[0], top[2]].filter((r) => r !== undefined);

  useEffect(() => {
    playSfx('fanfare');
  }, []);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Confetti />
      <Card className="animate-pop text-center">
        <h1 className="text-4xl font-black">{t('final.title')}</h1>
        <ol
          className="mt-6 flex items-end justify-center gap-2 sm:gap-4"
          aria-label={t('final.podium')}
        >
          {podium.map((r) => {
            const place = Math.min(r.place, 3) as 1 | 2 | 3;
            return (
              <li key={r.id} className="flex w-28 flex-col items-center sm:w-36">
                <AvatarBubble
                  avatar={r.player.avatar}
                  color={r.player.color}
                  size={place === 1 ? 'xl' : 'lg'}
                  className="animate-rise"
                />
                <p className="mt-2 w-full truncate font-black">{r.player.nickname}</p>
                <p className="text-sm font-bold text-muted tabular-nums">
                  {t('common.points', { count: r.score })}
                </p>
                <div
                  className={cx(
                    'mt-2 grid w-full place-items-start justify-center rounded-t-2xl bg-accent pt-2 text-3xl text-accent-fg',
                    PODIUM_HEIGHT[place],
                  )}
                >
                  <span aria-hidden="true">{MEDALS[place]}</span>
                  <span className="sr-only">{t('final.place', { n: r.place })}</span>
                </div>
              </li>
            );
          })}
        </ol>
      </Card>

      {ranking.length > podium.length && (
        <Card as="section" aria-label={t('results.scoreboard')} className="!p-4">
          <ol className="flex flex-col gap-1.5">
            {ranking.slice(podium.length).map((r) => (
              <li key={r.id} className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2">
                <span className="w-6 text-center font-black tabular-nums">{r.place}</span>
                <AvatarBubble avatar={r.player.avatar} color={r.player.color} size="sm" />
                <span className="min-w-0 flex-1 truncate font-bold">{r.player.nickname}</span>
                <span className="font-black tabular-nums">{r.score}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {state.history.length > 0 && (
        <Card as="section" aria-labelledby="final-dl">
          <h2 id="final-dl" className="mb-3 text-xl font-black">
            {t('final.downloads')}
          </h2>
          <ul className="flex flex-col gap-3">
            {state.history.map((round) => (
              <li key={round.index}>
                <p className="mb-1.5 text-sm font-bold text-muted">
                  {t('final.roundTitle', { n: round.index + 1, title: round.clipTitle })}
                </p>
                <RoundDownloads state={state} round={round} />
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted">{t('final.downloadsHint')}</p>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-center gap-3">
        {isHost ? (
          <Button
            variant="primary"
            size="lg"
            onClick={() => void request('game:restart').catch((err) => toast.error(errorText(err)))}
          >
            {t('final.playAgain')}
          </Button>
        ) : (
          <p className="text-muted">{t('final.waitHost', { name: hostName })}</p>
        )}
        <Button variant="ghost" onClick={onLeave}>
          {t('room.leave')}
        </Button>
      </div>
    </div>
  );
}
