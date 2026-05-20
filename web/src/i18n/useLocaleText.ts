import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from './index';

export function isEnglishLanguage(language?: string | null): boolean {
  return (language ?? '').startsWith('en');
}

export function chooseText(isEnglish: boolean, en: string, zh: string): string {
  return isEnglish ? en : zh;
}

export function useLocaleText() {
  const { i18n: reactI18n } = useTranslation();
  const isEnglish = isEnglishLanguage(reactI18n.resolvedLanguage ?? reactI18n.language ?? i18n.resolvedLanguage ?? i18n.language);
  return useMemo(() => ({
    isEnglish,
    locale: isEnglish ? 'en-US' : 'zh-CN',
    text: (en: string, zh: string) => chooseText(isEnglish, en, zh),
  }), [isEnglish]);
}
