/**
 * Сдвиг высоты тона без изменения длительности: две головки чтения бегут по кольцевому
 * буферу с переменной задержкой и плавно сменяют друг друга (окно Ханна), когда задержка
 * перескакивает. Скорость чтения равна ratio, поэтому тон меняется, а темп — нет.
 */
class PitchShifter extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.ratio = typeof opts.ratio === 'number' ? opts.ratio : 1;
    this.window = Math.round(sampleRate * 0.05);
    this.size = 1;
    while (this.size < this.window * 2 + 256) this.size *= 2;
    this.buffer = new Float32Array(this.size);
    this.write = 0;
    this.phase = 0;
  }

  read(delay) {
    const pos = this.write - delay;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const mask = this.size - 1;
    const a = this.buffer[i0 & mask];
    const b = this.buffer[(i0 + 1) & mask];
    return a + (b - a) * frac;
  }

  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0];
    const output = outputs[0] && outputs[0][0];
    if (!output) return true;
    const step = (1 - this.ratio) / this.window;
    const mask = this.size - 1;
    for (let i = 0; i < output.length; i++) {
      this.buffer[this.write & mask] = input ? input[i] : 0;
      const p1 = this.phase;
      const p2 = p1 >= 0.5 ? p1 - 0.5 : p1 + 0.5;
      const g1 = 0.5 - 0.5 * Math.cos(2 * Math.PI * p1);
      // +1 сэмпл: головка никогда не обгоняет запись.
      output[i] = g1 * this.read(1 + p1 * this.window) + (1 - g1) * this.read(1 + p2 * this.window);
      this.phase += step;
      if (this.phase >= 1) this.phase -= 1;
      else if (this.phase < 0) this.phase += 1;
      this.write++;
    }
    for (let ch = 1; ch < outputs[0].length; ch++) outputs[0][ch].set(output);
    return true;
  }
}

registerProcessor('pitch-shifter', PitchShifter);
