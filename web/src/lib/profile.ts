// Profile customisation helpers: cover gradient presets and the resolver that
// turns the stored Me row into a CSS background string.

import type { Me } from '../api/types';

export interface CoverPreset {
  id: string;
  label: string;
  from: string;
  to: string;
}

export const COVER_PRESETS: CoverPreset[] = [
  { id: 'sunset',  label: '日落',   from: '#f59e0b', to: '#ec4899' },
  { id: 'aurora',  label: '极光',   from: '#8b5cf6', to: '#ec4899' },
  { id: 'ocean',   label: '海洋',   from: '#06b6d4', to: '#3b82f6' },
  { id: 'forest',  label: '森林',   from: '#10b981', to: '#059669' },
  { id: 'cyber',   label: '赛博',   from: '#22d3ee', to: '#7c3aed' },
  { id: 'peach',   label: '蜜桃',   from: '#fbbf24', to: '#f43f5e' },
  { id: 'slate',   label: '深灰',   from: '#64748b', to: '#1e293b' },
  { id: 'mono',    label: '墨黑',   from: '#525252', to: '#171717' },
];

const PRIMARY_FALLBACK = { from: '#4f46e5', to: '#a855f7' };

/** Resolve the (from, to) hex pair the UI should render for this user. */
export function resolveCover(me: Pick<Me, 'coverPreset' | 'coverFrom' | 'coverTo'> | null | undefined): { from: string; to: string } {
  if (me?.coverFrom && me?.coverTo) return { from: me.coverFrom, to: me.coverTo };
  const preset = COVER_PRESETS.find((p) => p.id === me?.coverPreset);
  if (preset) return { from: preset.from, to: preset.to };
  return PRIMARY_FALLBACK;
}

/** Convenience: produce the CSS background-image string for a cover banner. */
export function coverBackground(me: Pick<Me, 'coverPreset' | 'coverFrom' | 'coverTo'> | null | undefined, angle = 135): string {
  const { from, to } = resolveCover(me);
  return `linear-gradient(${angle}deg, ${from} 0%, ${to} 100%)`;
}

/** Validate a hex color (#rgb or #rrggbb). Used by CoverPicker. */
export function isHexColor(s: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s);
}

const AVATAR_GRADIENTS: Array<{ from: string; to: string }> = [
  { from: '#f59e0b', to: '#ec4899' },
  { from: '#10b981', to: '#06b6d4' },
  { from: '#8b5cf6', to: '#6366f1' },
  { from: '#ef4444', to: '#f59e0b' },
  { from: '#06b6d4', to: '#3b82f6' },
];

/** Stable gradient picker for a username so the fallback avatar is consistent. */
export function avatarFallbackGradient(username: string): string {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) & 0xffff;
  const g = AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
  return `linear-gradient(135deg, ${g.from}, ${g.to})`;
}
