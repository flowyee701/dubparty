import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiErr } from '../net/socket';
import { serverNow } from '../store/room';

/** Сколько миллисекунд осталось до момента времени сервера. Обновляется несколько раз в секунду. */
export function useRemainingMs(endsAt: number | null, intervalMs = 250): number | null {
  const [, force] = useState(0);
  useEffect(() => {
    if (endsAt === null) return;
    const id = window.setInterval(() => force((n) => n + 1), intervalMs);
    return () => window.clearInterval(id);
  }, [endsAt, intervalMs]);
  return endsAt === null ? null : Math.max(0, endsAt - serverNow());
}

export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Понятный текст ошибки по её коду. */
export function useErrorText(): (err: unknown) => string {
  const { t, i18n } = useTranslation();
  return (err) => {
    const code = err instanceof ApiErr ? err.code : 'INTERNAL';
    const key = `errors.${code}`;
    return i18n.exists(key) ? t(key) : t('errors.INTERNAL');
  };
}

/** Последнее значение в ref — чтобы обработчики в эффектах не устаревали. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return reduced;
}
