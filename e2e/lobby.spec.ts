import { expect, test } from '@playwright/test';
import { createRoom, joinRoom, newPlayer, playersList } from './helpers';

test('лобби: вход по коду, настройки, переподключение, передача хоста, исключение', async ({
  browser,
}) => {
  const host = await newPlayer(browser, 'Хост');
  const guest = await newPlayer(browser, 'Гость');

  const code = await createRoom(host);
  await joinRoom(guest, code);

  // Оба видят двух игроков
  await expect(playersList(host.page)).toHaveCount(2);
  await expect(playersList(guest.page)).toHaveCount(2);
  await expect(playersList(guest.page).filter({ hasText: 'Хост' })).toContainText('👑');

  // Настройки меняет хост — гость видит их сразу
  await host.page.getByRole('radio', { name: /Роли/ }).click();
  await expect(guest.page.getByRole('region', { name: 'Настройки игры' })).toContainText('Роли');
  await expect(guest.page.getByRole('radio', { name: /Роли/ })).toHaveCount(0);

  // Режим стримера: код скрыт у всех
  await host.page.getByRole('switch', { name: 'Скрыть код комнаты' }).click();
  await expect(guest.page.getByText('Код скрыт')).toBeAttached();
  await expect(guest.page.getByText(code.split('').join(' '))).toHaveCount(0);

  // Обновление страницы возвращает в ту же комнату тем же игроком
  await guest.page.reload();
  await expect(guest.page.getByRole('heading', { name: 'Игроки' })).toBeVisible();
  await expect(playersList(guest.page)).toHaveCount(2);
  await expect(playersList(host.page).filter({ hasText: 'Гость' })).not.toContainText('Не в сети');

  // Передача прав хоста
  await host.page.getByRole('button', { name: 'Сделать хостом: Гость' }).click();
  await expect(playersList(host.page).filter({ hasText: 'Гость' })).toContainText('👑');
  await expect(guest.page.getByRole('radio', { name: /Роли/ })).toBeVisible();

  // Новый хост исключает прежнего
  await guest.page.getByRole('button', { name: 'Исключить: Хост' }).click();
  await guest.page.getByRole('dialog').getByRole('button', { name: 'Исключить' }).click();
  await expect(host.page.getByRole('alert')).toContainText('Вас исключили из комнаты');
  await expect(playersList(guest.page)).toHaveCount(1);

  await host.context.close();
  await guest.context.close();
});

test('несуществующая комната и неверный код', async ({ page }) => {
  await page.goto('/r/ZZZZ');
  await page.getByLabel('Ник').fill('Кто-то');
  await page.getByRole('button', { name: 'Войти в комнату' }).click();
  await expect(page.getByRole('alert')).toContainText('Комната не найдена');

  await page.goto('/r/12');
  await expect(page.getByRole('heading')).toContainText('неверный код');
});

test('онбординг перед первой игрой: как играть и проверка микрофона', async ({ browser }) => {
  const player = await newPlayer(browser, 'Новичок', { onboarding: true });
  const { page } = player;
  await page.goto('/');
  await page.getByLabel('Ник').fill('Новичок');
  await page.getByRole('button', { name: 'Создать комнату' }).click();

  const dialog = page.getByRole('dialog', { name: 'Как играть' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Соберите комнату');
  await dialog.getByRole('button', { name: 'Дальше: микрофон' }).click();

  const mic = page.getByRole('dialog', { name: 'Проверим микрофон' });
  await expect(mic.getByLabel('Устройство ввода')).toBeVisible();
  await mic.getByRole('button', { name: 'Меня слышно, продолжить' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Второй раз онбординг не показывается
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Игроки' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await player.context.close();
});
