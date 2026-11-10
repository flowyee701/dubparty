import { SYNC } from './constants';

export interface ClockSample {
  /** Локальное время отправки запроса. */
  sentAt: number;
  /** Локальное время получения ответа. */
  receivedAt: number;
  /** Время сервера в ответе. */
  serverTime: number;
}

export interface ClockEstimate {
  /** serverTime ≈ localTime + offsetMs */
  offsetMs: number;
  rttMs: number;
}

/**
 * Оценка сдвига часов по серии замеров: берём замер с наименьшим RTT —
 * у него минимальная неопределённость (±RTT/2).
 */
export function estimateClock(samples: readonly ClockSample[]): ClockEstimate | null {
  let best: ClockEstimate | null = null;
  for (const s of samples) {
    const rttMs = s.receivedAt - s.sentAt;
    if (rttMs < 0) continue;
    if (!best || rttMs < best.rttMs) {
      best = { offsetMs: s.serverTime - (s.sentAt + rttMs / 2), rttMs };
    }
  }
  return best;
}

export interface PlaybackAnchor {
  playing: boolean;
  /** Позиция в момент serverTime. */
  positionMs: number;
  /** Момент времени сервера, к которому привязана позиция. Может быть в будущем (преролл). */
  serverTime: number;
}

/**
 * Где сейчас должно быть воспроизведение. Отрицательное значение означает преролл:
 * до старта осталось столько миллисекунд.
 */
export function rawPositionAt(anchor: PlaybackAnchor, serverNow: number): number {
  if (!anchor.playing) return anchor.positionMs;
  return anchor.positionMs + (serverNow - anchor.serverTime);
}

export function positionAt(anchor: PlaybackAnchor, serverNow: number, durationMs: number): number {
  return Math.min(Math.max(rawPositionAt(anchor, serverNow), 0), durationMs);
}

export type SyncCorrection =
  { action: 'none'; rate: 1 } | { action: 'rate'; rate: number } | { action: 'seek'; rate: 1 };

/**
 * Что делать с плеером при данном отклонении (actual − target, мс):
 * малое не трогаем, среднее догоняем скоростью, большое — прыжком.
 */
export function correctionFor(driftMs: number): SyncCorrection {
  const abs = Math.abs(driftMs);
  if (abs <= SYNC.softMs) return { action: 'none', rate: 1 };
  if (abs <= SYNC.toleranceMs) {
    return { action: 'rate', rate: driftMs > 0 ? 1 - SYNC.rateDelta : 1 + SYNC.rateDelta };
  }
  return { action: 'seek', rate: 1 };
}

/**
 * Линейное соответствие «время видео ↔ локальные часы», собранное по кадрам.
 * Позволяет узнать, какой момент видео был на экране в произвольный момент часов.
 */
export interface VideoClockPoint {
  /** performance.now(), мс */
  clockMs: number;
  /** Время видео, мс */
  mediaMs: number;
}

export function mediaTimeAt(point: VideoClockPoint, clockMs: number, rate = 1): number {
  return point.mediaMs + (clockMs - point.clockMs) * rate;
}

/**
 * Смещение начала записи относительно видео: какому моменту видео соответствует
 * нулевой сэмпл записи. Звук попал в микрофон на inputLatencyMs раньше, чем дошёл
 * до рекордера, поэтому задержку входа вычитаем.
 */
export function takeOffsetMs(input: {
  video: VideoClockPoint;
  recordStartClockMs: number;
  inputLatencyMs?: number;
}): number {
  const latency = Number.isFinite(input.inputLatencyMs) ? Math.max(0, input.inputLatencyMs!) : 0;
  return Math.round(mediaTimeAt(input.video, input.recordStartClockMs) - latency);
}

/** Индекс реплики, звучащей в момент tMs, либо -1. */
export function activeLineIndex(
  lines: readonly { startMs: number; endMs: number }[],
  tMs: number,
): number {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (tMs >= l.startMs && tMs < l.endMs) return i;
  }
  return -1;
}
