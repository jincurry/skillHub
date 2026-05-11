// Theme switcher: writes data-theme on <html>. Three modes:
//   - 'light' / 'dark': forced
//   - 'system'        : follow prefers-color-scheme media query
// Persisted in localStorage under 'theme'. Existing CSS variables in
// global.css (`:root` for light, `[data-theme="dark"]` for dark) handle the
// rest, so no per-component styling is needed.

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'theme';

export function getStoredTheme(): Theme {
  const t = (typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null) as Theme | null;
  if (t === 'light' || t === 'dark' || t === 'system') return t;
  return 'system';
}

/** Resolve `system` to the OS preference; pass-through for explicit choices. */
export function resolveTheme(t: Theme): 'light' | 'dark' {
  if (t === 'system') {
    return typeof window !== 'undefined'
      && window.matchMedia
      && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }
  return t;
}

/** Apply a theme to <html> and persist the choice. */
export function applyTheme(t: Theme): void {
  if (typeof document === 'undefined') return;
  const resolved = resolveTheme(t);
  document.documentElement.setAttribute('data-theme', resolved);
  try {
    localStorage.setItem(STORAGE_KEY, t);
  } catch { /* ignore: storage may be disabled */ }
}

/** Cycle: light -> dark -> system -> light. */
export function nextTheme(t: Theme): Theme {
  return t === 'light' ? 'dark' : t === 'dark' ? 'system' : 'light';
}

/**
 * Wire up a listener so that when the user picks "system" we react to OS
 * preference changes live. Returns a cleanup fn (call from React effect).
 */
export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => onChange();
  mql.addEventListener?.('change', handler);
  return () => mql.removeEventListener?.('change', handler);
}
