import { describe, expect, it } from 'vitest';
import { SYNC } from './constants';
import {
  activeLineIndex,
  correctionFor,
  estimateClock,
  median,
  mediaTimeAt,
  positionAt,
  rawPositionAt,
  takeOffsetMs,
} from './sync';

describe('estimateClock', () => {
  it('выбирает замер с минимальным RTT', () => {
    const est = estimateClock([
      { sentAt: 1000, receivedAt: 1200, serverTime: 5150 }, // rtt 200
      { sentAt: 2000, receivedAt: 2020, serverTime: 6010 }, // rtt 20 → offset 4000
      { sentAt: 3000, receivedAt: 3090, serverTime: 7000 },
    ]);
    expect(est).toEqual({ offsetMs: 4000, rttMs: 20 });
  });

  it('пустая серия и некорректные замеры', () => {
    expect(estimateClock([])).toBeNull();
    expect(estimateClock([{ sentAt: 10, receivedAt: 5, serverTime: 0 }])).toBeNull();
  });
});

describe('позиция воспроизведения', () => {
  it('на паузе позиция не движется', () => {
    expect(rawPositionAt({ playing: false, positionMs: 1234, serverTime: 0 }, 99_999)).toBe(1234);
  });

  it('при воспроизведении растёт вместе с временем сервера', () => {
    const anchor = { playing: true, positionMs: 500, serverTime: 10_000 };
    expect(rawPositionAt(anchor, 10_750)).toBe(1250);
  });

  it('преролл даёт отрицательную сырую позицию и ноль после ограничения', () => {
    const anchor = { playing: true, positionMs: 0, serverTime: 10_000 };
    expect(rawPositionAt(anchor, 8_000)).toBe(-2000);
    expect(positionAt(anchor, 8_000, 5000)).toBe(0);
    expect(positionAt(anchor, 99_000, 5000)).toBe(5000);
  });
});

describe('correctionFor', () => {
  it('малое отклонение не трогаем', () => {
    expect(correctionFor(SYNC.softMs)).toEqual({ action: 'none', rate: 1 });
    expect(correctionFor(-10)).toEqual({ action: 'none', rate: 1 });
  });

  it('среднее догоняем скоростью в нужную сторону', () => {
    expect(correctionFor(100)).toEqual({ action: 'rate', rate: 1 - SYNC.rateDelta });
    expect(correctionFor(-100)).toEqual({ action: 'rate', rate: 1 + SYNC.rateDelta });
  });

  it('за пределами допуска — прыжок', () => {
    expect(correctionFor(SYNC.toleranceMs + 1).action).toBe('seek');
    expect(correctionFor(-3000).action).toBe('seek');
  });
});

describe('смещение записи', () => {
  it('mediaTimeAt экстраполирует время видео по часам', () => {
    expect(mediaTimeAt({ clockMs: 1000, mediaMs: 40 }, 1100)).toBe(140);
    expect(mediaTimeAt({ clockMs: 1000, mediaMs: 40 }, 900)).toBe(-60);
  });

  it('медиана', () => {
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('смещение — медиана замеров «видео минус запись»', () => {
    // Запись стартовала на 120 мс позже видео
    expect(takeOffsetMs({ samples: [118, 121, 120, 122, 119] })).toBe(120);
    // Запись стартовала раньше видео
    expect(takeOffsetMs({ samples: [-67, -66, -68] })).toBe(-67);
  });

  it('одиночные выбросы не сдвигают результат', () => {
    expect(takeOffsetMs({ samples: [100, 101, 99, -400, 100, 900, 100] })).toBe(100);
  });

  it('входная задержка вычитается, мусор игнорируется', () => {
    const samples = [100, 100, 100];
    expect(takeOffsetMs({ samples, inputLatencyMs: 30 })).toBe(70);
    expect(takeOffsetMs({ samples, inputLatencyMs: NaN })).toBe(100);
    expect(takeOffsetMs({ samples, inputLatencyMs: -5 })).toBe(100);
    expect(takeOffsetMs({ samples: [] })).toBe(0);
  });
});

describe('activeLineIndex', () => {
  const lines = [
    { startMs: 1000, endMs: 2000 },
    { startMs: 2000, endMs: 3000 },
  ];
  it('находит текущую реплику', () => {
    expect(activeLineIndex(lines, 500)).toBe(-1);
    expect(activeLineIndex(lines, 1000)).toBe(0);
    expect(activeLineIndex(lines, 2000)).toBe(1);
    expect(activeLineIndex(lines, 3000)).toBe(-1);
  });
});
