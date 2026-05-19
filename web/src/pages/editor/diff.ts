// Line-based unified-style diff used by the submit modal's "查看变更" toggle.
// LCS-based (O(m·n)) — fine for small skill files but we cap at 400 lines per
// side so a runaway file doesn't lock up the main thread.

export type DiffLine = { t: ' ' | '+' | '-' | '…'; s: string };

export function computeDiff(before: string, after: string, ctx = 3): DiffLine[] {
  const A = before ? before.split('\n') : [];
  const B = after ? after.split('\n') : [];
  const m = Math.min(A.length, 400), n = Math.min(B.length, 400);
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const raw: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && A[i] === B[j]) { raw.push({ t: ' ', s: A[i] }); i++; j++; }
    else if (j < n && (i >= m || dp[i + 1][j] <= dp[i][j + 1])) { raw.push({ t: '+', s: B[j] }); j++; }
    else { raw.push({ t: '-', s: A[i] }); i++; }
  }

  // Show only lines within ctx-range of a change.
  const out: DiffLine[] = [];
  let skip = 0;
  for (let k = 0; k < raw.length; k++) {
    const nearChange = raw
      .slice(Math.max(0, k - ctx), Math.min(raw.length, k + ctx + 1))
      .some((l) => l.t !== ' ');
    if (!nearChange) { skip++; continue; }
    if (skip > 0) { out.push({ t: '…', s: `⋯ ${skip} 行未更改` }); skip = 0; }
    out.push(raw[k]);
  }
  if (skip > 0) out.push({ t: '…', s: `⋯ ${skip} 行未更改` });
  return out;
}
