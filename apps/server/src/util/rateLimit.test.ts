import { describe, expect, it } from 'vitest';
import { TokenBucket } from './rateLimit';

describe('TokenBucket', () => {
  it('пропускает всплеск, затем ограничивает и пополняется со временем', () => {
    let now = 0;
    const bucket = new TokenBucket(3, 2, () => now);
    expect([bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, true]);
    expect(bucket.take()).toBe(false);
    now += 500; // +1 токен
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
    now += 60_000; // не больше ёмкости
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });
});
