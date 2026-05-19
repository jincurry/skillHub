// react-i18next bootstrap. Loaded once from main.tsx, then components use the
// useTranslation() hook. Detected language is persisted to localStorage so a
// page reload doesn't flicker to the default first.
//
// Adding a new locale: drop a JSON file under ./locales/, add it to
// `resources` below, and surface it in the LanguageSwitcher.

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import zhCN from './locales/zh-CN.json';
import en from './locales/en.json';

export const SUPPORTED_LANGUAGES = ['zh-CN', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const STORAGE_KEY = 'skillHub.lang';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      'zh-CN': { translation: zhCN },
      en: { translation: en },
    },
    fallbackLng: 'zh-CN',
    supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
    // We persist the user's choice ourselves under STORAGE_KEY (set by the
    // language switcher). The detector reads it back on next load.
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: STORAGE_KEY,
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false, // React already escapes
    },
  });

/** Current i18next language, normalized to one of SUPPORTED_LANGUAGES. */
export function currentLanguage(): SupportedLanguage {
  const raw = i18n.resolvedLanguage ?? i18n.language ?? 'zh-CN';
  // i18next sometimes resolves "zh" → "zh-CN", "en-US" → "en"; coerce.
  if (raw.startsWith('zh')) return 'zh-CN';
  if (raw.startsWith('en')) return 'en';
  return 'zh-CN';
}

export default i18n;
