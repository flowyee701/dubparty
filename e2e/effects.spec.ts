import { EFFECTS } from '../packages/shared/src/effects';
import { expect, test } from '@playwright/test';
import { useToneMic } from './helpers';

/**
 * Сдвиг высоты тона в браузере (AudioWorklet) должен давать тот же коэффициент, что и
 * фильтры ffmpeg на сервере: коэффициенты берутся из общего описания эффектов.
 */
for (const effect of ['pitchUp', 'pitchDown', 'helium'] as const) {
  test(`Web Audio: «${effect}» сдвигает тон на заданный коэффициент`, async ({ page }) => {
    const stage = EFFECTS[effect].find((s) => s.type === 'pitch');
    const ratio = stage?.type === 'pitch' ? stage.ratio : 1;
    await page.goto('/how');

    const measured = await page.evaluate(async (pitchRatio) => {
      const rate = 48_000;
      const ctx = new OfflineAudioContext(1, rate * 3, rate);
      await ctx.audioWorklet.addModule('/worklets/pitch-shifter.js');
      const osc = ctx.createOscillator();
      osc.frequency.value = 440;
      const shifter = new AudioWorkletNode(ctx, 'pitch-shifter', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: { ratio: pitchRatio },
      });
      osc.connect(shifter).connect(ctx.destination);
      osc.start();
      const rendered = await ctx.startRendering();
      const data = rendered.getChannelData(0);
      // Частота по переходам через ноль на устоявшемся участке; длительность — по длине буфера.
      let crossings = 0;
      for (let i = rate + 1; i < rate * 2.5; i++) {
        if (data[i - 1]! < 0 !== data[i]! < 0) crossings++;
      }
      let peak = 0;
      for (let i = rate; i < rate * 2.5; i++) peak = Math.max(peak, Math.abs(data[i]!));
      return { hz: crossings / 2 / 1.5, peak, seconds: rendered.duration };
    }, ratio);

    expect(measured.peak, 'на выходе есть сигнал').toBeGreaterThan(0.3);
    expect(measured.seconds, 'длительность не изменилась').toBe(3);
    expect(Math.abs(measured.hz - 440 * ratio) / (440 * ratio)).toBeLessThan(0.03);
  });
}

test('предпрослушивание дубля работает с каждым эффектом', async ({ page, browserName }) => {
  if (browserName === 'webkit') await useToneMic(page);
  await page.goto('/solo?clip=weather');
  await page.getByRole('button', { name: 'Записать дубль' }).click();
  await expect(page.getByRole('button', { name: 'Остановить' })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Остановить' }).click();
  await expect(page.getByRole('button', { name: 'Прослушать' })).toBeVisible();

  const video = page.locator('video');
  for (const name of ['Выше', 'Ниже', 'Робот', 'Эхо', 'Рация', 'Гелий', 'Без эффекта']) {
    await page.getByRole('radio', { name, exact: true }).click();
    await expect(page.getByRole('radio', { name, exact: true })).toBeChecked();
    // Выбор эффекта сразу запускает прослушивание: клип идёт, ошибок нет.
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);
    await expect(page.getByText('Не удалось воспроизвести дубль')).toHaveCount(0);
  }
  await page
    .getByRole('group', { name: 'Управление записью' })
    .getByRole('button', { name: 'Остановить' })
    .click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
});
