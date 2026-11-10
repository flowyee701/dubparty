import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EFFECT_IDS, EFFECTS, type EffectId } from '@dubparty/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalDiskAdapter } from '../storage';
import { configureFfmpeg, resolveFfmpegPaths, runFfmpeg } from './ffmpeg';
import { buildReviewGraph, buildTakeGraph, gateExpression, stageToFilters } from './filters';
import { createMediaPipeline, MediaTools } from './pipeline';

const SR = 48_000;

function wavFromSamples(samples: Int16Array): Buffer {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function sineWav(durationS: number, freq: number): Buffer {
  const samples = new Int16Array(Math.round(durationS * SR));
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.round(Math.sin((2 * Math.PI * freq * i) / SR) * 16_000);
  }
  return wavFromSamples(samples);
}

/** Основная частота по числу переходов через ноль на участке записи. */
function zeroCrossingHz(samples: Int16Array, fromS: number, toS: number): number {
  let crossings = 0;
  const from = Math.round(fromS * SR);
  const to = Math.min(samples.length, Math.round(toS * SR));
  for (let i = from + 1; i < to; i++) {
    if (samples[i - 1]! < 0 !== samples[i]! < 0) crossings++;
  }
  return crossings / 2 / (toS - fromS);
}

/** WAV с короткими щелчками в заданные моменты (секунды). */
function clickWav(durationS: number, clicks: number[]): Buffer {
  const samples = new Int16Array(Math.round(durationS * SR));
  for (const at of clicks) {
    const from = Math.round(at * SR);
    for (let i = 0; i < 480 && from + i < samples.length; i++) {
      samples[from + i] = Math.round(
        Math.sin((2 * Math.PI * 1000 * i) / SR) * 28_000 * Math.exp(-i / 200),
      );
    }
  }
  const data = Buffer.from(samples.buffer);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function readWav(file: string): { samples: Int16Array; durationMs: number } {
  const buf = readFileSync(file);
  const dataAt = buf.indexOf('data', 12, 'latin1');
  const size = buf.readUInt32LE(dataAt + 4);
  const start = dataAt + 8;
  const bytes = Math.min(size, buf.length - start);
  const samples = new Int16Array(
    buf.buffer.slice(buf.byteOffset + start, buf.byteOffset + start + bytes - (bytes % 2)),
  );
  return { samples, durationMs: (samples.length / SR) * 1000 };
}

/** Моменты начала щелчков (мс): первый громкий сэмпл после ≥200 мс тишины. */
function onsets(samples: Int16Array): number[] {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const threshold = peak * 0.3;
  const found: number[] = [];
  let quietUntil = 0;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]!) >= threshold) {
      if (i >= quietUntil) found.push((i / SR) * 1000);
      quietUntil = i + SR * 0.2;
    }
  }
  return found;
}

describe('построение фильтров', () => {
  it('положительное смещение — задержка, отрицательное — обрезка начала', () => {
    expect(buildTakeGraph({ offsetMs: 120, effect: 'none', durationMs: 5000 })).toContain(
      'adelay=delays=120:all=1',
    );
    const early = buildTakeGraph({ offsetMs: -250, effect: 'none', durationMs: 5000 });
    expect(early).toContain('atrim=start=0.25,asetpts=PTS-STARTPTS');
    expect(early).not.toContain('adelay');
    const zero = buildTakeGraph({ offsetMs: 0, effect: 'none', durationMs: 5000 });
    expect(zero).not.toMatch(/adelay|atrim=start/);
    expect(zero).toContain('apad=whole_dur=5,atrim=end=5');
  });

  it('эффекты превращаются в фильтры ffmpeg с теми же параметрами', () => {
    expect(stageToFilters({ type: 'pitch', ratio: 1.5 })).toEqual([
      'asetrate=72000',
      'aresample=48000',
      'atempo=0.666667',
    ]);
    expect(stageToFilters({ type: 'tremolo', freq: 55, depth: 1 })).toEqual(['tremolo=f=55:d=1']);
    expect(
      stageToFilters({
        type: 'taps',
        inGain: 0.8,
        outGain: 0.9,
        taps: [
          { delayMs: 250, gain: 0.4 },
          { delayMs: 500, gain: 0.2 },
        ],
      }),
    ).toEqual(['aecho=in_gain=0.8:out_gain=0.9:delays=250|500:decays=0.4|0.2']);
    expect(stageToFilters({ type: 'drive', preGainDb: 12 })).toEqual([
      'volume=12dB',
      'asoftclip=type=tanh',
    ]);
    expect(buildTakeGraph({ offsetMs: 0, effect: 'radio', durationMs: 4000 })).toContain(
      'anoisesrc=',
    );
  });

  it('окна реплик дают выражение громкости с фейдами', () => {
    expect(gateExpression([])).toBe('0');
    const one = gateExpression([{ startMs: 1000, endMs: 2500 }]);
    expect(one).toBe('clip((t-1)/0.04,0,1)*clip((2.5-t)/0.04,0,1)');
    const two = gateExpression([
      { startMs: 0, endMs: 500 },
      { startMs: 1000, endMs: 2000 },
    ]);
    expect(two.startsWith('max(')).toBe(true);
  });

  it('сведение: несколько голосов и музыка', () => {
    expect(buildReviewGraph(1, false, 3000)).toContain('[1:a]anull[voice]');
    const mix = buildReviewGraph(3, true, 3000);
    expect(mix).toContain('[1:a][2:a][3:a]amix=inputs=3');
    expect(mix).toContain('[0:a]aresample=48000,volume=-8dB[music]');
  });
});

