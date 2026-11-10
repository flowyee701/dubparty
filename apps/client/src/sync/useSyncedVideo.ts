import {
  correctionFor,
  rawPositionAt,
  SYNC,
  type EntryPublic,
  type PlaybackState,
} from '@dubparty/shared';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { serverNow } from '../store/room';

export interface SyncedVideo {
  /** Сколько миллисекунд до старта записи (заставка) — или null, если она уже идёт. */
  prerollMs: number | null;
  /** Браузер не дал включить звук без жеста: показываем кнопку. */
  soundBlocked: boolean;
  enableSound(): void;
}

/** После прыжка плееру нужно время, чтобы догрузиться; раньше не дёргаем. */
const SEEK_COOLDOWN_MS = 700;
/** Прыжок занимает время, поэтому целимся чуть вперёд. */
const SEEK_LEAD_MS = 60;

/**
 * Ведёт локальный плеер за состоянием воспроизведения с сервера.
 *
 * Сервер — источник правды: клиент по своим часам (сдвинутым на оценку разницы с серверными)
 * вычисляет, где должно быть воспроизведение, и подгоняет видео: малое отклонение не трогает,
 * среднее догоняет скоростью, большое (больше допуска в 150 мс) — прыжком.
 */
export function useSyncedVideo(
  video: RefObject<HTMLVideoElement | null>,
  playback: PlaybackState | null,
  entry: EntryPublic | undefined,
): SyncedVideo {
  const [prerollMs, setPrerollMs] = useState<number | null>(null);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const lastSeekAt = useRef(0);
  const starting = useRef(false);

  // Один и тот же элемент переиспользуется для всех записей: разблокированный жестом
  // элемент Safari потом разрешает запускать программно.
  useEffect(() => {
    const el = video.current;
    if (!el || !entry) return;
    if (!el.src.endsWith(entry.url)) {
      el.src = entry.url;
      el.load();
    }
  }, [video, entry]);

  useEffect(() => {
    const el = video.current;
    if (!el || !playback || !entry) return;

    const startPlaying = (positionMs: number) => {
      if (starting.current) return;
      starting.current = true;
      el.currentTime = positionMs / 1000;
      el.play()
        .catch(async () => {
          // Автозапуск со звуком запрещён: играем без звука и просим включить его вручную.
          el.muted = true;
          setSoundBlocked(true);
          await el.play().catch(() => {});
        })
        .finally(() => {
          starting.current = false;
        });
    };

    const tick = () => {
      const now = performance.now();
      const raw = rawPositionAt(playback, serverNow());
      const durationMs = entry.durationMs;

      if (raw < 0) {
        // Заставка перед записью: стоим на первом кадре.
        setPrerollMs(-raw);
        if (!el.paused) el.pause();
        if (el.currentTime !== 0 && !el.seeking) el.currentTime = 0;
        el.playbackRate = 1;
        return;
      }
      setPrerollMs(null);
      const target = Math.min(raw, durationMs);

      if (!playback.playing) {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime * 1000 - target) > 50 && !el.seeking) {
          el.currentTime = target / 1000;
        }
        el.playbackRate = 1;
        report(el.currentTime * 1000 - target, false);
        return;
      }

      if (target >= durationMs - 30) {
        // Запись доиграла: ждём, пока сервер переключит на следующую.
        el.playbackRate = 1;
        report(0, true);
        return;
      }

      if (el.paused || el.ended) {
        if (el.readyState >= HTMLMediaElement.HAVE_METADATA) startPlaying(target + SEEK_LEAD_MS);
        return;
      }
      if (el.seeking || el.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return;

      const driftMs = el.currentTime * 1000 - target;
      report(driftMs, true);
      const fix = correctionFor(driftMs);
      if (fix.action === 'seek') {
        if (now - lastSeekAt.current > SEEK_COOLDOWN_MS) {
          lastSeekAt.current = now;
          el.playbackRate = 1;
          el.currentTime = (target + SEEK_LEAD_MS) / 1000;
        }
      } else {
        el.playbackRate = fix.rate;
      }
    };

    const report = (driftMs: number, playing: boolean) => {
      window.__dubparty = { ...window.__dubparty, sync: { driftMs, entryId: entry.id, playing } };
    };

    tick();
    const id = window.setInterval(tick, SYNC.checkIntervalMs);
    return () => window.clearInterval(id);
  }, [video, playback, entry]);

  const enableSound = useCallback(() => {
    const el = video.current;
    if (!el) return;
    el.muted = false;
    setSoundBlocked(false);
    // Если видео стояло — запустится на ближайшем тике синхронизации; жест уже получен.
    void el.play().catch(() => {});
  }, [video]);

  return { prerollMs, soundBlocked, enableSound };
}
