/**
 * Снимает скриншоты и короткую демо-запись для README: проводит настоящую игру на трёх
 * игроков в безголовом Chromium с фейковым микрофоном.
 *
 *   pnpm build && pnpm start      # в одном терминале (или docker compose up)
 *   pnpm screenshots              # в другом; BASE_URL=http://localhost:3001 по умолчанию
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:3001';
const OUT = path.resolve('docs/screenshots');
const TMP = path.resolve('.e2e-data/demo-video');
fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(TMP, { recursive: true, force: true });

const browser = await chromium.launch({
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

async function player(
  name,
  { theme = 'dark', viewport = { width: 1280, height: 800 }, record = false } = {},
) {
  const context = await browser.newContext({
    baseURL: BASE,
    locale: 'ru-RU',
    viewport,
    deviceScaleFactor: viewport.width < 600 ? 2 : 1,
    permissions: ['microphone'],
    ...(record ? { recordVideo: { dir: TMP, size: viewport } } : {}),
  });
  await context.addInitScript(
    ([themeName, nickname]) => {
      if (!localStorage.getItem('dubparty:prefs')) {
        localStorage.setItem(
          'dubparty:prefs',
          JSON.stringify({
            state: { onboarded: true, theme: themeName, sfx: false, nickname, lang: 'ru' },
            version: 1,
          }),
        );
      }
    },
    [theme, name],
  );
  return { name, context, page: await context.newPage() };
}

const shot = (page, file) => page.screenshot({ path: path.join(OUT, `${file}.png`) });
const button = (page, name) => page.getByRole('button', { name });

const host = await player('Аня', { record: true });
const guest = await player('Боря');
const phone = await player('Вера', { theme: 'light', viewport: { width: 390, height: 844 } });
const everyone = [host, guest, phone];

// Главная и «Как играть»
await host.page.goto('/');
await shot(host.page, '01-home');

// Лобби
await button(host.page, 'Создать комнату').click();
await host.page.waitForURL(/\/r\/[A-Z]{4}$/);
const code = host.page.url().slice(-4);
for (const p of [guest, phone]) {
  await p.page.goto(`/r/${code}`);
  await button(p.page, 'Войти в комнату').click();
  await p.page.getByRole('heading', { name: 'Игроки' }).waitFor();
}
const rounds = host.page.getByLabel('Раундов');
await rounds.focus();
await rounds.press('Home');
await host.page.waitForTimeout(600);
await shot(host.page, '02-lobby');
await shot(phone.page, '02-lobby-mobile');

// Запись
await button(host.page, 'Начать игру').click();
await host.page.getByText('Раунд 1 из 1').first().waitFor();
await host.page.waitForTimeout(800);
await shot(host.page, '03-intro');
for (const p of everyone) await button(p.page, 'Записать дубль').waitFor({ timeout: 30_000 });
await Promise.all(everyone.map((p) => button(p.page, 'Записать дубль').click()));
await button(host.page, 'Остановить').waitFor();
await host.page.waitForTimeout(3200);
await shot(host.page, '04-recording');
await shot(phone.page, '04-recording-mobile');
await host.page.waitForTimeout(2000);
await Promise.all(everyone.map((p) => button(p.page, 'Остановить').click()));
await button(host.page, 'Отправить дубль').waitFor();
await host.page.getByRole('radio', { name: 'Робот' }).click();
await host.page.waitForTimeout(1500);
await shot(host.page, '05-review');
for (const p of everyone) await button(p.page, 'Отправить дубль').click();

// Общий просмотр
await host.page.getByText('Озвучка 1 из 3').waitFor({ timeout: 60_000 });
await host.page.waitForTimeout(6000);
await shot(host.page, '06-playback');
await shot(phone.page, '06-playback-mobile');
await button(host.page, 'Следующая').click();
await host.page.waitForTimeout(4500);
await button(host.page, 'Сразу к голосованию').click();

// Голосование
for (const p of everyone) await p.page.getByRole('heading', { name: 'Голосование' }).waitFor();
const vote = async (page, category, nth = 0) =>
  page
    .getByRole('radiogroup', { name: category })
    .getByRole('radio', { disabled: false })
    .nth(nth)
    .click();
await vote(host.page, 'Самый смешной');
await host.page.waitForTimeout(400);
await shot(host.page, '07-voting');
await shot(phone.page, '07-voting-mobile');
await vote(host.page, 'Лучшая актёрская игра', 1);
for (const p of [guest, phone]) {
  await vote(p.page, 'Самый смешной');
  await vote(p.page, 'Лучшая актёрская игра');
}

// Итоги и финал
await host.page.getByRole('heading', { name: 'Итоги раунда' }).waitFor();
await host.page.waitForTimeout(2600);
await shot(host.page, '08-results');
await button(host.page, 'К итогам игры').click();
await host.page.getByRole('heading', { name: 'Игра окончена!' }).waitFor();
await host.page.waitForTimeout(1800);
await shot(host.page, '09-final');
await shot(phone.page, '09-final-mobile');

// Редактор паков (встроенный пак, только просмотр) и светлая тема
const editor = await player('Редактор', { theme: 'light' });
await editor.page.goto('/packs/demo');
await editor.page.getByRole('heading', { name: 'Демо-пак' }).waitFor();
await editor.page.waitForTimeout(1200);
await shot(editor.page, '10-pack-editor');

const video = host.page.video();
await Promise.all([...everyone, editor].map((p) => p.context.close()));
await browser.close();

// Демо-запись экрана хоста → GIF (палитра в два прохода, чтобы цвета не «сыпались»).
if (video) {
  const require = createRequire(path.resolve('apps/server/package.json'));
  const ffmpeg = process.env.FFMPEG_PATH ?? require('ffmpeg-static');
  const source = await video.path();
  const gif = path.resolve('docs/demo.gif');
  const filter =
    'fps=8,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4';
  const result = spawnSync(
    ffmpeg,
    ['-y', '-loglevel', 'error', '-ss', '6', '-t', '50', '-i', source, '-vf', filter, gif],
    {
      stdio: 'inherit',
    },
  );
  if (result.status === 0)
    console.log(`demo: ${gif} (${Math.round(fs.statSync(gif).size / 1024)} КБ)`);
  fs.rmSync(TMP, { recursive: true, force: true });
}
console.log(`screenshots: ${OUT}`);
