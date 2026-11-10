import { EFFECTS, type EffectId, type EffectStage, type TimeWindow } from '@dubparty/shared';

export const SAMPLE_RATE = 48_000;

function num(value: number, digits = 4): string {
  return Number(value.toFixed(digits)).toString();
}

/** Одна ступень эффекта → фильтры ffmpeg. Шум подмешивается отдельно (нужен второй источник). */
export function stageToFilters(stage: EffectStage): string[] {
  switch (stage.type) {
    case 'pitch':
      // Меняем частоту дискретизации (высота и темп вместе), затем возвращаем темп.
      return [
        `asetrate=${Math.round(SAMPLE_RATE * stage.ratio)}`,
        `aresample=${SAMPLE_RATE}`,
        `atempo=${num(1 / stage.ratio, 6)}`,
      ];
    case 'highpass':
      return [`highpass=f=${num(stage.freq)}:poles=2`];
    case 'lowpass':
      return [`lowpass=f=${num(stage.freq)}:poles=2`];
    case 'highshelf':
      return [`highshelf=f=${num(stage.freq)}:g=${num(stage.gainDb)}`];
    case 'tremolo':
      return [`tremolo=f=${num(stage.freq)}:d=${num(stage.depth)}`];
    case 'taps':
      return [
        `aecho=in_gain=${num(stage.inGain)}:out_gain=${num(stage.outGain)}` +
          `:delays=${stage.taps.map((t) => num(t.delayMs)).join('|')}` +
          `:decays=${stage.taps.map((t) => num(t.gain)).join('|')}`,
      ];
    case 'drive':
      return [`volume=${num(stage.preGainDb)}dB`, 'asoftclip=type=tanh'];
    case 'gain':
      return [`volume=${num(stage.db)}dB`];
    case 'noise':
      return [];
  }
}

/** Плавное «окно» громкости: 1 внутри окон, 0 снаружи, с короткими фейдами на границах. */
export function gateExpression(windows: readonly TimeWindow[], fadeMs = 40): string {
  if (windows.length === 0) return '0';
  const f = num(fadeMs / 1000);
  const terms = windows.map(
    (w) => `clip((t-${num(w.startMs / 1000)})/${f},0,1)*clip((${num(w.endMs / 1000)}-t)/${f},0,1)`,
  );
  return terms.reduce((acc, term) => `max(${acc},${term})`);
}

export interface TakeGraphInput {
  offsetMs: number;
  effect: EffectId;
  durationMs: number;
  windows?: readonly TimeWindow[];
}

/**
 * Граф обработки дубля. Вход [0:a] — сырая запись, выход [out] — моно 48 кГц
 * длиной ровно в клип, где нулевой сэмпл соответствует нулевому кадру видео.
 */
export function buildTakeGraph({ offsetMs, effect, durationMs, windows }: TakeGraphInput): string {
  const duration = num(durationMs / 1000);
  const chain: string[] = [
    // first_pts=0 и async=1: дорожка начинается с нуля, пропуски заполняются тишиной.
    `aresample=${SAMPLE_RATE}:async=1:first_pts=0`,
    'aformat=sample_fmts=fltp:channel_layouts=mono',
    'highpass=f=70',
  ];

  // Выравнивание по видео: offsetMs — момент видео, которому соответствует начало записи.
  const offset = Math.round(offsetMs);
  if (offset > 0) chain.push(`adelay=delays=${offset}:all=1`);
  else if (offset < 0) chain.push(`atrim=start=${num(-offset / 1000)}`, 'asetpts=PTS-STARTPTS');

  // Выравниваем громкость до эффектов, чтобы перегруз и шум вели себя предсказуемо.
  chain.push('dynaudnorm=f=250:g=15:p=0.9:m=8');

  const stages = EFFECTS[effect];
  const noise = stages.find((s) => s.type === 'noise');
  for (const stage of stages) chain.push(...stageToFilters(stage));

  const tail: string[] = [];
  if (windows) tail.push(`volume=eval=frame:volume='${gateExpression(windows)}'`);
  tail.push(
    `apad=whole_dur=${duration}`,
    `atrim=end=${duration}`,
    'asetpts=PTS-STARTPTS',
    'alimiter=limit=0.95:latency=1',
    `aresample=${SAMPLE_RATE}`,
  );

  if (noise && noise.type === 'noise') {
    return [
      `[0:a]${chain.join(',')}[fx]`,
      `anoisesrc=color=white:amplitude=${num(noise.amplitude)}:sample_rate=${SAMPLE_RATE}:duration=${duration}[noise]`,
      `[fx][noise]amix=inputs=2:normalize=0:duration=first[mixed]`,
      `[mixed]${tail.join(',')}[out]`,
    ].join(';');
  }
  return `[0:a]${[...chain, ...tail].join(',')}[out]`;
}

/**
 * Граф сведения готового видео. Вход 0 — клип (с музыкой, если hasMusic),
 * входы 1..N — выровненные голоса. Выход [a].
 */
export function buildReviewGraph(
  voiceCount: number,
  hasMusic: boolean,
  durationMs: number,
): string {
  const duration = num(durationMs / 1000);
  const parts: string[] = [];
  const voiceLabels = Array.from({ length: voiceCount }, (_, i) => `[${i + 1}:a]`).join('');
  parts.push(
    voiceCount > 1
      ? `${voiceLabels}amix=inputs=${voiceCount}:normalize=0:duration=longest[voice]`
      : `${voiceLabels}anull[voice]`,
  );
  if (hasMusic) {
    // Музыку приглушаем, чтобы голос оставался разборчивым.
    parts.push(`[0:a]aresample=${SAMPLE_RATE},volume=-8dB[music]`);
    parts.push('[music][voice]amix=inputs=2:normalize=0:duration=longest[mix]');
  } else {
    parts.push('[voice]anull[mix]');
  }
  parts.push(
    `[mix]apad=whole_dur=${duration},atrim=end=${duration},alimiter=limit=0.95:latency=1,aresample=${SAMPLE_RATE}[a]`,
  );
  return parts.join(';');
}

export const VIDEO_FILTER =
  // Вписываем в 1280×720 без апскейла, чётные размеры, 30 кадров, совместимый формат пикселей.
  "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease," +
  'scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30,format=yuv420p,setsar=1';
