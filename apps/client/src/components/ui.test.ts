import { describe, expect, it } from 'vitest';
import { cx, readableOn } from './ui';

describe('readableOn', () => {
  it.each([
    ['#ffffff', '#000000'],
    ['#f59e0b', '#000000'],
    ['#84cc16', '#000000'],
    ['#eab308', '#000000'],
    ['#000000', '#ffffff'],
    ['#3b82f6', '#000000'],
    ['#1e3a8a', '#ffffff'],
    ['#7c3aed', '#ffffff'],
    ['не цвет', '#ffffff'],
  ])('на фоне %s текст %s', (background, expected) => {
    expect(readableOn(background)).toBe(expected);
  });
});

describe('cx', () => {
  it('склеивает только истинные значения', () => {
    expect(cx('a', false, null, undefined, 'b')).toBe('a b');
  });
});
