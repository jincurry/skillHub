import { useEffect, useState } from 'react';
import { IconSun, IconMoon, IconMonitor } from './Icons';
import { applyTheme, getStoredTheme, nextTheme, watchSystemTheme, type Theme } from '../lib/theme';

const THEME_LABEL: Record<Theme, string> = {
  light: '亮色',
  dark: '暗色',
  system: '跟随系统',
};

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
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== 'system') return;
    return watchSystemTheme(() => applyTheme('system'));
  }, [theme]);

  return (
    <button
      className="icon-btn"
      title={`主题: ${THEME_LABEL[theme]}（点击切换）`}
      aria-label={`切换主题，当前 ${THEME_LABEL[theme]}`}
      onClick={() => setTheme((t) => nextTheme(t))}
    >
      {iconFor(theme)}
    </button>
  );
}
