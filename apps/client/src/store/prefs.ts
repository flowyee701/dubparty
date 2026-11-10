import { AVATARS, PLAYER_COLORS, type Avatar } from '@dubparty/shared';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'system' | 'light' | 'dark';
export type Lang = 'ru' | 'en';

export interface PrefsState {
  theme: Theme;
  lang: Lang;
  sfx: boolean;
  nickname: string;
  avatar: Avatar;
  color: string;
  /** Игрок уже видел «Как играть» и проверил микрофон. */
  onboarded: boolean;
  micDeviceId: string | null;
  setTheme(theme: Theme): void;
  setLang(lang: Lang): void;
  setSfx(sfx: boolean): void;
  setProfile(profile: Partial<Pick<PrefsState, 'nickname' | 'avatar' | 'color'>>): void;
  setOnboarded(value: boolean): void;
  setMicDeviceId(id: string | null): void;
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function detectLang(): Lang {
  const nav = typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : 'ru';
  // Русский — по умолчанию; английский включаем только при явно английской локали браузера.
  return nav.startsWith('en') ? 'en' : 'ru';
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      theme: 'system',
      lang: detectLang(),
      sfx: true,
      nickname: '',
      avatar: pick(AVATARS),
      color: pick(PLAYER_COLORS),
      onboarded: false,
      micDeviceId: null,
      setTheme: (theme) => set({ theme }),
      setLang: (lang) => set({ lang }),
      setSfx: (sfx) => set({ sfx }),
      setProfile: (profile) => set(profile),
      setOnboarded: (onboarded) => set({ onboarded }),
      setMicDeviceId: (micDeviceId) => set({ micDeviceId }),
    }),
    { name: 'dubparty:prefs', version: 1 },
  ),
);

export function isDark(theme: Theme): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(theme: Theme): void {
  const dark = isDark(theme);
  document.documentElement.classList.toggle('dark', dark);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#0f0c18' : '#f5f3fb');
}
