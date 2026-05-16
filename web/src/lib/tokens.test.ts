import { describe, expect, it } from 'vitest';
import { estimateTokens, fmtTokens } from './tokens';

describe('estimateTokens', () => {
  it('returns 0 for empty input', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('counts ASCII at ~0.25 tok/char', () => {
    // 16 chars → ceil(16 * 0.25) = 4
    expect(estimateTokens('hello world abcd')).toBe(4);
  });

  it('counts CJK heavier than ASCII', () => {
    const cjk = estimateTokens('你好世界你好世界'); // 8 CJK chars
    const ascii = estimateTokens('helloworldhelloworld'); // 20 ASCII chars
    // 8 * 0.67 ≈ 5.36 → 6, 20 * 0.25 = 5
    expect(cjk).toBe(6);
    expect(ascii).toBe(5);
    expect(cjk).toBeGreaterThan(ascii);
  });

  it('mixes CJK and ASCII correctly', () => {
    // 4 CJK + 6 non-CJK (incl. space + '!') → ceil(4*0.67 + 6*0.25) = ceil(4.18) = 5
    expect(estimateTokens('你好世界 abcd!')).toBe(5);
  });
});

describe('fmtTokens', () => {
  it('keeps small numbers as-is', () => {
    expect(fmtTokens(0)).toBe('0');
    expect(fmtTokens(42)).toBe('42');
    expect(fmtTokens(999)).toBe('999');
  });

  it('uses one decimal in 1k–10k range', () => {
    expect(fmtTokens(1000)).toBe('1.0k');
    expect(fmtTokens(2500)).toBe('2.5k');
    expect(fmtTokens(9999)).toBe('10.0k');
  });

  it('rounds to whole k above 10k', () => {
    expect(fmtTokens(10000)).toBe('10k');
    expect(fmtTokens(12345)).toBe('12k');
    expect(fmtTokens(99999)).toBe('100k');
  });
});