describe('ffmpeg: обработка дубля и сборка видео', () => {
  let dir: string;
  let tools: MediaTools;
  const raw = () => path.join(dir, 'raw.wav');

  beforeAll(() => {
    configureFfmpeg(resolveFfmpegPaths({}));
    dir = mkdtempSync(path.join(os.tmpdir(), 'dubparty-media-'));
    tools = new MediaTools(2);
    writeFileSync(raw(), clickWav(3, [1.0, 2.0]));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it.each([
    [0, [1000, 2000]],
    [150, [1150, 2150]],
    [-300, [700, 1700]],
  ])(
    'смещение %i мс: щелчки оказываются там, где должны быть на шкале видео',
    async (offsetMs, expected) => {
      const out = path.join(dir, `aligned-${offsetMs}.wav`);
      await tools.processTake(raw(), out, { offsetMs, effect: 'none', durationMs: 4000 });
      const { samples, durationMs } = readWav(out);
      // Длина — ровно клип, независимо от длины записи
      expect(Math.abs(durationMs - 4000)).toBeLessThan(2);
      const found = onsets(samples);
      expect(found).toHaveLength(2);
      found.forEach((ms, i) => expect(Math.abs(ms - expected[i]!)).toBeLessThan(3));
    },
  );

  it.each(EFFECT_IDS)('эффект «%s» не меняет длительность дорожки', async (effect) => {
    const out = path.join(dir, `fx-${effect}.wav`);
    await tools.processTake(raw(), out, { offsetMs: 40, effect, durationMs: 4000 });
    const { samples, durationMs } = readWav(out);
    expect(Math.abs(durationMs - 4000)).toBeLessThan(2);
    // Звук не пропал и остался примерно на месте (эхо и сдвиг тона чуть размывают фронт)
    const [first] = onsets(samples);
    expect(first).toBeDefined();
    expect(Math.abs(first! - 1040)).toBeLessThan(60);
  });

  it.each(['pitchUp', 'pitchDown', 'helium'] as EffectId[])(
    'эффект «%s» сдвигает высоту тона ровно на заданный коэффициент',
    async (effect) => {
      const stage = EFFECTS[effect].find((st) => st.type === 'pitch');
      const ratio = stage?.type === 'pitch' ? stage.ratio : 1;
      const input = path.join(dir, 'sine.wav');
      writeFileSync(input, sineWav(3, 440));
      const out = path.join(dir, `pitch-${effect}.wav`);
      await tools.processTake(input, out, { offsetMs: 0, effect, durationMs: 3000 });
      const hz = zeroCrossingHz(readWav(out).samples, 1, 2.5);
      expect(Math.abs(hz - 440 * ratio) / (440 * ratio)).toBeLessThan(0.03);
    },
  );

  it('без эффекта высота тона не меняется', async () => {
    const input = path.join(dir, 'sine.wav');
    writeFileSync(input, sineWav(3, 440));
    const out = path.join(dir, 'pitch-none.wav');
    await tools.processTake(input, out, { offsetMs: 0, effect: 'none', durationMs: 3000 });
    expect(Math.abs(zeroCrossingHz(readWav(out).samples, 1, 2.5) - 440)).toBeLessThan(3);
  });

  it('окна реплик заглушают звук вне своих реплик', async () => {
    const out = path.join(dir, 'gated.wav');
    await tools.processTake(raw(), out, {
      offsetMs: 0,
      effect: 'none',
      durationMs: 4000,
      windows: [{ startMs: 1800, endMs: 2400 }],
    });
    const found = onsets(readWav(out).samples);
    expect(found).toHaveLength(1);
    expect(Math.abs(found[0]! - 2000)).toBeLessThan(3);
  });

  it('битый файл даёт понятную ошибку, а не падение', async () => {
    const broken = path.join(dir, 'broken.webm');
    writeFileSync(
      broken,
      Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(500, 7)]),
    );
    await expect(
      tools.processTake(broken, path.join(dir, 'x.wav'), {
        offsetMs: 0,
        effect: 'none',
        durationMs: 1000,
      }),
    ).rejects.toMatchObject({ code: 'PROCESSING_FAILED' });
    await expect(tools.probe(path.join(dir, 'missing.mp4'))).rejects.toMatchObject({
      code: 'UNSUPPORTED_MEDIA',
    });
  });

  it('конвейер: нормализация клипа, дубли, готовое видео со звуком', async () => {
    const storage = new LocalDiskAdapter(path.join(dir, 'storage'));
    const pipeline = createMediaPipeline(storage, tools);

    // Исходник: 3 секунды тестовой картинки со звуком нестандартного размера и частоты кадров
    const source = path.join(dir, 'source.mp4');
    await runFfmpeg((cmd) =>
      cmd
        .input('testsrc=duration=3:size=854x480:rate=25')
        .inputFormat('lavfi')
        .input('sine=frequency=330:duration=3')
        .inputFormat('lavfi')
        .outputOptions(['-c:v libx264', '-pix_fmt yuv444p', '-c:a aac', '-shortest'])
        .output(source),
    );
    const clip = path.join(dir, 'clip.mp4');
    await tools.normalizeVideo(source, clip, { music: 'keep', startMs: 500, endMs: 2500 });
    const info = await tools.probe(clip);
    expect(info).toMatchObject({
      hasVideo: true,
      hasAudio: true,
      videoCodec: 'h264',
      width: 854,
      height: 480,
    });
    expect(Math.abs(info.durationMs - 2000)).toBeLessThan(80);

    const silent = path.join(dir, 'silent.mp4');
    await tools.normalizeVideo(source, silent, { music: 'none' });
    expect((await tools.probe(silent)).hasAudio).toBe(false);

    const poster = path.join(dir, 'poster.jpg');
    await tools.poster(clip, poster, 500);
    expect(readFileSync(poster).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));

    await storage.putFile('packs/p/c/video-1.mp4', clip);
    await storage.putFile('rooms/ABCD/r0/takes/a-1.wav', raw());
    await storage.putFile('rooms/ABCD/r0/takes/b-1.wav', raw());
    for (const who of ['a', 'b']) {
      await pipeline.processTake({
        rawKey: `rooms/ABCD/r0/takes/${who}-1.wav`,
        outKey: `rooms/ABCD/r0/takes/${who}-1.voice.wav`,
        offsetMs: who === 'a' ? 0 : 200,
        effect: who === 'a' ? 'none' : 'robot',
        durationMs: info.durationMs,
      });
    }
    await pipeline.buildReview({
      videoKey: 'packs/p/c/video-1.mp4',
      hasMusic: true,
      voiceKeys: ['rooms/ABCD/r0/takes/a-1.voice.wav', 'rooms/ABCD/r0/takes/b-1.voice.wav'],
      outKey: 'rooms/ABCD/r0/entries/e1.mp4',
      durationMs: info.durationMs,
    });
    const review = await storage.toLocalFile('rooms/ABCD/r0/entries/e1.mp4');
    const result = await tools.probe(review.path);
    expect(result).toMatchObject({
      hasVideo: true,
      hasAudio: true,
      videoCodec: 'h264',
      audioCodec: 'aac',
    });
    expect(Math.abs(result.durationMs - info.durationMs)).toBeLessThan(80);
  });
});
