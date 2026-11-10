import { expect, test, type Page } from '@playwright/test';
import { createRoom, joinRoom, newPlayer } from './helpers';

async function quickTake(page: Page) {
  await page.getByRole('button', { name: 'Записать дубль' }).click();
  await expect(page.getByRole('button', { name: 'Остановить' })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Остановить' }).click();
  await page.getByRole('button', { name: 'Отправить дубль' }).click();
}

test('режим «Роли»: роли распределены, одна общая озвучка, голосуют за участников', async ({
  browser,
}) => {
  const host = await newPlayer(browser, 'Аня');
  const guest = await newPlayer(browser, 'Боря');
  const pages = [host.page, guest.page];
  const code = await createRoom(host);
  await joinRoom(guest, code);

  await host.page.getByRole('radio', { name: /Роли/ }).click();
  const rounds = host.page.getByLabel('Раундов');
  await rounds.focus();
  await rounds.press('Home');
  await host.page.getByRole('button', { name: 'Начать игру' }).click();

  // Каждому назначена роль, и это видно ещё на заставке
  for (const page of pages) await expect(page.getByText(/Вы играете: /).first()).toBeVisible();
  const roles = await Promise.all(
    pages.map((page) =>
      page
        .getByText(/Вы играете: /)
        .first()
        .textContent(),
    ),
  );
  expect(new Set(roles).size, 'у игроков разные роли').toBe(2);

  for (const page of pages) {
    await expect(page.getByRole('button', { name: 'Записать дубль' })).toBeEnabled({
      timeout: 30_000,
    });
    // Свои реплики помечены, чужие — нет
    await expect(page.getByText('· ваша реплика').first()).toBeVisible();
  }
  await Promise.all(pages.map(quickTake));

  // Два игрока — одна труппа — одна общая запись с двумя авторами
  for (const page of pages) {
    await expect(page.getByText('Озвучка 1 из 1')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Аня');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Боря');
  }
  await host.page.getByRole('button', { name: 'К голосованию' }).click();

  // Запись одна, поэтому выбирают участника: двое в списке, сам недоступен
  for (const page of pages) {
    const group = page.getByRole('radiogroup', { name: 'Лучшая актёрская игра' });
    await expect(group.getByRole('radio')).toHaveCount(2);
    await expect(group.getByRole('radio', { disabled: true })).toHaveCount(1);
    await group.getByRole('radio', { disabled: false }).click();
    await page
      .getByRole('radiogroup', { name: 'Самый смешной' })
      .getByRole('radio', { disabled: false })
      .click();
  }
  for (const page of pages) {
    await expect(page.getByRole('heading', { name: 'Итоги раунда' })).toBeVisible();
  }
  await host.context.close();
  await guest.context.close();
});

test('режим «Свободно»: подсказок с репликами нет', async ({ browser }) => {
  const host = await newPlayer(browser, 'Аня');
  const guest = await newPlayer(browser, 'Боря');
  const code = await createRoom(host);
  await joinRoom(guest, code);

  await host.page.getByRole('radio', { name: /Свободно/ }).click();
  await host.page.getByRole('button', { name: 'Начать игру' }).click();
  for (const page of [host.page, guest.page]) {
    await expect(page.getByRole('button', { name: 'Записать дубль' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('Подсказок нет — импровизируйте!')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Реплики' })).toHaveCount(0);
  }
  await host.context.close();
  await guest.context.close();
});
