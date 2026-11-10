import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
}

/** Открывает отдельный контекст браузера — как отдельное устройство игрока. */
export async function newPlayer(browser: Browser, name: string): Promise<Player> {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (err) => console.error(`[${name}] page error:`, err.message));
  return { name, context, page };
}

export async function createRoom(player: Player): Promise<string> {
  const { page, name } = player;
  await page.goto('/');
  await page.getByLabel('Ник').fill(name);
  await page.getByRole('button', { name: 'Создать комнату' }).click();
  await expect(page).toHaveURL(/\/r\/[A-Z]{4}$/);
  const code = page.url().slice(-4);
  await expect(page.getByRole('heading', { name: 'Игроки' })).toBeVisible();
  return code;
}

export async function joinRoom(player: Player, code: string): Promise<void> {
  const { page, name } = player;
  await page.goto(`/r/${code}`);
  await page.getByLabel('Ник').fill(name);
  await page.getByRole('button', { name: 'Войти в комнату' }).click();
  await expect(page.getByRole('heading', { name: 'Игроки' })).toBeVisible();
}

export function playersList(page: Page) {
  return page.getByRole('region', { name: 'Игроки' }).getByRole('listitem');
}

/**
 * Подменяет микрофон «петлёй»: в запись идёт звук самого клипа. Так тест синхронизации
 * точно знает, в какие моменты видео в записи должны оказаться щелчки.
 */
export async function useLoopbackMic(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const AC: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    let ctx: AudioContext | null = null;
    let dest: MediaStreamAudioDestinationNode | null = null;
    const hooked = new WeakSet<HTMLVideoElement>();
    const hook = () => {
      if (!ctx || !dest) return;
      if (ctx.state !== 'running') void ctx.resume();
      for (const video of Array.from(document.querySelectorAll('video'))) {
        if (hooked.has(video)) continue;
        hooked.add(video);
        const source = ctx.createMediaElementSource(video);
        source.connect(dest);
        source.connect(ctx.destination);
      }
    };
    // Методы лежат на прототипе: в WebKit присваивание в сам объект не срабатывает.
    const define = (name: string, value: unknown) =>
      Object.defineProperty(MediaDevices.prototype, name, {
        configurable: true,
        writable: true,
        value,
      });
    define('getUserMedia', async () => {
      ctx ??= new AC();
      dest ??= ctx.createMediaStreamDestination();
      hook();
      window.setInterval(hook, 50);
      return dest.stream;
    });
    define('enumerateDevices', async () => [
      {
        deviceId: 'loopback',
        groupId: 'e2e',
        kind: 'audioinput',
        label: 'Loopback',
        toJSON: () => ({}),
      },
    ]);
    // Safari запускает AudioContext только из обработчика жеста.
    document.addEventListener('pointerdown', () => void ctx?.resume(), true);
  });
}

/**
 * Подменяет микрофон генератором тона — для браузеров без флага фейкового устройства (WebKit).
 */
export async function useToneMic(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const AC: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    let ctx: AudioContext | null = null;
    let dest: MediaStreamAudioDestinationNode | null = null;
    const define = (name: string, value: unknown) =>
      Object.defineProperty(MediaDevices.prototype, name, {
        configurable: true,
        writable: true,
        value,
      });
    document.addEventListener('pointerdown', () => void ctx?.resume(), true);
    define('getUserMedia', async () => {
      if (!ctx || !dest) {
        ctx = new AC();
        dest = ctx.createMediaStreamDestination();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 440;
        gain.gain.value = 0.3;
        osc.connect(gain).connect(dest);
        osc.start();
      }
      if (ctx.state !== 'running') void ctx.resume();
      return dest.stream;
    });
    define('enumerateDevices', async () => [
      {
        deviceId: 'tone',
        groupId: 'e2e',
        kind: 'audioinput',
        label: 'Tone generator',
        toJSON: () => ({}),
      },
    ]);
  });
}
