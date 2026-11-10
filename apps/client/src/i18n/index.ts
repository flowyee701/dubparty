import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { usePrefs } from '../store/prefs';
import { en } from './locales/en';
import { ru } from './locales/ru';

void i18n.use(initReactI18next).init({
  resources: { ru: { translation: ru }, en: { translation: en } },
  lng: usePrefs.getState().lang,
  fallbackLng: 'ru',
  interpolation: { escapeValue: false },
  returnNull: false,
});

function syncDocumentLang(lang: string) {
  document.documentElement.lang = lang;
}
syncDocumentLang(i18n.language);

usePrefs.subscribe((state, prev) => {
  if (state.lang !== prev.lang) {
    void i18n.changeLanguage(state.lang);
    syncDocumentLang(state.lang);
  }
});

export default i18n;
