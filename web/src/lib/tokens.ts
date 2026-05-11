// Lightweight token estimator. We deliberately do NOT pull in tiktoken or
// gpt-tokenizer — they're hundreds of KB of WASM/JSON, and we only need to
// give the user a "this prompt is roughly N tokens" feel.
//
// Heuristic, calibrated against a few real tokenizers (gpt-4o, deepseek,
// qwen):
//   - ASCII / Latin words: ~4 chars per token
//   - CJK characters:      ~1.5 chars per token (each CJK glyph is ~0.7 tok)
//   - Other (numbers, punct, whitespace): bundled with ASCII
//
// Real number is within ±15% of the actual tokenizer in our spot checks,
// which is plenty for the "are we sending too much?" feedback loop.

const CJK_REGEX = /[\u3400-\u9fff\uac00-\ud7af\u3040-\u309f\u30a0-\u30ff]/g;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjkMatches = text.match(CJK_REGEX);
  const cjkLen = cjkMatches ? cjkMatches.length : 0;
  // Strip CJK out, then count remaining bytes.
  const restLen = text.length - cjkLen;
  // 1.5 chars/token for CJK ⇒ each CJK char ≈ 0.667 token.
  // 4 chars/token for ASCII ⇒ each ASCII char ≈ 0.25 token.
  return Math.ceil(cjkLen * 0.67 + restLen * 0.25);
}

/** Human-friendly digits ("1.2k", "12k", "9"). */
export function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return (n / 1000).toFixed(1) + 'k';
  return Math.round(n / 1000) + 'k';
}
