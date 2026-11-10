export type MicErrorKind = 'insecure' | 'unsupported' | 'denied' | 'notfound' | 'busy' | 'unknown';

export class MicError extends Error {
  constructor(readonly kind: MicErrorKind) {
    super(kind);
    this.name = 'MicError';
  }
}

/** Почему микрофон недоступен ещё до запроса разрешения (или null, если всё в порядке). */
export function micPrecheck(): MicErrorKind | null {
  // Браузеры дают микрофон только в защищённом контексте: HTTPS или localhost.
  if (!window.isSecureContext) return 'insecure';
  if (!navigator.mediaDevices?.getUserMedia) return 'unsupported';
  return null;
}

function classify(err: unknown): MicErrorKind {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'notfound';
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy';
  return 'unknown';
}

export interface MicOptions {
  deviceId?: string | null;
  /** Подавление эха нужно, когда клип играет с музыкой через колонки. */
  echoCancellation?: boolean;
}

export async function openMic({
  deviceId,
  echoCancellation = false,
}: MicOptions = {}): Promise<MediaStream> {
  const blocked = micPrecheck();
  if (blocked) throw new MicError(blocked);
  const audio = (id?: string | null): MediaTrackConstraints => ({
    ...(id ? { deviceId: { exact: id } } : {}),
    echoCancellation,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  });
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: audio(deviceId), video: false });
  } catch (err) {
    // Сохранённого устройства больше нет — пробуем любое доступное.
    if (deviceId && classify(err) === 'notfound') {
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: audio(null), video: false });
      } catch (fallbackErr) {
        throw new MicError(classify(fallbackErr));
      }
    }
    throw new MicError(classify(err));
  }
}

export function closeMic(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/** Список микрофонов. Названия появляются только после выдачи разрешения. */
export async function listMics(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== '');
}

/** Задержка входного тракта по данным браузера (мс). Не все браузеры её сообщают. */
export function inputLatencyMs(stream: MediaStream, ctx?: AudioContext): number {
  const settings = stream.getAudioTracks()[0]?.getSettings() as
    (MediaTrackSettings & { latency?: number }) | undefined;
  const track = typeof settings?.latency === 'number' ? settings.latency * 1000 : 0;
  const base = ctx && Number.isFinite(ctx.baseLatency) ? ctx.baseLatency * 1000 : 0;
  // Значения бывают нереалистичными (сотни мс на виртуальных устройствах) — ограничиваем.
  return Math.min(Math.max(track, base, 0), 250);
}
