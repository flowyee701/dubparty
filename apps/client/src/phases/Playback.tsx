import type { PlaybackControl, RoomState, RoundState } from '@dubparty/shared';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Authors } from '../components/PlayerChips';
import { Button, Card, cx } from '../components/ui';
import { formatClock, useErrorText } from '../lib/hooks';
import { request } from '../net/socket';
import { useRoom } from '../store/room';
import { toast } from '../store/toasts';
import { useSyncedVideo } from '../sync/useSyncedVideo';

/** Ползунок перемотки для хоста: показывает локальную позицию, отправляет итог. */
function SeekBar({
  video,
  durationMs,
  onSeek,
}: {
  video: React.RefObject<HTMLVideoElement | null>;
  durationMs: number;
  onSeek(positionMs: number): void;
}) {
  const { t } = useTranslation();
  const [position, setPosition] = useState(0);
  const [dragging, setDragging] = useState<number | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => {
      const el = video.current;
      if (el) setPosition(Math.min(el.currentTime * 1000, durationMs));
    }, 200);
    return () => window.clearInterval(id);
  }, [video, durationMs]);

  const shown = dragging ?? position;
  const commit = () => {
    if (dragging !== null) onSeek(dragging);
    setDragging(null);
  };

  return (
    <div className="flex items-center gap-3">
      <span className="w-10 text-right text-sm font-semibold tabular-nums">
        {formatClock(shown)}
      </span>
      <input
        type="range"
        min={0}
        max={durationMs}
        step={100}
        value={shown}
        aria-label={t('game.seek')}
        aria-valuetext={formatClock(shown)}
        onChange={(e) => setDragging(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="min-w-0 flex-1"
      />
      <span className="w-10 text-sm font-semibold text-muted tabular-nums">
        {formatClock(durationMs)}
      </span>
    </div>
  );
}

/** Общий просмотр озвучек: у всех одно и то же в один и тот же момент. */
export function Playback({ state, round }: { state: RoomState; round: RoundState }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const video = useRef<HTMLVideoElement>(null);
  // Событие playback:sync приходит раньше общего снапшота — берём самое свежее состояние.
  const playback = useRoom((s) => s.playback) ?? round.playback;
  const entry = playback ? round.entries[playback.entryIndex] : undefined;
  const next = playback ? round.entries[playback.entryIndex + 1] : undefined;
  const { prerollMs, soundBlocked, enableSound } = useSyncedVideo(video, playback, entry);
  const isHost = state.hostId === state.youId;
  const hostName = state.players.find((p) => p.id === state.hostId)?.nickname ?? '';

  const control = (payload: PlaybackControl) =>
    void request('playback:control', payload).catch((err) => toast.error(errorText(err)));

  if (!playback || !entry) return null;
  const last = playback.entryIndex === round.entries.length - 1;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 !p-4">
        <div className="min-w-0">
          <p className="text-sm font-bold tracking-wide text-accent uppercase">
            {t('game.entryOf', { n: playback.entryIndex + 1, total: round.entries.length })}
          </p>
          <h1 className="flex min-w-0 items-center gap-2 text-xl">
            <Authors players={state.players} authorIds={entry.authorIds} />
          </h1>
        </div>
        <p className="text-sm text-muted">{round.clip.title}</p>
      </Card>

      <div className="relative aspect-video overflow-hidden rounded-3xl bg-black shadow-lg">
        <video
          ref={video}
          playsInline
          preload="auto"
          disablePictureInPicture
          className="size-full object-contain"
          aria-label={t('game.dubBy', {
            names: entry.authorIds
              .map((id) => state.players.find((p) => p.id === id)?.nickname ?? '?')
              .join(', '),
          })}
        />
        {/* Следующая запись подгружается заранее, чтобы переключение было мгновенным. */}
        {next && <video src={next.url} preload="auto" muted playsInline className="hidden" />}

        {prerollMs !== null && (
          <div
            className="absolute inset-0 grid animate-fade place-items-center bg-black/80 p-6 text-center text-white"
            role="status"
          >
            <div className="flex flex-col items-center gap-3">
              <p className="text-sm font-bold tracking-wide uppercase opacity-80">
                {t('game.upNext')}
              </p>
              <p className="flex items-center gap-3 text-2xl sm:text-4xl">
                <Authors players={state.players} authorIds={entry.authorIds} size="lg" />
              </p>
              <p className="text-5xl font-black tabular-nums" aria-hidden="true">
                {Math.ceil(prerollMs / 1000)}
              </p>
            </div>
          </div>
        )}

        {!playback.playing && prerollMs === null && (
          <div className="absolute top-3 left-3 rounded-full bg-black/70 px-3 py-1.5 text-sm font-bold text-white">
            ⏸ {t('game.paused')}
          </div>
        )}

        {soundBlocked && (
          <button
            type="button"
            onClick={enableSound}
            className="absolute inset-x-0 bottom-0 bg-accent px-4 py-3 text-center text-lg font-bold text-accent-fg"
          >
            🔊 {t('game.enableSound')}
          </button>
        )}
      </div>

      {isHost ? (
        <Card className="flex flex-col gap-3 !p-4" as="section" aria-label={t('game.hostControls')}>
          <SeekBar
            video={video}
            durationMs={entry.durationMs}
            onSeek={(positionMs) => control({ action: 'seek', positionMs })}
          />
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              onClick={() => control({ action: 'prev' })}
              disabled={playback.entryIndex === 0}
            >
              ⏮ {t('game.prev')}
            </Button>
            <Button
              variant="primary"
              className={cx('min-w-36')}
              onClick={() => control({ action: playback.playing ? 'pause' : 'play' })}
            >
              {playback.playing ? `⏸ ${t('game.pause')}` : `▶ ${t('game.play')}`}
            </Button>
            <Button onClick={() => control({ action: 'next' })}>
              {last ? `${t('game.toVoting')} ⏭` : `${t('game.next')} ⏭`}
            </Button>
            {!last && (
              <Button variant="ghost" onClick={() => control({ action: 'finish' })}>
                {t('game.skipToVoting')}
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <p className="text-center text-sm text-muted">
          {t('game.hostControlsHint', { name: hostName })}
        </p>
      )}
    </div>
  );
}
