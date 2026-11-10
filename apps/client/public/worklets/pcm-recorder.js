/**
 * Захват сырого PCM с микрофона. Запасной бэкенд записи для браузеров без MediaRecorder
 * и для случаев, когда нужен посэмпловый момент старта.
 */
class PcmRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.started = false;
    this.port.onmessage = (event) => {
      if (event.data === 'start') {
        this.recording = true;
        this.started = false;
      } else if (event.data === 'stop') {
        this.recording = false;
        this.port.postMessage({ type: 'stopped' });
      }
    };
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (this.recording && channel) {
      if (!this.started) {
        this.started = true;
        // Время контекста, которому соответствует первый записанный сэмпл.
        this.port.postMessage({ type: 'started', contextTime: currentFrame / sampleRate });
      }
      this.port.postMessage({ type: 'chunk', samples: channel.slice(0) });
    }
    return true;
  }
}

registerProcessor('pcm-recorder', PcmRecorder);
