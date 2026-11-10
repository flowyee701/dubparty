import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { skipOnboarding } from './helpers';

const VIDEO = path.resolve('apps/server/assets/demo-pack/clips/catdog/video.mp4');

test('редактор паков: загрузка, реплики, обрезка, экспорт, импорт и выбор в лобби', async ({
  page,
}, testInfo) => {
  // Данные сервера переживают прогоны, поэтому название уникально для каждого запуска.
  const packTitle = `Тестовый пак ${testInfo.project.name} ${Date.now() % 1_000_000}`;

  await skipOnboarding(page);

  // ── Создание пака и загрузка видео ──
  await page.goto('/packs');
  await expect(page.getByRole('heading', { name: 'Демо-пак' })).toBeVisible();
  await page.getByLabel('Название пака').fill(packTitle);
  await page.getByRole('button', { name: 'Создать пак' }).click();
  await expect(page).toHaveURL(/\/packs\/[\w-]+$/);
  await expect(page.getByRole('heading', { name: packTitle })).toBeVisible();

  // Файл с расширением видео, но без видео внутри, сервер отклоняет по сигнатуре
  const fake = testInfo.outputPath('fake.mp4');
  fs.writeFileSync(fake, 'это не видео '.repeat(500));
  await page.locator('#clip-file').setInputFiles(fake);
  await page.getByRole('button', { name: 'Загрузить' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Формат файла не поддерживается' }),
  ).toBeVisible();

  await page.locator('#clip-file').setInputFiles(VIDEO);
  await page.getByLabel('Название клипа').fill('Двор');
  await page.getByRole('button', { name: 'Загрузить' }).click();
  await expect(page.getByText('Клип добавлен')).toBeVisible({ timeout: 60_000 });
  const clips = page.getByRole('region', { name: 'Клипы' });
  await expect(clips.getByRole('listitem')).toHaveCount(1);
  await expect(clips).toContainText('0:15');

  // ── Персонажи и реплики ──
  await page.getByLabel('Имя персонажа 1').fill('Кот');
  await page.getByRole('button', { name: '+ Персонаж' }).click();
  await page.getByLabel('Имя персонажа 2').fill('Пёс');

  const video = page.locator('video').first();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
  await video.evaluate((v: HTMLVideoElement) => (v.currentTime = 3));
  await expect(page.getByRole('button', { name: /Реплика на 0:03/ })).toBeVisible();
  await page.getByRole('button', { name: /Реплика на/ }).click();
  await page.getByLabel('Текст реплики 1').fill('Мяу!');
  await page.getByLabel('Конец реплики 1, секунды').fill('4.5');

  await video.evaluate((v: HTMLVideoElement) => (v.currentTime = 6));
  await expect(page.getByRole('button', { name: /Реплика на 0:06/ })).toBeVisible();
  await page.getByRole('button', { name: /Реплика на/ }).click();
  await page.getByLabel('Персонаж реплики 2').selectOption({ label: 'Пёс' });

  // Реплика без текста не сохраняется
  await page.getByRole('button', { name: 'Сохранить реплики' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Проверьте реплику 2' })).toBeVisible();
  await page.getByLabel('Текст реплики 2').fill('Гав?');
  await page.getByRole('button', { name: 'Сохранить реплики' }).click();
  await expect(page.getByText('Реплики сохранены')).toBeVisible();
  await expect(page.getByText('Все изменения сохранены')).toBeVisible();

  // Предпросмотр показывает реплики так, как их увидит игрок
  await expect(page.getByRole('list', { name: 'Реплики' }).getByRole('listitem')).toHaveCount(2);

  // ── Перетаскивание на таймлайне ──
  const block = page.locator('[data-line]').first();
  const box = (await block.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByText('Есть несохранённые изменения')).toBeVisible();
  const moved = Number(await page.getByLabel('Начало реплики 1, секунды').inputValue());
  expect(moved).toBeGreaterThan(3);
  // Возвращаем прежние значения — редактор понимает, что сохранять больше нечего.
  await page.getByLabel('Начало реплики 1, секунды').fill('3');
  await page.getByLabel('Конец реплики 1, секунды').fill('4.5');
  await expect(page.getByText('Все изменения сохранены')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сохранить реплики' })).toBeDisabled();

  // ── Обрезка: таймкоды сдвигаются вместе с началом клипа ──
  await page.getByRole('tab', { name: 'Обрезка' }).click();
  await page.getByLabel('Начало, с').fill('1');
  await page.getByLabel('Конец, с').fill('9');
  await expect(page.getByText(/Длина клипа: 8 с/)).toBeVisible();
  await page.getByRole('button', { name: 'Обрезать' }).click();
  await expect(page.getByText('Клип обрезан')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByLabel('Начало реплики 1, секунды')).toHaveValue('2');
  await expect(page.getByLabel('Начало реплики 2, секунды')).toHaveValue('5');
  await expect(clips).toContainText('0:08');

  // ── Экспорт и импорт ──
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Экспорт/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.dubpack\.zip$/);
  const zipPath = testInfo.outputPath('pack.zip');
  await download.saveAs(zipPath);
  expect(fs.statSync(zipPath).size).toBeGreaterThan(50_000);

  const originalUrl = page.url();
  await page.goto('/packs');
  await page.locator('#pack-import').setInputFiles(zipPath);
  await expect(page.getByText('Пак импортирован')).toBeVisible({ timeout: 90_000 });
  await expect(page).toHaveURL(/\/packs\/[\w-]+$/);
  expect(page.url()).not.toBe(originalUrl);
  await expect(page.getByRole('heading', { name: packTitle })).toBeVisible();
  await expect(page.getByLabel('Текст реплики 1')).toHaveValue('Мяу!');
  await expect(page.getByLabel('Текст реплики 2')).toHaveValue('Гав?');
  await expect(page.getByLabel('Имя персонажа 2')).toHaveValue('Пёс');

  // Копию можно удалить
  await page.getByRole('button', { name: 'Удалить пак' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить пак' }).click();
  await expect(page).toHaveURL(/\/packs$/);
  await expect(page.getByRole('heading', { name: packTitle })).toHaveCount(1);

  // ── Свой пак доступен в лобби ──
  await page.goto('/');
  await page.getByLabel('Ник').fill('Автор');
  await page.getByRole('button', { name: 'Создать комнату' }).click();
  const select = page.getByLabel('Пак клипов');
  await select.selectOption({ label: `${packTitle} — 1 клип` });
  await expect(select.locator('option:checked')).toContainText(packTitle);

  // Встроенный пак открывается только на просмотр
  await page.goto('/packs/demo');
  await expect(page.getByText('только просмотр')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сохранить реплики' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Удалить пак' })).toHaveCount(0);
});
