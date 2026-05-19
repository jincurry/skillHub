import { useTranslation } from 'react-i18next';
import { IconChevronDown } from './Icons';
import { SUPPORTED_LANGUAGES, STORAGE_KEY, type SupportedLanguage } from '../i18n';

/**
 * Compact language toggle for the topbar. Cycles through SUPPORTED_LANGUAGES
 * on click. We persist the choice manually so the next page load reads the
 * same value via i18next-browser-languagedetector's localStorage detector.
 */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();

  // Resolve to one of the supported tags (i18next may give back a regional
  // variant like "zh-Hans" that we don't have a JSON for).
  const current = (SUPPORTED_LANGUAGES.find((l) => i18n.resolvedLanguage === l)
    ?? SUPPORTED_LANGUAGES.find((l) => i18n.resolvedLanguage?.startsWith(l.split('-')[0]))
    ?? 'zh-CN') as SupportedLanguage;

  function cycle() {
    const idx = SUPPORTED_LANGUAGES.indexOf(current);
    const next = SUPPORTED_LANGUAGES[(idx + 1) % SUPPORTED_LANGUAGES.length];
    void i18n.changeLanguage(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* private mode */ }
  }

  return (
    <button
      className="icon-btn"
      onClick={cycle}
      title={`${t('language.switcherLabel')}: ${t(`language.${current}`)}`}
      aria-label={`${t('language.switcherLabel')}: ${t(`language.${current}`)}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 12, padding: '0 8px',
      }}
    >
      <span style={{ fontWeight: 500 }}>{current === 'zh-CN' ? '中' : 'EN'}</span>
      <IconChevronDown size={12} />
    </button>
  );
}
