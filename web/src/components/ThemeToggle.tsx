import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconSun, IconMoon, IconMonitor } from './Icons';
import { applyTheme, getStoredTheme, nextTheme, watchSystemTheme, type Theme } from '../lib/theme';

function iconFor(t: Theme) {
  if (t === 'light') return <IconSun size={18} />;
  if (t === 'dark') return <IconMoon size={18} />;
  return <IconMonitor size={18} />;
}

/**
 * Single-button theme toggle. Click cycles light -> dark -> system.
 * The button is wired to the `data-theme` attribute on <html>; when the user
 * is on `system` mode and the OS preference flips, we re-apply automatically.
 */
export function ThemeToggle() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== 'system') return;
    return watchSystemTheme(() => applyTheme('system'));
  }, [theme]);

  const label = t(`theme.${theme}`);
  return (
    <button
      className="icon-btn"
      title={t('theme.tooltip', { label })}
      aria-label={t('theme.ariaLabel', { label })}
      onClick={() => setTheme((tt) => nextTheme(tt))}
    >
      {iconFor(theme)}
    </button>
  );
}
