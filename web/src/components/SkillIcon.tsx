import { pickGradient, getInitials, shouldAutoGenerate } from '../lib/skillIcon';

interface Props {
  ns: string;
  name: string;
  icon?: string;
  iconClass?: string;
  size?: number;
  fontSize?: number;
  borderRadius?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Renders the avatar shown next to a skill across the app.
 *
 * Behavior:
 *   - If the author set a custom icon char (anything other than the default
 *     '?' placeholder), we keep the existing CSS-class color rendering so
 *     emojis and curated picks look the same as before.
 *   - Otherwise we deterministically derive 1-2 initials from the name and
 *     paint them on a hash-picked gradient. Same skill always gets the same
 *     gradient across reloads / sessions / users.
 */
export function SkillIcon({
  ns, name, icon, iconClass,
  size = 28, fontSize, borderRadius = 6,
  className = '', style,
}: Props) {
  // Letters scale with avatar size when the caller doesn't override.
  const fs = fontSize ?? Math.max(11, Math.round(size * 0.42));

  if (!shouldAutoGenerate(icon)) {
    // Honor the author's custom icon — keep existing class-based theme.
    return (
      <div
        className={`skill-icon ${iconClass || 'blue'} ${className}`}
        style={{ width: size, height: size, fontSize: fs, borderRadius, ...style }}
      >{icon}</div>
    );
  }

  const [c1, c2] = pickGradient(ns, name);
  const initials = getInitials(name);
  // CJK glyphs are visually heavier → drop the size a touch so two glyphs
  // still fit. Latin initials look better at the default weight.
  const isCJK = /[\u4e00-\u9fff]/.test(initials);
  const finalFs = isCJK ? Math.round(fs * 0.85) : fs;

  return (
    <div
      className={`skill-icon ${className}`}
      style={{
        width: size, height: size, borderRadius,
        background: `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`,
        color: '#fff',
        fontSize: finalFs,
        fontWeight: 700,
        letterSpacing: isCJK ? 0 : '-0.02em',
        textShadow: '0 1px 2px rgba(0,0,0,0.15)',
        // Override the .skill-icon default font-family so initials use the
        // app's display font, not the mono fallback.
        fontFamily: 'inherit',
        ...style,
      }}
    >{initials}</div>
  );
}
