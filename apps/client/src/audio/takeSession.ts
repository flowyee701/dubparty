import {
  median,
  mediaTimeAt,
  SYNC,
  takeOffsetMs,
  type EffectId,
  type VideoClockPoint,
} from '@dubparty/shared';
import { trackVideoClock, whenPlayable, type VideoClock } from '../sync/videoClock';
import { ensureWorklets, primeVideo, resumeAudio } from './context';
import { buildEffectChain, effectNeedsWorklet, type EffectChain } from './effects';
import { inputLatencyMs } from './mic';
import { createRecorder, type RecorderBackend, type TakeRecorder } from './recorder';

export interface Take {
  blob: Blob;
  mimeType: string;
  backend: RecorderBackend;
  /** Какому моменту видео (мс) соответствует нулевой сэмпл записи. */
  offsetMs: number;
  /** Раскодированный звук для предпрослушивания; null, если браузер не смог раскодировать. */
  buffer: AudioBuffer | null;
  /** Сколько раз за время записи пришлось подтянуть видео к часам. */
  driftCorrections: number;
}

/**
 * Ждёт первую точку, где видео уже реально идёт. Точки старше sinceClockMs отбрасываются:
 * сразу после перемотки колбэк кадра может принести кадр от предыдущего воспроизведения.
 */
function firstMovingPoint(
  clock: VideoClock,
  sinceClockMs: number,
  timeoutMs = 3000,
): Promise<VideoClockPoint | null> {
  return new Promise((resolve) => {
    const started = performance.now();
    const poll = () => {
      const point = clock.latest();
      if (point && point.mediaMs > 0 && point.clockMs >= sinceClockMs) resolve(point);
      else if (performance.now() - started > timeoutMs) resolve(null);
      else window.setTimeout(poll, 16);
    };
    poll();
  });
}

/**
 * Текущее время видео (мс). Основа — currentTime: по нему идёт звук клипа. Данные о кадрах
 * точнее, но годятся только когда согласуются с ним: сразу после запуска браузер может
 * показывать кадры с опозданием.
 */
function mediaNow(video: HTMLVideoElement, clock: VideoClock | null, now: number): number {
  const byClock = video.currentTime * 1000;
  const point = clock?.latest();
  if (point && now - point.clockMs < 120) {
    const byFrame = mediaTimeAt(point, now);
    if (Math.abs(byFrame - byClock) <= 60) return byFrame;
  }
  return byClock;
}

const MIN_SAMPLES_FOR_GUARD = 10;
const MAX_DRIFT_CORRECTIONS = 8;
const CORRECTION_COOLDOWN_MS = 1500;

async function seekToStart(video: HTMLVideoElement): Promise<void> {
  video.pause();
  if (video.currentTime === 0) return;
  await new Promise<void>((resolve) => {
    const done = () => {
      video.removeEventListener('seeked', done);
      resolve();
    };
    video.addEventListener('seeked', done);
    video.currentTime = 0;
    window.setTimeout(done, 1500);
  });
}

/**
 * Одна запись дубля синхронно с видео.
 *
 * Запись и воспроизведение стартуют из одного обработчика; фактическое смещение между ними
 * затем измеряется по часам видео, а не предполагается нулевым.
 */
export class TakeSession {
  private recorder: TakeRecorder | null = null;
  private clock: VideoClock | null = null;
  private guard = 0;
  private startedAt = 0;
  /** Замеры «время видео минус время записи» по ходу дубля. */
  private samples: number[] = [];
  private strikes = 0;
  private corrections = 0;
  private lastCorrectionAt = 0;
  private active = false;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly stream: MediaStream,
    private readonly forceBackend?: RecorderBackend,
  ) {}

  get recording(): boolean {
    return this.active;
  }

  /** Готовит видео и рекордер заранее, чтобы в момент старта не было задержек. */
  async prepare(): Promise<void> {
    // Первым делом, пока мы ещё в обработчике клика: после отсчёта жеста уже не будет.
    const primed = primeVideo(this.video);
    const ctx = await resumeAudio();
    await primed;
    this.recorder = await createRecorder(this.stream, ctx, this.forceBackend);
    await whenPlayable(this.video);
    await seekToStart(this.video);
  }

  async start(): Promise<void> {
    if (!this.recorder) await this.prepare();
    const recorder = this.recorder!;
    const video = this.video;
    this.corrections = 0;
    this.strikes = 0;
    this.samples = [];
    this.clock = trackVideoClock(video);
    this.active = true;

    // Один обработчик, один тик: запись и видео стартуют вместе.
    const recording = recorder.start();
    const playing = video.play();
    const [{ startedAt }] = await Promise.all([recording, playing]);
    this.startedAt = startedAt;
    this.guard = window.setInterval(() => this.checkDrift(), SYNC.checkIntervalMs);
  }

  /**
   * Раз в checkIntervalMs сверяет видео с часами записи.
   *
   * Каждый замер пополняет выборку, по которой в конце считается смещение дубля. А если
   * видео заметно и устойчиво ушло от уже сложившегося соответствия (подвисло на подгрузке,
   * вкладка побывала в фоне) — возвращаем его на место: запись идёт в реальном времени
   * и ждать видео не будет.
   */
  private checkDrift(): void {
    const video = this.video;
    const now = performance.now();
    if (video.paused || video.ended || video.seeking || video.currentTime === 0) return;
    const recordMs = now - this.startedAt;
    const sample = mediaNow(video, this.clock, now) - recordMs;
    // Первые пару секунд только накапливаем замеры: на старте видео разгоняется неровно,
    // и по нескольким первым точкам судить о «правильном» соответствии рано.
    const reference = this.samples.length >= MIN_SAMPLES_FOR_GUARD ? median(this.samples) : null;
    if (reference === null || Math.abs(sample - reference) <= SYNC.recordDriftMs) {
      this.samples.push(sample);
      this.strikes = 0;
      return;
    }
    // Одиночный выброс — ещё не дрейф: вмешиваемся, только если он повторился.
    this.strikes++;
    if (this.strikes < 2) return;
    if (now - this.lastCorrectionAt < CORRECTION_COOLDOWN_MS) return;
    if (this.corrections >= MAX_DRIFT_CORRECTIONS) return;
    const target = (recordMs + reference) / 1000;
    if (target > 0 && target < video.duration) {
      video.currentTime = target;
      this.corrections++;
      this.lastCorrectionAt = now;
      this.strikes = 0;
    }
  }

  async stop(): Promise<Take> {
    const recorder = this.recorder;
    if (!recorder) throw new Error('not recording');
    window.clearInterval(this.guard);
    this.active = false;
    const blob = await recorder.stop();
    this.video.pause();
    this.clock?.stop();
    this.recorder = null;

    const ctx = await resumeAudio();
    const offsetMs = takeOffsetMs({
      samples: this.samples,
      inputLatencyMs: inputLatencyMs(this.stream, ctx),
    });

    // Не раскодировалось — дубль всё равно можно отправить, недоступно только прослушивание.
    const buffer = await blob
      .arrayBuffer()
      .then((data) => ctx.decodeAudioData(data))
      .catch(() => null);
    return {
      blob,
      mimeType: recorder.mimeType,
      backend: recorder.backend,
      offsetMs,
      buffer,
      driftCorrections: this.corrections,
    };
  }

  cancel(): void {
    window.clearInterval(this.guard);
    this.active = false;
    this.recorder?.cancel();
    this.recorder = null;
    this.clock?.stop();
    this.video.pause();
  }
}

