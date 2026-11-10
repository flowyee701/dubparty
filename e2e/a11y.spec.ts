import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** Серьёзные и критические нарушения доступности по правилам WCAG 2.1 A/AA. */
async function violations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.id}: ${v.help} → ${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 4)
          .join(' | ')}`,
    );
}

async function setTheme(page: Page, theme: 'dark' | 'light') {
  await page.addInitScript((value) => {
    localStorage.setItem(
      'dubparty:prefs',
      JSON.stringify({
        state: { onboarded: true, theme: value, sfx: false, nickname: 'Тест' },
        version: 1,
      }),
    );
  }, theme);
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(`доступность, тема ${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      await setTheme(page, theme);
      // Без анимаций появления: полупрозрачный в этот момент текст дал бы ложные срабатывания
      // проверки контраста.
      await page.emulateMedia({ reducedMotion: 'reduce' });
    });

    for (const [name, url, ready] of [
      ['главная', '/', 'Создать комнату'],
      ['как играть', '/how', 'Как играть'],
      ['проверка микрофона', '/mic', 'Проверка микрофона'],
      ['тренировка: выбор клипа', '/solo', 'Спор роботов'],
      ['тренировка: запись', '/solo?clip=robots', 'Записать дубль'],
      ['список паков', '/packs', 'Демо-пак'],
      ['редактор пака', '/packs/demo', 'Реплики'],
    ] as const) {
      test(name, async ({ page }) => {
        await page.goto(url);
        await expect(page.getByText(ready).first()).toBeVisible();
        expect(await violations(page)).toEqual([]);
      });
    }

    test('лобби и вход по коду', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('button', { name: 'Создать комнату' }).click();
      await expect(page.getByRole('heading', { name: 'Игроки' })).toBeVisible();
      expect(await violations(page)).toEqual([]);

      await page.goto('/r/ZZZZ');
      await expect(page.getByRole('button', { name: 'Войти в комнату' })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  });
}

test('с клавиатуры: до главного действия можно дойти и активировать его', async ({
  page,
  browserName,
}) => {
  await setTheme(page, 'dark');
  await page.goto('/');
  // Первая остановка Tab — ссылка «Перейти к содержимому». Safari по умолчанию обходит
  // ссылки по Option+Tab (так настроена macOS), поэтому в WebKit жмём именно его.
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(page.getByRole('link', { name: 'Перейти к содержимому' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();

  await page.getByLabel('Ник').focus();
  await page.keyboard.type('Клава');
  const create = page.getByRole('button', { name: 'Создать комнату' });
  await create.focus();
  // Фокус виден: у элемента есть контур
  const outline = await create.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Игроки' })).toBeVisible();

  // Настройки управляются с клавиатуры
  const mode = page.getByRole('radio', { name: /Роли/ });
  await mode.focus();
  await page.keyboard.press('Space');
  await expect(mode).toBeChecked();
  const toggle = page.getByRole('switch', { name: 'Скрыть код комнаты' });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toBeChecked();
});
