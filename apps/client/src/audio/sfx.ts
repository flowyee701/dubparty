import { usePrefs } from '../store/prefs';

export type Sfx =
  'click' | 'join' | 'leave' | 'tick' | 'go' | 'success' | 'error' | 'vote' | 'fanfare';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return ctx;
}

type Note = [freq: number, startMs: number, durMs: number, type?: OscillatorType, gain?: number];

const SOUNDS: Record<Sfx, Note[]> = {
  click: [[660, 0, 50, 'triangle', 0.12]],
  join: [
    [523, 0, 90],
    [784, 90, 140],
  ],
  leave: [
    [523, 0, 90],
    [349, 90, 140],
  ],
  tick: [[880, 0, 70, 'square', 0.08]],
  go: [[1320, 0, 260, 'square', 0.1]],
  success: [
    [659, 0, 90],
    [880, 90, 90],
    [1319, 180, 180],
  ],
  error: [
    [220, 0, 140, 'sawtooth', 0.1],
    [185, 140, 200, 'sawtooth', 0.1],
  ],
  vote: [
    [740, 0, 60, 'triangle'],
    [988, 60, 110, 'triangle'],
  ],
  fanfare: [
    [523, 0, 130],
    [659, 130, 130],
    [784, 260, 130],
    [1047, 390, 380],
    [784, 390, 380, 'triangle', 0.1],
  ],
};

/** Короткие звуки интерфейса, синтезируются на лету — без аудиофайлов. */
export function playSfx(name: Sfx): void {
  if (!usePrefs.getState().sfx) return;
  const ac = audio();
  if (!ac || ac.state !== 'running') return;
  const now = ac.currentTime;
  for (const [freq, startMs, durMs, type = 'sine', gain = 0.15] of SOUNDS[name]) {
    const osc = ac.createOscillator();
    const amp = ac.createGain();
    const t0 = now + startMs / 1000;
    const t1 = t0 + durMs / 1000;
    osc.type = type;
    osc.frequency.value = freq;
    amp.gain.setValueAtTime(0, t0);
    amp.gain.linearRampToValueAtTime(gain, t0 + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, t1);
    osc.connect(amp).connect(ac.destination);
    osc.start(t0);
    osc.stop(t1 + 0.02);
  }
}

/** Вызывается при первом жесте пользователя: браузеры не дают звук без него. */
export function unlockAudio(): void {
  audio();
}