/**
 * Предпрослушивание дубля поверх видео с выбранным эффектом. Ведущий — звук:
 * видео подгоняется к аудиочасам.
 */
export class TakePreview {
  private source: AudioBufferSourceNode | null = null;
  private chain: EffectChain | null = null;
  private clock: VideoClock | null = null;
  private guard = 0;
  private onEnded: (() => void) | null = null;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly take: Take,
  ) {}

  async play(effect: EffectId, onEnd: () => void): Promise<void> {
    this.stop();
    const { video, take } = this;
    if (!take.buffer) throw new Error('take cannot be previewed');
    const primed = primeVideo(video);
    const ctx = await resumeAudio();
    await primed;
    if (effectNeedsWorklet(effect)) await ensureWorklets(ctx);

    await seekToStart(video);
    const chain = buildEffectChain(ctx, effect);
    const source = ctx.createBufferSource();
    source.buffer = take.buffer;
    source.connect(chain.input);
    chain.output.connect(ctx.destination);
    this.chain = chain;
    this.source = source;

    const clock = trackVideoClock(video);
    this.clock = clock;
    const calledAt = performance.now();
    await video.play();
    const point = (await firstMovingPoint(clock, calledAt)) ?? {
      clockMs: performance.now(),
      mediaMs: video.currentTime * 1000,
    };

    // Звук, поставленный в очередь сейчас, прозвучит через outputLatency — учитываем это.
    const outputLatency = Number.isFinite(ctx.outputLatency) ? ctx.outputLatency : 0;
    const lead = 0.06;
    const startCtx = ctx.currentTime + lead;
    const mediaAtStart = mediaTimeAt(point, performance.now() + lead * 1000);
    const audioPos = (mediaAtStart - take.offsetMs) / 1000 + outputLatency;
    if (audioPos >= 0) source.start(startCtx, Math.min(audioPos, take.buffer.duration));
    else source.start(startCtx - audioPos);
    chain.start(startCtx);

    const heardPosMs = () => (audioPos + (ctx.currentTime - startCtx) - outputLatency) * 1000;
    let lastCorrectionAt = 0;
    this.guard = window.setInterval(() => {
      const now = performance.now();
      if (video.paused || video.ended || video.seeking) return;
      if (now - lastCorrectionAt < CORRECTION_COOLDOWN_MS) return;
      const expected = heardPosMs() + take.offsetMs;
      const actual = mediaNow(video, clock, now);
      if (Math.abs(actual - expected) > SYNC.recordDriftMs && expected / 1000 < video.duration) {
        video.currentTime = expected / 1000;
        lastCorrectionAt = now;
      }
    }, SYNC.checkIntervalMs);

    this.onEnded = () => {
      this.stop();
      onEnd();
    };
    video.addEventListener('ended', this.onEnded);
  }

  stop(): void {
    window.clearInterval(this.guard);
    if (this.onEnded) this.video.removeEventListener('ended', this.onEnded);
    this.onEnded = null;
    try {
      this.source?.stop();
    } catch {
      // Источник мог ещё не стартовать.
    }
    this.source?.disconnect();
    this.source = null;
    this.chain?.dispose();
    this.chain = null;
    this.clock?.stop();
    this.clock = null;
    this.video.pause();
  }
}
