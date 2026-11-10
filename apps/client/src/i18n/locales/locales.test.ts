import { describe, expect, it } from 'vitest';
import { en } from './en';
import { ru } from './ru';

const PLURAL = /_(zero|one|two|few|many|other)$/;

/** Плоский список ключей; формы множественного числа сводятся к базовому ключу. */
function keys(node: unknown, prefix = ''): Set<string> {
  const out = new Set<string>();
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') for (const k of keys(value, path)) out.add(k);
    else out.add(path.replace(PLURAL, ''));
  }
  return out;
}

function placeholders(node: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') {
      for (const [k, v] of placeholders(value, path)) out.set(k, v);
    } else if (!PLURAL.test(path) || path.endsWith('_other')) {
      const found = [...String(value).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
      out.set(path.replace(PLURAL, ''), found.join(','));
    }
  }
  return out;
}

describe('переводы', () => {
  it('в русской и английской локалях одинаковый набор ключей', () => {
    const a = keys(ru);
    const b = keys(en);
    expect([...a].filter((k) => !b.has(k))).toEqual([]);
    expect([...b].filter((k) => !a.has(k))).toEqual([]);
  });

  it('подстановки в строках совпадают', () => {
    const a = placeholders(ru);
    const b = placeholders(en);
    const mismatched = [...a].filter(([k, v]) => b.get(k) !== v).map(([k]) => k);
    expect(mismatched).toEqual([]);
  });

  it('у русских множественных форм есть one, few и many', () => {
    const flat = (node: unknown, prefix = ''): string[] =>
      Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
        v && typeof v === 'object' ? flat(v, `${prefix}${k}.`) : [`${prefix}${k}`],
      );
    const all = flat(ru);
    const bases = new Set(all.filter((k) => PLURAL.test(k)).map((k) => k.replace(PLURAL, '')));
    for (const base of bases) {
      for (const form of ['one', 'few', 'many']) {
        expect(all, `${base}_${form}`).toContain(`${base}_${form}`);
      }
    }
  });
});
