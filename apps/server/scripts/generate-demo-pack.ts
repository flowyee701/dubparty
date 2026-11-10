/**
 * Генератор встроенных паков. Рисует простые анимации на canvas, собирает их в видео
 * через ffmpeg и синтезирует музыку. Всё создаётся с нуля, поэтому результат можно
 * свободно распространять (CC0).
 *
 *   pnpm demo:generate
 */
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { packManifestSchema, type PackManifest } from '@dubparty/shared';
import { resolveFfmpegPaths } from '../src/media/ffmpeg';

const W = 640;
const H = 360;
const FPS = 30;
const SR = 48_000;
const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets');
const FFMPEG = resolveFfmpegPaths({
  FFMPEG_PATH: process.env.FFMPEG_PATH,
  FFPROBE_PATH: process.env.FFPROBE_PATH,
}).ffmpeg;

type Shape = 'robot' | 'blob' | 'cat' | 'dog' | 'alien' | 'cloud';

interface Actor {
  id: string;
  name: string;
  color: string;
  shape: Shape;
  x: number;
  y: number;
  scale?: number;
}

interface Line {
  who: string;
  start: number;
  end: number;
  text: string;
}

type Scenery = 'lab' | 'studio' | 'yard' | 'space' | 'test';

interface Scene {
  id: string;
  title: string;
  duration: number;
  scenery: Scenery;
  actors: Actor[];
  lines: Line[];
  music?: { root: number; bpm: number };
  /** Калибровочный клип: вспышки и щелчки в эти моменты (секунды). */
  beeps?: number[];
}

// ── Рисование ─────────────────────────────────────────────────────────────

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => {
    const v = (n >> shift) & 0xff;
    return Math.round(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount);
  };
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

