// Deterministic skill icon generator.
//
// Each skill renders either:
//   - the explicit icon char the author set (e.g. an emoji), OR
//   - an auto-generated avatar with letters + a hash-derived gradient.
//
// Picks for the gradient palette and "is this the default placeholder?" check
// live here so every place that draws a skill avatar stays in sync.

const GRADIENTS: ReadonlyArray<readonly [string, string]> = [
  ['#6366f1', '#a855f7'], // indigo → purple
  ['#0ea5e9', '#6366f1'], // sky → indigo
  ['#10b981', '#0ea5e9'], // emerald → sky
  ['#f59e0b', '#ef4444'], // amber → red
  ['#ec4899', '#f43f5e'], // pink → rose
  ['#8b5cf6', '#ec4899'], // violet → pink
  ['#06b6d4', '#3b82f6'], // cyan → blue
  ['#22c55e', '#84cc16'], // green → lime
  ['#f97316', '#ec4899'], // orange → pink
  ['#14b8a6', '#0ea5e9'], // teal → sky
  ['#a855f7', '#3b82f6'], // purple → blue
  ['#eab308', '#f97316'], // yellow → orange
];

// Cheap, stable 32-bit hash (FNV-1a). Same input → same output across runs
// and across platforms; we only need decent distribution, not crypto.
function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function pickGradient(ns: string, name: string): readonly [string, string] {
  const h = hash32(`${ns}/${name}`);
  return GRADIENTS[h % GRADIENTS.length];
}

// Returns 1-2 uppercase letters that represent the skill name.
//   "auth-service"   → "AS"
//   "data_pipeline"  → "DP"
//   "tool"           → "T"
//   "rag-eval-bench" → "RB"  (first + last token)
//   "数据-清洗"        → "数清" (CJK preserves 2 chars)
export function getInitials(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return '?';
  // CJK characters carry meaning per glyph; show up to 2.
  if (/[\u4e00-\u9fff]/.test(cleaned)) {
    const cjk = Array.from(cleaned).filter((c) => /[\u4e00-\u9fff]/.test(c));
    return cjk.slice(0, 2).join('');
  }
  const tokens = cleaned.split(/[-_.\s/]+/).filter(Boolean);
  if (tokens.length === 0) return cleaned.slice(0, 2).toUpperCase();
  if (tokens.length === 1) {
    return tokens[0].slice(0, Math.min(2, tokens[0].length)).toUpperCase();
  }
  return (tokens[0][0] + tokens[tokens.length - 1][0]).toUpperCase();
}

// Server defaults are icon='?', iconClass='blue' for unconfigured skills.
// Anything outside that pair is treated as user-curated and rendered as-is.
export function shouldAutoGenerate(icon: string | undefined): boolean {
  return !icon || icon === '?' || icon === '';
}
