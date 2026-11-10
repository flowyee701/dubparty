import { ensureWorklets } from './context';

export type RecorderBackend = 'media' | 'wav';

export interface RecorderStart {
  /** performance.now() момента, которому соответствует нулевой сэмпл записи. */
  startedAt: number;
}

export interface TakeRecorder {
  readonly backend: RecorderBackend;
  readonly mimeType: string;
  start(): Promise<RecorderStart>;
  stop(): Promise<Blob>;
  cancel(): void;
}

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

/** Первый формат, который умеет MediaRecorder этого браузера (Safari — mp4/aac, остальные — webm/opus). */
export function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

class MediaTakeRecorder implements TakeRecorder {
  readonly backend = 'media' as const;
  private readonly recorder: MediaRecorder;
  private chunks: Blob[] = [];

  constructor(
    stream: MediaStream,
    readonly mimeType: string,
  ) {
    this.recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128_000 });
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
  }

  start(): Promise<RecorderStart> {
    this.chunks = [];
    return new Promise((resolve, reject) => {
      // Захват начинается в момент вызова start(); событие «start» приходит позже и
      // лишь подтверждает, что запись пошла.
      const startedAt = performance.now();
      this.recorder.onstart = () => resolve({ startedAt });
      this.recorder.onerror = () => reject(new Error('MediaRecorder failed'));
      try {
        this.recorder.start();
      } catch (err) {
        reject(err instanceof Error ? err : new Error('MediaRecorder failed'));
      }
    });
  }

  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (this.recorder.state === 'inactive') {
        resolve(new Blob(this.chunks, { type: this.mimeType }));
        return;
      }
      this.recorder.onstop = () => resolve(new Blob(this.chunks, { type: this.mimeType }));
      this.recorder.onerror = () => reject(new Error('MediaRecorder failed'));
      this.recorder.stop();
    });
  }

  cancel(): void {
    this.recorder.onstop = null;
    if (this.recorder.state !== 'inactive') this.recorder.stop();
    this.chunks = [];
  }
}

/** Кодирует моно-PCM в WAV (16 бит). */
export function encodeWav(chunks: Float32Array[], sampleRate: number): Blob {
  const length = chunks.reduce((n, c) => n + c.length, 0);
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, length * 2, true);
  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, chunk[i]!));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

const WAV_PIPELINE_MS = 30;

class WavTakeRecorder implements TakeRecorder {
  readonly backend = 'wav' as const;
  readonly mimeType = 'audio/wav';
  private chunks: Float32Array[] = [];
  private onStarted: ((contextTime: number) => void) | null = null;
  private onStopped: (() => void) | null = null;
  private readonly source: MediaStreamAudioSourceNode;
  private readonly node: AudioWorkletNode;
  private readonly sink: GainNode;

  constructor(
    stream: MediaStream,
    private readonly ctx: AudioContext,
  ) {
    this.source = ctx.createMediaStreamSource(stream);
    this.node = new AudioWorkletNode(ctx, 'pcm-recorder', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
    });
    // Узел должен быть подключён к выходу, иначе браузер его не обрабатывает; громкость — ноль.
    this.sink = ctx.createGain();
    this.sink.gain.value = 0;
    this.source.connect(this.node).connect(this.sink).connect(ctx.destination);
    this.node.port.onmessage = (
      event: MessageEvent<{ type: string; samples?: Float32Array; contextTime?: number }>,
    ) => {
      const data = event.data;
      if (data.type === 'chunk' && data.samples) this.chunks.push(data.samples);
      else if (data.type === 'started') this.onStarted?.(data.contextTime ?? ctx.currentTime);
      else if (data.type === 'stopped') this.onStopped?.();
    };
  }

  start(): Promise<RecorderStart> {
    this.chunks = [];
    return new Promise((resolve) => {
      this.onStarted = (contextTime) => {
        // Переводим время аудиоконтекста в шкалу performance.now().
        const stamp = this.ctx.getOutputTimestamp?.();
        const startedAt =
          stamp && stamp.contextTime && stamp.performanceTime
            ? stamp.performanceTime + (contextTime - stamp.contextTime) * 1000
            : performance.now() - (this.ctx.currentTime - contextTime) * 1000;
        // Путь «поток микрофона → worklet» добавляет буферизацию, которую браузер не сообщает;
        // величина подобрана по калибровочному тесту (Chromium и WebKit дают 30–40 мс).
        resolve({ startedAt: startedAt - WAV_PIPELINE_MS });
      };
      this.node.port.postMessage('start');
    });
  }

  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      this.onStopped = () => {
        resolve(encodeWav(this.chunks, this.ctx.sampleRate));
        this.dispose();
      };
      this.node.port.postMessage('stop');
    });
  }

  cancel(): void {
    this.node.port.postMessage('stop');
    this.chunks = [];
    this.dispose();
  }

  private dispose(): void {
    this.source.disconnect();
    this.node.disconnect();
    this.sink.disconnect();
  }
}

/** Движок WebKit: Safari на macOS и все браузеры на iOS (там Chrome и Firefox — тоже WebKit). */
export function isWebKit(userAgent = navigator.userAgent): boolean {
  return /AppleWebKit/.test(userAgent) && !/Chrome|Chromium|Edg\/|OPR\/|Android/.test(userAgent);
}

/**
 * Какой бэкенд записи использовать по умолчанию.
 *
 * MediaRecorder в WebKit не годится для точной синхронизации: в калибровочных замерах он
 * терял начало записи (до двух секунд в webm) и сдвигал его на ~80 мс в mp4. Поэтому там
 * по умолчанию пишем PCM в WAV — у него момент старта известен с точностью до сэмпла.
 */
export function preferredBackend(): RecorderBackend {
  const canMedia = pickMimeType() !== null;
  const canWav = typeof AudioWorkletNode !== 'undefined';
  if (!canMedia) return 'wav';
  return isWebKit() && canWav ? 'wav' : 'media';
}

/**
 * Создаёт рекордер: MediaRecorder либо захват PCM в WAV (см. preferredBackend).
 * forceBackend — ручной переключатель для тестов и диагностики.
 */
export async function createRecorder(
  stream: MediaStream,
  ctx: AudioContext,
  forceBackend?: RecorderBackend,
): Promise<TakeRecorder> {
  const backend = forceBackend ?? preferredBackend();
  const mimeType = pickMimeType();
  if (backend === 'media' && mimeType) return new MediaTakeRecorder(stream, mimeType);
  try {
    await ensureWorklets(ctx);
    return new WavTakeRecorder(stream, ctx);
  } catch (err) {
    // Worklet не загрузился — лучше неидеальная запись, чем никакой.
    if (mimeType) return new MediaTakeRecorder(stream, mimeType);
    throw err;
  }
}