/** Псевдослучайное число из целого — чтобы звёзды и моргания были одинаковыми от запуска к запуску. */
function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function drawScenery(ctx: SKRSContext2D, scenery: Scenery, t: number) {
  const gradient = ctx.createLinearGradient(0, 0, 0, H);
  const stops: Record<Scenery, [string, string]> = {
    lab: ['#1e293b', '#334155'],
    studio: ['#7dd3fc', '#e0f2fe'],
    yard: ['#fde68a', '#fca5a5'],
    space: ['#0b1026', '#1e1b4b'],
    test: ['#111827', '#1f2937'],
  };
  gradient.addColorStop(0, stops[scenery][0]);
  gradient.addColorStop(1, stops[scenery][1]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);

  if (scenery === 'space') {
    for (let i = 0; i < 70; i++) {
      const twinkle = 0.5 + 0.5 * Math.sin(t * 2 + i);
      ctx.fillStyle = `rgba(255,255,255,${0.3 + 0.6 * twinkle * hash(i + 9)})`;
      const size = 1 + hash(i + 3) * 2;
      ctx.fillRect(hash(i) * W, hash(i + 100) * H * 0.8, size, size);
    }
    // Планета за иллюминатором
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(540 + Math.sin(t * 0.2) * 6, 70, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fde68a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(540 + Math.sin(t * 0.2) * 6, 70, 54, 12, -0.3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#312e81';
    ctx.fillRect(0, H - 60, W, 60);
    return;
  }
  if (scenery === 'studio') {
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(90, 80, 38 + Math.sin(t * 2) * 2, 0, Math.PI * 2);
    ctx.fill();
    for (const [cx, cy, speed] of [
      [420, 70, 12],
      [250, 110, 7],
    ] as const) {
      const x = ((cx + t * speed) % (W + 160)) - 80;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      for (const [dx, dy, r] of [
        [0, 0, 26],
        [28, 6, 20],
        [-26, 8, 18],
      ] as const) {
        ctx.beginPath();
        ctx.arc(x + dx, cy + dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = '#0ea5e9';
    ctx.fillRect(0, H - 70, W, 70);
    return;
  }
  if (scenery === 'yard') {
    ctx.fillStyle = '#65a30d';
    ctx.fillRect(0, H - 80, W, 80);
    ctx.fillStyle = '#92400e';
    for (let x = 10; x < W; x += 46) {
      roundRect(ctx, x, H - 150, 34, 90, 6);
      ctx.fill();
    }
    return;
  }
  if (scenery === 'lab') {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, H - 70, W, 70);
    for (let i = 0; i < 8; i++) {
      const on = Math.sin(t * 3 + i * 1.7) > 0.2;
      ctx.fillStyle = on ? '#22d3ee' : '#155e75';
      ctx.fillRect(40 + i * 74, 40, 30, 10);
    }
    return;
  }
  ctx.fillStyle = '#0b0f19';
  ctx.fillRect(0, H - 60, W, 60);
}

function drawActor(ctx: SKRSContext2D, actor: Actor, t: number, speaking: boolean, seed: number) {
  const s = actor.scale ?? 1;
  // Говорящий подпрыгивает, остальные слегка покачиваются.
  const bob = speaking ? Math.abs(Math.sin(t * 9 + seed)) * -8 : Math.sin(t * 1.6 + seed) * 3;
  const mouth = speaking
    ? 0.25 + 0.75 * Math.abs(Math.sin(t * 11 + seed) * Math.sin(t * 3.7 + seed))
    : 0;
  const blink = (t * 0.6 + seed * 0.37) % 1 < 0.045;

  ctx.save();
  ctx.translate(actor.x, actor.y + bob);
  ctx.scale(s, s);

  // Тень
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(0, 78 - bob / s, 52, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  const body = actor.color;
  const dark = shade(body, -0.35);
  ctx.fillStyle = body;
  ctx.strokeStyle = dark;
  ctx.lineWidth = 5;

  switch (actor.shape) {
    case 'robot':
      ctx.beginPath();
      ctx.moveTo(0, -78);
      ctx.lineTo(0, -98);
      ctx.stroke();
      ctx.fillStyle = speaking ? '#fef08a' : dark;
      ctx.beginPath();
      ctx.arc(0, -102, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = body;
      roundRect(ctx, -58, -78, 116, 150, 20);
      ctx.fill();
      ctx.stroke();
      break;
    case 'cat':
    case 'dog': {
      ctx.beginPath();
      if (actor.shape === 'cat') {
        ctx.moveTo(-50, -52);
        ctx.lineTo(-40, -100);
        ctx.lineTo(-12, -66);
        ctx.moveTo(50, -52);
        ctx.lineTo(40, -100);
        ctx.lineTo(12, -66);
      } else {
        ctx.ellipse(-56, -30, 16, 40, 0.35, 0, Math.PI * 2);
        ctx.ellipse(56, -30, 16, 40, -0.35, 0, Math.PI * 2);
      }
      ctx.fillStyle = dark;
      ctx.fill();
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.ellipse(0, 0, 60, 72, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'alien':
      ctx.beginPath();
      ctx.moveTo(-26, -70);
      ctx.lineTo(-40, -104);
      ctx.moveTo(26, -70);
      ctx.lineTo(40, -104);
      ctx.stroke();
      ctx.fillStyle = body;
      for (const x of [-40, 40]) {
        ctx.beginPath();
        ctx.arc(x, -106, 7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.ellipse(0, -8, 66, 64, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    case 'cloud':
      for (const [dx, dy, r] of [
        [0, 0, 58],
        [-50, 18, 40],
        [50, 18, 40],
        [-26, -34, 36],
        [28, -30, 38],
      ] as const) {
        ctx.beginPath();
        ctx.arc(dx, dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    default:
      ctx.beginPath();
      ctx.ellipse(0, 0, 60, 74, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
  }

  // Глаза
  const eyeY = actor.shape === 'robot' ? -28 : -20;
  for (const x of [-24, 24]) {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(15,23,42,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, eyeY, 15, blink ? 2 : actor.shape === 'alien' ? 20 : 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (!blink) {
      ctx.fillStyle = '#111827';
      ctx.beginPath();
      ctx.arc(x + Math.sin(t * 0.9 + seed) * 4, eyeY + 2, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Рот: открывается, пока идёт реплика персонажа — под него и нужно попадать.
  ctx.fillStyle = '#1f2937';
  const mouthY = actor.shape === 'robot' ? 26 : 24;
  if (mouth > 0) {
    ctx.beginPath();
    ctx.ellipse(0, mouthY, 20, 4 + mouth * 17, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f87171';
    ctx.beginPath();
    ctx.ellipse(0, mouthY + mouth * 9, 11, mouth * 7, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, mouthY - 6, 16, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.stroke();
  }
  ctx.restore();

  // Подпись с именем — чтобы было понятно, кто есть кто в режиме ролей.
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  const label = actor.name;
  const width = ctx.measureText(label).width + 22;
  const ly = actor.y + 92 * s;
  ctx.fillStyle = speaking ? tagColor(actor.color) : 'rgba(0,0,0,0.55)';
  roundRect(ctx, actor.x - width / 2, ly, width, 28, 14);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, actor.x, ly + 20);
}

/** Белый персонаж на светлом фоне и в подсказках не читается — для подписей берём запасной цвет. */
function tagColor(color: string): string {
  return color === '#f8fafc' ? '#0ea5e9' : color;
}

function drawFrame(ctx: SKRSContext2D, scene: Scene, t: number) {
  drawScenery(ctx, scene.scenery, t);
  scene.actors.forEach((actor, i) => {
    const speaking = scene.lines.some((l) => l.who === actor.id && t >= l.start && t < l.end);
    drawActor(ctx, actor, t, speaking, i * 2.3 + 1);
  });

  if (scene.beeps) {
    // Вспышка на три кадра в момент щелчка и бегущая стрелка метронома.
    const flash = scene.beeps.some((b) => t >= b && t < b + 3 / FPS);
    if (flash) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.fillStyle = '#9ca3af';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${t.toFixed(2)} s`, 20, 34);
  }
}

// ── Звук ──────────────────────────────────────────────────────────────────

function wav(samples: Float32Array): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767), i * 2);
  }
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

/** Простая фоновая мелодия: бас и арпеджио по мажорной пентатонике. */
function synthMusic(duration: number, root: number, bpm: number): Float32Array {
  const out = new Float32Array(Math.round(duration * SR));
  const beat = 60 / bpm;
  const scale = [0, 2, 4, 7, 9, 12, 14, 16];
  const freq = (semi: number) => root * 2 ** (semi / 12);
  const add = (start: number, len: number, f: number, gain: number, square: boolean) => {
    const from = Math.round(start * SR);
    const count = Math.round(len * SR);
    for (let i = 0; i < count && from + i < out.length; i++) {
      const time = i / SR;
      const env = Math.min(1, time / 0.01) * Math.exp(-time / (len * 0.45));
      const phase = 2 * Math.PI * f * time;
      const wave = square
        ? Math.sign(Math.sin(phase)) * 0.5 + Math.sin(phase) * 0.5
        : Math.sin(phase);
      out[from + i]! += wave * env * gain;
    }
  };
  const steps = Math.ceil(duration / (beat / 2));
  for (let step = 0; step < steps; step++) {
    const time = step * (beat / 2);
    const bar = Math.floor(step / 8);
    const chord = [0, 5, 7, 0][bar % 4]!;
    if (step % 4 === 0) add(time, beat * 1.6, freq(chord - 12), 0.22, false);
    const note = scale[(step * 3 + bar * 2) % scale.length]! + chord;
    add(time, beat * 0.45, freq(note), 0.09, true);
  }
  // Плавное затухание в конце
  const fade = Math.round(0.6 * SR);
  for (let i = 0; i < fade; i++) out[out.length - 1 - i]! *= i / fade;
  return out;
}

function synthBeeps(duration: number, beeps: number[]): Float32Array {
  const out = new Float32Array(Math.round(duration * SR));
  for (const at of beeps) {
    const from = Math.round(at * SR);
    const count = Math.round(0.06 * SR);
    for (let i = 0; i < count && from + i < out.length; i++) {
      // Резкий фронт — по нему тест синхронизации находит момент щелчка.
      const env = i < 24 ? i / 24 : Math.exp(-(i - 24) / (count * 0.35));
      out[from + i] = Math.sin((2 * Math.PI * 1000 * i) / SR) * env * 0.8;
    }
  }
  return out;
}

// ── ffmpeg ────────────────────────────────────────────────────────────────

function ffmpeg(
  args: string[],
  feed?: (stdin: NodeJS.WritableStream) => Promise<void>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      stdio: [feed ? 'pipe' : 'ignore', 'inherit', 'inherit'],
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`)),
    );
    if (feed && child.stdin) {
      child.stdin.on('error', reject);
      feed(child.stdin).then(() => child.stdin?.end(), reject);
    }
  });
}

async function renderVideo(scene: Scene, file: string) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const frames = Math.round(scene.duration * FPS);
  await ffmpeg(
    [
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgba',
      '-s',
      `${W}x${H}`,
      '-r',
      String(FPS),
      '-i',
      'pipe:0',
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '24',
      '-pix_fmt',
      'yuv420p',
      '-g',
      String(FPS),
      '-movflags',
      '+faststart',
      '-an',
      file,
    ],
    async (stdin) => {
      for (let i = 0; i < frames; i++) {
        drawFrame(ctx, scene, i / FPS);
        const pixels = Buffer.from(ctx.getImageData(0, 0, W, H).data.buffer);
        if (!stdin.write(pixels)) await new Promise((r) => stdin.once('drain', r));
      }
    },
  );
}

async function renderMusic(samples: Float32Array, file: string) {
  await ffmpeg(
    ['-f', 'wav', '-i', 'pipe:0', '-c:a', 'aac', '-b:a', '128k', file],
    async (stdin) => {
      stdin.write(wav(samples));
    },
  );
}

// ── Сцены ─────────────────────────────────────────────────────────────────

const DEMO: Scene[] = [
  {
    id: 'robots',
    title: 'Спор роботов',
    duration: 14,
    scenery: 'lab',
    music: { root: 220, bpm: 112 },
    actors: [
      { id: 'beep', name: 'Бип', color: '#f59e0b', shape: 'robot', x: 190, y: 190 },
      { id: 'boop', name: 'Буп', color: '#14b8a6', shape: 'robot', x: 450, y: 190 },
    ],
    lines: [
      { who: 'beep', start: 1.0, end: 3.2, text: 'Буп, ты опять съел все батарейки?' },
      { who: 'boop', start: 3.7, end: 5.8, text: 'Я их не ел. Я их… заряжал.' },
      { who: 'beep', start: 6.2, end: 7.2, text: 'Ртом?!' },
      { who: 'boop', start: 7.6, end: 9.8, text: 'У каждого свой метод.' },
      { who: 'beep', start: 10.3, end: 12.8, text: 'Всё, я звоню пылесосу.' },
    ],
  },
  {
    id: 'weather',
    title: 'Прогноз погоды',
    duration: 13,
    scenery: 'studio',
    actors: [{ id: 'cloud', name: 'Тучка', color: '#f8fafc', shape: 'cloud', x: 320, y: 190 }],
    lines: [
      { who: 'cloud', start: 0.8, end: 3.0, text: 'Добрый вечер! С вами прогноз погоды.' },
      { who: 'cloud', start: 3.5, end: 6.0, text: 'Завтра ожидается дождь. Из меня.' },
      { who: 'cloud', start: 6.6, end: 9.0, text: 'Послезавтра — тоже я. Простите.' },
      { who: 'cloud', start: 9.6, end: 12.0, text: 'Зонтики продаются в фойе.' },
    ],
  },
  {
    id: 'catdog',
    title: 'Кот и пёс',
    duration: 15,
    scenery: 'yard',
    actors: [
      { id: 'cat', name: 'Кот', color: '#fb923c', shape: 'cat', x: 180, y: 195 },
      { id: 'dog', name: 'Пёс', color: '#a16207', shape: 'dog', x: 460, y: 195 },
    ],
    lines: [
      { who: 'dog', start: 0.8, end: 3.0, text: 'Слушай, а зачем ты скинул вазу?' },
      { who: 'cat', start: 3.5, end: 5.4, text: 'Она на меня смотрела.' },
      { who: 'dog', start: 5.9, end: 7.6, text: 'У вазы нет глаз.' },
      { who: 'cat', start: 8.1, end: 10.4, text: 'Теперь точно нет.' },
      { who: 'dog', start: 10.9, end: 13.6, text: 'Хозяин идёт. Скажем, что это был хомяк.' },
    ],
  },
  {
    id: 'space',
    title: 'Связь с Землёй',
    duration: 16,
    scenery: 'space',
    music: { root: 164.81, bpm: 96 },
    actors: [
      {
        id: 'captain',
        name: 'Капитан',
        color: '#3b82f6',
        shape: 'blob',
        x: 130,
        y: 190,
        scale: 0.9,
      },
      {
        id: 'navigator',
        name: 'Штурман',
        color: '#ec4899',
        shape: 'blob',
        x: 320,
        y: 200,
        scale: 0.9,
      },
      {
        id: 'alien',
        name: 'Пришелец',
        color: '#84cc16',
        shape: 'alien',
        x: 510,
        y: 190,
        scale: 0.9,
      },
    ],
    lines: [
      { who: 'captain', start: 0.8, end: 3.0, text: 'Земля, приём! У нас гость на борту.' },
      { who: 'navigator', start: 3.4, end: 5.4, text: 'Капитан, он съел карту.' },
      { who: 'alien', start: 5.9, end: 7.9, text: 'Было вкусно. Есть ещё?' },
      { who: 'captain', start: 8.4, end: 10.4, text: 'Это была единственная карта!' },
      { who: 'alien', start: 10.9, end: 13.0, text: 'Не волнуйтесь, я знаю дорогу.' },
      { who: 'navigator', start: 13.4, end: 15.2, text: 'Он показывает на холодильник.' },
    ],
  },
];

const CALIBRATION: Scene[] = [
  {
    id: 'beeps',
    title: 'Калибровка синхронизации',
    duration: 8,
    scenery: 'test',
    beeps: [1.0, 2.0, 3.5, 5.0, 6.5],
    actors: [{ id: 'm', name: 'Метроном', color: '#6366f1', shape: 'blob', x: 320, y: 190 }],
    lines: [1.0, 2.0, 3.5, 5.0, 6.5].map((at) => ({
      who: 'm',
      start: at,
      end: at + 0.4,
      text: 'Тик',
    })),
  },
];

async function buildPack(
  dirName: string,
  meta: Pick<PackManifest, 'id' | 'title' | 'description'>,
  scenes: Scene[],
) {
  const dir = path.join(ASSETS, dirName);
  await rm(dir, { recursive: true, force: true });
  const manifest: PackManifest = {
    formatVersion: 1,
    ...meta,
    author: 'DubParty',
    language: 'ru',
    license: 'CC0-1.0',
    clips: [],
  };
  for (const scene of scenes) {
    const base = `clips/${scene.id}`;
    await mkdir(path.join(dir, base), { recursive: true });
    console.log(`  ${scene.id}: ${scene.duration} s`);
    await renderVideo(scene, path.join(dir, base, 'video.mp4'));
    const audio = scene.beeps
      ? synthBeeps(scene.duration, scene.beeps)
      : scene.music
        ? synthMusic(scene.duration, scene.music.root, scene.music.bpm)
        : null;
    if (audio) await renderMusic(audio, path.join(dir, base, 'music.m4a'));
    manifest.clips.push({
      id: scene.id,
      title: scene.title,
      video: `${base}/video.mp4`,
      ...(audio ? { music: `${base}/music.m4a` } : {}),
      durationMs: scene.duration * 1000,
      characters: scene.actors.map((a) => ({
        id: a.id,
        name: a.name,
        color: tagColor(a.color),
      })),
      lines: scene.lines.map((l, i) => ({
        id: `l${i + 1}`,
        characterId: l.who,
        startMs: Math.round(l.start * 1000),
        endMs: Math.round(l.end * 1000),
        text: l.text,
      })),
      attribution: 'Сгенерировано для DubParty, CC0',
    });
  }
  // Проверяем по той же схеме, по которой пак будет читаться.
  packManifestSchema.parse(manifest);
  await writeFile(path.join(dir, 'pack.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

console.log('Демо-пак');
await buildPack(
  'demo-pack',
  {
    id: 'demo',
    title: 'Демо-пак',
    description: 'Четыре коротких анимации, нарисованные специально для DubParty.',
  },
  DEMO,
);
console.log('Калибровочный пак');
await buildPack(
  'calibration-pack',
  {
    id: 'calibration',
    title: 'Калибровка',
    description: 'Служебный клип со щелчками для проверки синхронизации.',
  },
  CALIBRATION,
);
console.log('Готово:', ASSETS);
