import { expect, test } from '@playwright/test';
import { useLoopbackMic } from './helpers';

/** Моменты щелчков в калибровочном клипе (мс) — заданы генератором демо-паков. */
const BEEPS_MS = [1000, 2000, 3500, 5000, 6500];
/** Допустимая ошибка выравнивания записи относительно видео. */
const TOLERANCE_MS = 50;

// Замер в WebKit изредка даёт выброс в сотни миллисекунд: тестовая «петля» гонит звук видео
// через Web Audio, и под нагрузкой WebKit рассогласовывает его с часами видео. Отличить это
// от настоящей ошибки приложения стенд не может, поэтому даём две повторные попытки;
// устойчивую регрессию они не скроют.
test.describe.configure({ retries: 2 });

for (const backend of ['auto', 'media', 'wav'] as const) {
  test(`синхронизация записи с видео (${backend})`, async ({ page, browserName }) => {
    // В WebKit приложение само выбирает запись в WAV (вариант «auto»): его MediaRecorder
    // в этом стенде теряет до двух секунд звука, и проверять его точность бессмысленно.
    test.skip(browserName === 'webkit' && backend === 'media', 'WebKit MediaRecorder drops audio');
    await useLoopbackMic(page);
    await page.goto(
      `/solo?pack=calibration&clip=beeps${backend === 'auto' ? '' : `&backend=${backend}`}`,
    );

    await page.getByRole('button', { name: 'Записать дубль' }).click();
    // Отсчёт 3-2-1, затем 8 секунд клипа; запись заканчивается сама.
    await expect(page.getByRole('button', { name: 'Прослушать' })).toBeVisible({ timeout: 30_000 });

    // В Chromium измеряем второй дубль — заодно проверяется перезапись. В WebKit так нельзя:
    // после повторного запуска клипа сама тестовая «петля» (звук видео → Web Audio → запись)
    // отдаёт звук с опозданием около секунды, и замер перестаёт что-либо значить.
    if (browserName !== 'webkit') {
      await page.getByRole('button', { name: 'Записать заново' }).click();
      await expect(page.getByRole('button', { name: 'Остановить' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Прослушать' })).toBeVisible({
        timeout: 30_000,
      });
    }

    const result = await page.evaluate(() => {
      const take = window.__dubparty?.lastTake;
      if (!take?.buffer) return null;
      const data = take.buffer.getChannelData(0);
      const rate = take.buffer.sampleRate;
      let peak = 0;
      for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]!));
      const threshold = peak * 0.3;
      const onsets: number[] = [];
      let quietUntil = 0;
      for (let i = 0; i < data.length; i++) {
        if (Math.abs(data[i]!) >= threshold) {
          if (i >= quietUntil) onsets.push((i / rate) * 1000);
          quietUntil = i + rate * 0.3;
        }
      }
      return {
        onsets,
        peak,
        offsetMs: take.offsetMs,
        backend: take.backend,
        mimeType: take.mimeType,
        driftCorrections: take.driftCorrections,
      };
    });

    expect(result, 'дубль записан и раскодирован').not.toBeNull();
    const { onsets, offsetMs, peak } = result!;
    if (backend === 'auto')
      expect(result!.backend).toBe(browserName === 'webkit' ? 'wav' : 'media');
    expect(peak, 'в записи есть звук').toBeGreaterThan(0.05);
    expect(onsets, 'в записи найдены все щелчки').toHaveLength(BEEPS_MS.length);

    // Время щелчка на шкале видео = время в записи + измеренное смещение.
    const errors = onsets.map((ms, i) => Math.round(ms + offsetMs - BEEPS_MS[i]!));
    console.log(
      `[sync ${browserName}/${result!.backend}] ${result!.mimeType} offset=${offsetMs} мс, ` +
        `ошибки=${JSON.stringify(errors)} мс, коррекций дрейфа=${result!.driftCorrections}`,
    );
    for (const error of errors) expect(Math.abs(error)).toBeLessThanOrEqual(TOLERANCE_MS);
  });
}
