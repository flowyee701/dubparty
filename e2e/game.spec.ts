import { expect, test, type Page } from '@playwright/test';
import { createRoom, joinRoom, newPlayer, type Player } from './helpers';

/** Записывает короткий дубль и отправляет его. */
async function recordAndSubmit(page: Page, effect?: string) {
  await page.getByRole('button', { name: 'Записать дубль' }).click();
  await expect(page.getByRole('button', { name: 'Остановить' })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3500);
  await page.getByRole('button', { name: 'Остановить' }).click();
  await expect(page.getByRole('button', { name: 'Отправить дубль' })).toBeVisible();
  if (effect) await page.getByRole('radio', { name: effect }).click();
  await page.getByRole('button', { name: 'Отправить дубль' }).click();
  // Сдавший последним подтверждения не увидит: как только сданы все дубли, раунд идёт дальше.
  await expect(
    page
      .getByRole('button', { name: 'Отправлено' })
      .or(page.getByText(/Собираем озвучки|Озвучка \d из/)),
  ).toBeVisible({ timeout: 30_000 });
}

/** Голосует в обеих категориях за первую чужую запись. */
async function voteForOthers(page: Page) {
  for (const category of ['Самый смешной', 'Лучшая актёрская игра']) {
    const group = page.getByRole('radiogroup', { name: category });
    await group.getByRole('radio', { disabled: false }).first().click();
  }
}

async function syncState(page: Page) {
  return page.evaluate(() => {
    const video = document.querySelector('video');
    return {
      drift: window.__dubparty?.sync?.driftMs ?? null,
      time: video?.currentTime ?? 0,
      paused: video?.paused ?? true,
    };
  });
}

test('полный игровой цикл на трёх игроков', async ({ browser }) => {
  const host = await newPlayer(browser, 'Аня');
  const guests = [await newPlayer(browser, 'Боря'), await newPlayer(browser, 'Вера')];
  const players: Player[] = [host, ...guests];
  const pages = players.map((p) => p.page);
  const all = <T>(fn: (page: Page, i: number) => Promise<T>) => Promise.all(pages.map(fn));

  // ── Лобби ──
  const code = await createRoom(host);
  for (const guest of guests) await joinRoom(guest, code);
  await expect(host.page.getByRole('region', { name: 'Игроки' }).getByRole('listitem')).toHaveCount(
    3,
  );

  const rounds = host.page.getByLabel('Раундов');
  await rounds.focus();
  await rounds.press('Home');
  await expect(guests[0]!.page.getByRole('region', { name: 'Настройки игры' })).toContainText(
    'Раундов1',
  );

  await expect(guests[0]!.page.getByRole('button', { name: 'Начать игру' })).toHaveCount(0);
  await host.page.getByRole('button', { name: 'Начать игру' }).click();

  // ── Интро и запись ──
  await all((page) => expect(page.getByText('Раунд 1 из 1').first()).toBeVisible());
  await all((page) =>
    expect(page.getByRole('button', { name: 'Записать дубль' })).toBeEnabled({ timeout: 30_000 }),
  );
  await all((page, i) => recordAndSubmit(page, i === 1 ? 'Робот' : undefined));

  // ── Общий просмотр ──
  await all((page) => expect(page.getByText('Озвучка 1 из 3')).toBeVisible({ timeout: 60_000 }));
  // Заставка, затем воспроизведение; даём плеерам пару секунд на синхронизацию.
  await host.page.waitForTimeout(5000);
  const playing = await all(syncState);
  for (const state of playing) {
    expect(state.paused, 'видео идёт у всех').toBe(false);
    expect(state.drift, 'отклонение от времени сервера измерено').not.toBeNull();
    expect(Math.abs(state.drift!), 'отклонение в пределах допуска').toBeLessThanOrEqual(150);
  }
  console.log(`[playback] отклонения: ${playing.map((s) => Math.round(s.drift!)).join(', ')} мс`);

  // Пауза хоста — пауза у всех, на одной позиции
  await expect(guests[0]!.page.getByRole('button', { name: 'Пауза' })).toHaveCount(0);
  await host.page.getByRole('button', { name: 'Пауза' }).click();
  await all((page) => expect(page.getByText('⏸ Пауза')).toBeVisible());
  await host.page.waitForTimeout(600);
  const paused = await all(syncState);
  for (const state of paused) expect(state.paused).toBe(true);
  const times = paused.map((s) => s.time);
  expect(Math.max(...times) - Math.min(...times)).toBeLessThanOrEqual(0.15);

  // Игрок обновляет страницу посреди просмотра и возвращается в ту же фазу
  await guests[1]!.page.reload();
  await expect(guests[1]!.page.getByText('Озвучка 1 из 3')).toBeVisible();

  await host.page.getByRole('button', { name: 'Продолжить' }).click();
  await host.page.getByRole('button', { name: 'Следующая' }).click();
  await all((page) => expect(page.getByText('Озвучка 2 из 3')).toBeVisible());
  await host.page.getByRole('button', { name: 'Следующая' }).click();
  await all((page) => expect(page.getByText('Озвучка 3 из 3')).toBeVisible());
  await host.page.getByRole('button', { name: 'К голосованию' }).click();

  // ── Голосование ──
  await all((page) => expect(page.getByRole('heading', { name: 'Голосование' })).toBeVisible());
  // За себя голосовать нельзя: одна из трёх записей недоступна
  await expect(
    host.page
      .getByRole('radiogroup', { name: 'Самый смешной' })
      .getByRole('radio', { disabled: true }),
  ).toHaveCount(1);
  await all(voteForOthers);

  // ── Итоги раунда ──
  await all((page) => expect(page.getByRole('heading', { name: 'Итоги раунда' })).toBeVisible());
  const board = host.page.getByRole('list', { name: 'Таблица лидеров' });
  await expect(board.getByRole('listitem')).toHaveCount(3);
  // Очки начислены: шесть голосов по 100 и бонусы
  await expect(board).toContainText(/[1-9]\d{2}/);

  // Скачивание своей озвучки и архива раунда
  const [mine] = await Promise.all([
    guests[0]!.page.waitForEvent('download'),
    guests[0]!.page.getByRole('button', { name: 'Моя озвучка' }).click(),
  ]);
  expect(mine.suggestedFilename()).toMatch(/\.mp4$/);
  const fs = await import('node:fs');
  expect(fs.statSync(await mine.path()).size).toBeGreaterThan(20_000);

  await expect(guests[0]!.page.getByRole('button', { name: /Все озвучки/ })).toHaveCount(0);
  const [zip] = await Promise.all([
    host.page.waitForEvent('download'),
    host.page.getByRole('button', { name: /Все озвучки/ }).click(),
  ]);
  expect(zip.suggestedFilename()).toMatch(/\.zip$/);
  expect(fs.statSync(await zip.path()).size).toBeGreaterThan(60_000);

  // ── Финал ──
  await host.page.getByRole('button', { name: 'К итогам игры' }).click();
  await all((page) => expect(page.getByRole('heading', { name: 'Игра окончена!' })).toBeVisible());
  await expect(host.page.getByRole('list', { name: 'Подиум' }).getByRole('listitem')).toHaveCount(
    3,
  );

  await host.page.getByRole('button', { name: 'Сыграть ещё раз' }).click();
  await all((page) => expect(page.getByRole('heading', { name: 'Игроки' })).toBeVisible());

  await Promise.all(players.map((p) => p.context.close()));
});
