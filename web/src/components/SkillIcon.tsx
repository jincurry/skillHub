import { pickIcon, shouldAutoGenerate } from '../lib/skillIcon';

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

export function SkillIcon({
  ns, name, icon, iconClass,
  size = 28, fontSize, borderRadius = 6,
  className = '', style,
}: Props) {
  const fs = fontSize ?? Math.max(11, Math.round(size * 0.42));

  if (!shouldAutoGenerate(icon)) {
    return (
      <div
        className={`skill-icon ${iconClass || 'blue'} ${className}`}
        style={{ width: size, height: size, fontSize: fs, borderRadius, ...style }}
      >{icon}</div>
    );
  }

  const Icon = pickIcon(ns, name);
  const iconSize = Math.round(size * 0.55);

  return (
    <div
      className={`skill-icon ${className}`}
      style={{
        width: size, height: size, borderRadius,
        background: 'var(--bg-muted)',
        border: '1px solid var(--border)',
        color: 'var(--text-muted)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'inherit',
        ...style,
      }}
    >
      <Icon size={iconSize} strokeWidth={1.75} />
    </div>
  );
}
