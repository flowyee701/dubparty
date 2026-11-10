/**
 * Единое описание голосовых эффектов. Из этих данных строятся и граф Web Audio
 * (предпрослушивание на клиенте), и цепочка фильтров ffmpeg (итоговый файл),
 * поэтому параметры у обеих реализаций одни и те же.
 *
 * Ни одна ступень не меняет длительность дорожки — иначе сломалась бы синхронизация.
 */
export const EFFECT_IDS = [
  'none',
  'pitchUp',
  'pitchDown',
  'robot',
  'echo',
  'radio',
  'helium',
] as const;
export type EffectId = (typeof EFFECT_IDS)[number];

export type EffectStage =
  /** Сдвиг высоты тона с сохранением длительности. ratio > 1 — выше. */
  | { type: 'pitch'; ratio: number }
  | { type: 'highpass'; freq: number }
  | { type: 'lowpass'; freq: number }
  | { type: 'highshelf'; freq: number; gainDb: number }
  /** Амплитудная модуляция: gain = (1 - depth/2) + (depth/2)·sin(2π·freq·t). */
  | { type: 'tremolo'; freq: number; depth: number }
  /** Отводы без обратной связи: out = (in·inGain + Σ in(t - delay)·gain) · outGain. */
  | { type: 'taps'; inGain: number; outGain: number; taps: { delayMs: number; gain: number }[] }
  /** Перегруз: усиление, затем мягкое ограничение tanh. */
  | { type: 'drive'; preGainDb: number }
  /** Подмешивание белого шума постоянной амплитуды. */
  | { type: 'noise'; amplitude: number }
  | { type: 'gain'; db: number };

export const EFFECTS: Record<EffectId, EffectStage[]> = {
  none: [],
  pitchUp: [{ type: 'pitch', ratio: 1.3 }],
  pitchDown: [{ type: 'pitch', ratio: 0.75 }],
  robot: [
    { type: 'tremolo', freq: 55, depth: 1 },
    {
      type: 'taps',
      inGain: 0.7,
      outGain: 1,
      taps: [
        { delayMs: 9, gain: 0.55 },
        { delayMs: 18, gain: 0.4 },
      ],
    },
    { type: 'gain', db: 3 },
  ],
  echo: [
    {
      type: 'taps',
      inGain: 0.85,
      outGain: 0.9,
      taps: [
        { delayMs: 260, gain: 0.45 },
        { delayMs: 520, gain: 0.22 },
        { delayMs: 780, gain: 0.1 },
      ],
    },
  ],
  radio: [
    { type: 'highpass', freq: 450 },
    { type: 'lowpass', freq: 2800 },
    { type: 'drive', preGainDb: 14 },
    { type: 'noise', amplitude: 0.012 },
    { type: 'gain', db: -3 },
  ],
  helium: [
    { type: 'pitch', ratio: 1.65 },
    { type: 'highpass', freq: 250 },
    { type: 'highshelf', freq: 3000, gainDb: 5 },
  ],
};

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}
