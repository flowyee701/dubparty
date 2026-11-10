import type { VideoClockPoint } from '@dubparty/shared';

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    cb: (now: number, metadata: { mediaTime: number; expectedDisplayTime: number }) => void,
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export interface VideoClock {
  /** Последняя известная пара «время видео ↔ локальные часы». */
  latest(): VideoClockPoint | null;
  stop(): void;
}

/**
 * Следит за тем, какой момент видео в какой момент часов показан на экране.
 * Где есть requestVideoFrameCallback — берём точные данные по кадрам; иначе
 * опрашиваем currentTime на каждом кадре анимации.
 */
export function trackVideoClock(video: HTMLVideoElement): VideoClock {
  const el = video as FrameCallbackVideo;
  let point: VideoClockPoint | null = null;
  let stopped = false;
  let handle = 0;

  if (el.requestVideoFrameCallback) {
    const onFrame = (_now: number, meta: { mediaTime: number; expectedDisplayTime: number }) => {
      if (stopped) return;
      point = { clockMs: meta.expectedDisplayTime, mediaMs: meta.mediaTime * 1000 };
      handle = el.requestVideoFrameCallback!(onFrame);
    };
    handle = el.requestVideoFrameCallback(onFrame);
    return {
      latest: () => point,
      stop() {
        stopped = true;
        el.cancelVideoFrameCallback?.(handle);
      },
    };
  }

  let last = -1;
  const tick = () => {
    if (stopped) return;
    const media = video.currentTime;
    // Запоминаем момент, когда currentTime сдвинулся: между обновлениями он «стоит».
    if (media !== last && !video.paused) {
      last = media;
      point = { clockMs: performance.now(), mediaMs: media * 1000 };
    }
    handle = requestAnimationFrame(tick);
  };
  handle = requestAnimationFrame(tick);
  return {
    latest: () => point,
    stop() {
      stopped = true;
      cancelAnimationFrame(handle);
    },
  };
}

/** Ждёт, пока видео будет готово играть без подгрузки. */
export function whenPlayable(video: HTMLVideoElement, timeoutMs = 15_000): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener('canplaythrough', onReady);
      video.removeEventListener('error', onError);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('video failed to load'));
    };
    const timer = window.setTimeout(() => {
      cleanup();
      // Медленная сеть: начнём с тем, что успело загрузиться.
      if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) resolve();
      else reject(new Error('video load timeout'));
    }, timeoutMs);
    video.addEventListener('canplaythrough', onReady);
    video.addEventListener('error', onError);
    if (video.preload !== 'auto') video.preload = 'auto';
    if (video.readyState === HTMLMediaElement.HAVE_NOTHING) video.load();
  });
}
