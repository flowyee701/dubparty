let shared: AudioContext | null = null;
let worklets: Promise<void> | null = null;

/** Общий AudioContext приложения. Создаётся при первом обращении (нужен жест пользователя). */
export function getAudioContext(): AudioContext {
  shared ??= new AudioContext({ latencyHint: 'interactive' });
  if (shared.state === 'suspended') void shared.resume().catch(() => {});
  return shared;
}

export async function resumeAudio(): Promise<AudioContext> {
  const ctx = getAudioContext();
  if (ctx.state !== 'running') await ctx.resume().catch(() => {});
  return ctx;
}

/** Подгружает AudioWorklet-модули (рекордер PCM и сдвиг высоты тона). */
export function ensureWorklets(ctx: AudioContext): Promise<void> {
  if (!ctx.audioWorklet) return Promise.reject(new Error('AudioWorklet is not supported'));
  worklets ??= Promise.all([
    ctx.audioWorklet.addModule('/worklets/pcm-recorder.js'),
    ctx.audioWorklet.addModule('/worklets/pitch-shifter.js'),
  ]).then(
    () => undefined,
    (err) => {
      worklets = null;
      throw err;
    },
  );
  return worklets;
}

/**
 * Safari и iOS запускают звук только из обработчика жеста пользователя. Ставим
 * одноразовые слушатели: первое же касание или нажатие клавиши «будит» аудиоконтекст.
 */
export function installAudioUnlock(): void {
  const unlock = () => {
    if (typeof AudioContext === 'undefined') return;
    const ctx = getAudioContext();
    if (ctx.state === 'running') {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    }
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
}

/**
 * «Разблокирует» видео для последующего программного запуска. Вызывать синхронно из
 * обработчика жеста: Safari разрешает play() без жеста только элементу, который уже
 * запускали по жесту. Запуск идёт без звука и сразу ставится на паузу.
 */
const primed = new WeakSet<HTMLVideoElement>();

export function primeVideo(video: HTMLVideoElement): Promise<void> {
  // Одного раза на элемент достаточно; лишние запуски только плодят «чужие» кадры.
  if (primed.has(video)) return Promise.resolve();
  primed.add(video);
  const wasMuted = video.muted;
  video.muted = true;
  let started: Promise<void>;
  try {
    started = video.play();
  } catch {
    started = Promise.resolve();
  }
  return started
    .then(() => video.pause())
    .catch(() => {})
    .finally(() => {
      video.muted = wasMuted;
    });
}
