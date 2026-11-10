import { dbToGain, EFFECTS, type EffectId, type EffectStage } from '@dubparty/shared';

export interface EffectChain {
  input: AudioNode;
  output: AudioNode;
  /** Запускает генераторы (тремоло, шум). Вызывать одновременно со стартом воспроизведения. */
  start(when?: number): void;
  dispose(): void;
}

/** Добротность фильтра Баттерворта в децибелах — как у фильтров ffmpeg по умолчанию. */
const BUTTERWORTH_Q_DB = 20 * Math.log10(Math.SQRT1_2);

let noiseBuffer: AudioBuffer | null = null;

function whiteNoise(ctx: BaseAudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buffer;
  return buffer;
}

function tanhCurve(): Float32Array<ArrayBuffer> {
  const n = 2049;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) curve[i] = Math.tanh((i / (n - 1)) * 2 - 1);
  return curve;
}

/**
 * Собирает граф Web Audio по тому же описанию эффекта, из которого сервер строит фильтры ffmpeg.
 * Для сдвига высоты тона нужен загруженный worklet (ensureWorklets).
 */
export function buildEffectChain(ctx: BaseAudioContext, effect: EffectId): EffectChain {
  const input = ctx.createGain();
  const sources: AudioScheduledSourceNode[] = [];
  const nodes: AudioNode[] = [input];
  let tail: AudioNode = input;

  const chain = (node: AudioNode) => {
    tail.connect(node);
    nodes.push(node);
    tail = node;
  };

  const apply = (stage: EffectStage) => {
    switch (stage.type) {
      case 'pitch':
        chain(
          new AudioWorkletNode(ctx, 'pitch-shifter', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
            processorOptions: { ratio: stage.ratio },
          }),
        );
        break;
      case 'highpass':
      case 'lowpass': {
        const filter = ctx.createBiquadFilter();
        filter.type = stage.type;
        filter.frequency.value = stage.freq;
        filter.Q.value = BUTTERWORTH_Q_DB;
        chain(filter);
        break;
      }
      case 'highshelf': {
        const filter = ctx.createBiquadFilter();
        filter.type = 'highshelf';
        filter.frequency.value = stage.freq;
        filter.gain.value = stage.gainDb;
        chain(filter);
        break;
      }
      case 'tremolo': {
        const amp = ctx.createGain();
        amp.gain.value = 1 - stage.depth / 2;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = stage.freq;
        const depth = ctx.createGain();
        depth.gain.value = stage.depth / 2;
        lfo.connect(depth).connect(amp.gain);
        sources.push(lfo);
        nodes.push(depth);
        chain(amp);
        break;
      }
      case 'taps': {
        const sum = ctx.createGain();
        sum.gain.value = stage.outGain;
        const dry = ctx.createGain();
        dry.gain.value = stage.inGain;
        tail.connect(dry).connect(sum);
        nodes.push(dry);
        for (const tap of stage.taps) {
          const delay = ctx.createDelay(Math.max(1, tap.delayMs / 1000 + 0.1));
          delay.delayTime.value = tap.delayMs / 1000;
          const gain = ctx.createGain();
          gain.gain.value = tap.gain;
          tail.connect(delay).connect(gain).connect(sum);
          nodes.push(delay, gain);
        }
        nodes.push(sum);
        tail = sum;
        break;
      }
      case 'drive': {
        const pre = ctx.createGain();
        pre.gain.value = dbToGain(stage.preGainDb);
        const shaper = ctx.createWaveShaper();
        shaper.curve = tanhCurve();
        shaper.oversample = '2x';
        chain(pre);
        chain(shaper);
        break;
      }
      case 'noise': {
        const sum = ctx.createGain();
        const noise = ctx.createBufferSource();
        noise.buffer = whiteNoise(ctx);
        noise.loop = true;
        const level = ctx.createGain();
        level.gain.value = stage.amplitude;
        noise.connect(level).connect(sum);
        sources.push(noise);
        nodes.push(level);
        chain(sum);
        break;
      }
      case 'gain': {
        const gain = ctx.createGain();
        gain.gain.value = dbToGain(stage.db);
        chain(gain);
        break;
      }
    }
  };

  for (const stage of EFFECTS[effect]) apply(stage);

  return {
    input,
    output: tail,
    start(when = 0) {
      for (const source of sources) source.start(when);
    },
    dispose() {
      for (const source of sources) {
        try {
          source.stop();
        } catch {
          // Генератор мог быть ещё не запущен.
        }
        source.disconnect();
      }
      for (const node of nodes) node.disconnect();
    },
  };
}

export function effectNeedsWorklet(effect: EffectId): boolean {
  return EFFECTS[effect].some((stage) => stage.type === 'pitch');
}
