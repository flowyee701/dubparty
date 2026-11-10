import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { isDark, usePrefs } from '../store/prefs';
import { useToasts } from '../store/toasts';
import { cx } from './ui';

function IconButton({
  label,
  onClick,
  children,
  pressed,
}: {
  label: string;
  onClick(): void;
  children: ReactNode;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className="grid size-10 place-items-center rounded-full text-lg hover:bg-surface-2"
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}

export function Header({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const theme = usePrefs((s) => s.theme);
  const setTheme = usePrefs((s) => s.setTheme);
  const lang = usePrefs((s) => s.lang);
  const setLang = usePrefs((s) => s.setLang);
  const sfx = usePrefs((s) => s.sfx);
  const setSfx = usePrefs((s) => s.setSfx);
  const dark = isDark(theme);

  return (
    <header className="flex items-center justify-between gap-2 px-4 py-3 sm:px-6">
      <Link
        to="/"
        className={cx(
          'flex items-center gap-2 font-extrabold tracking-tight',
          compact ? 'text-lg' : 'text-xl',
        )}
      >
        <img src="/favicon.svg" alt="" className="size-8 rounded-lg" />
        <span>
          Dub<span className="text-accent">Party</span>
        </span>
      </Link>
      <nav aria-label={t('common.settings')} className="flex items-center gap-1">
        <IconButton
          label={sfx ? t('common.soundOff') : t('common.soundOn')}
          pressed={sfx}
          onClick={() => setSfx(!sfx)}
        >
          {sfx ? '🔊' : '🔇'}
        </IconButton>
        <IconButton
          label={dark ? t('common.themeLight') : t('common.themeDark')}
          onClick={() => setTheme(dark ? 'light' : 'dark')}
        >
          {dark ? '☀️' : '🌙'}
        </IconButton>
        <button
          type="button"
          onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')}
          // Доступное имя включает видимый текст кнопки — так её можно вызвать голосом.
          aria-label={`${lang === 'ru' ? 'EN' : 'RU'} — ${t('common.switchLang')}`}
          title={t('common.switchLang')}
          className="h-10 rounded-full px-3 text-sm font-bold uppercase hover:bg-surface-2"
        >
          {lang === 'ru' ? 'EN' : 'RU'}
        </button>
      </nav>
    </header>
  );
}

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.kind === 'error' ? 'alert' : 'status'}
          className={cx(
            'pointer-events-auto flex max-w-md animate-rise items-start gap-3 rounded-2xl border px-4 py-3 text-sm shadow-lg',
            toast.kind === 'error' && 'border-danger/40 bg-danger-soft',
            toast.kind === 'success' && 'border-success/40 bg-success-soft',
            toast.kind === 'info' && 'border-border bg-surface',
          )}
        >
          <span className="text-pretty">{toast.text}</span>
          <button
            type="button"
            onClick={() => dismiss(toast.id)}
            aria-label="✕"
            className="-mr-1 text-muted hover:text-text"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      ))}
    </div>
  );
}

export function Page({
  children,
  width = 'md',
  compactHeader,
}: {
  children: ReactNode;
  width?: 'sm' | 'md' | 'lg' | 'xl';
  compactHeader?: boolean;
}) {
  const { t } = useTranslation();
  const widths = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' };
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only-focusable absolute top-2 left-2 z-50 rounded-lg bg-accent px-3 py-2 text-accent-fg"
      >
        {t('common.skipToContent')}
      </a>
      <Header compact={compactHeader} />
      <main
        id="main"
        tabIndex={-1}
        className={cx('mx-auto w-full flex-1 px-4 pb-10 outline-none sm:px-6', widths[width])}
      >
        {children}
      </main>
    </div>
  );
}
