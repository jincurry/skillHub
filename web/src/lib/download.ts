// Authenticated file download with progress reporting and a built-in
// click-to-save dance.
//
// Why this exists
// ───────────────
// The original `api.downloadBundle` did `fetch().blob()` then `a.click()`.
// For a 100+ MB tar.gz that means:
//   1. The browser buffers the whole response into the JS heap with no UI
//      feedback. Users see nothing happen for many seconds.
//   2. They click again. Now two fetches are in flight; both eventually
//      trigger their own `a.click()`, producing two save dialogs / two
//      duplicate files in Downloads.
//   3. The Authorization header is mandatory (Bearer token), so we can't
//      hand the URL to a plain `<a download>` either — that 401s.
//
// Fix
// ───
// Stream the response via ReadableStream.getReader() so we can fire an
// onProgress callback on every chunk. The caller drives a busy state so
// the second click is rejected while the first is in flight. We still end
// up assembling a Blob (the only way to invoke a save dialog from JS), but
// at least the user sees "Downloading 42%" instead of a frozen button.

import { getToken } from '../api/auth';

const BASE = '/api/v1';

export interface DownloadProgress {
  received: number;
  /** 0 when the server didn't send Content-Length (rare for our endpoints). */
  total: number;
}

export interface DownloadOpts {
  onProgress?: (p: DownloadProgress) => void;
  signal?: AbortSignal;
}

/** Authenticated GET → save-as. Streams chunks so onProgress can update a
 *  live progress indicator. Returns the filename that was actually saved
 *  (parsed from Content-Disposition or the supplied fallback). */
export async function downloadFromAPI(
  path: string,
  fallbackName: string,
  opts: DownloadOpts = {},
): Promise<string> {
  const tok = getToken();
  const res = await fetch(BASE + path, {
    headers: tok ? { Authorization: `Bearer ${tok}` } : {},
    signal: opts.signal,
  });
  if (!res.ok) {
    // Try to surface the server's JSON `error` field; fall back to status.
    let detail = res.statusText;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) detail = j.error;
    } catch { /* ignore */ }
    throw new Error(`${res.status} ${detail}`);
  }

  // Content-Disposition handling: gin sends `attachment; filename="…"`.
  // The unquoted form is also accepted as a fallback.
  const cd = res.headers.get('Content-Disposition') ?? '';
  const quoted = /filename="([^"]+)"/.exec(cd);
  const bare = /filename=([^;]+)/.exec(cd);
  const filename = quoted?.[1] ?? bare?.[1]?.trim() ?? fallbackName;

  const total = parseInt(res.headers.get('Content-Length') ?? '0', 10);

  // Streaming read. Every chunk fires onProgress so the caller can update
  // a percentage in the button label. The chunks accumulate in an array
  // we hand to Blob() at the end — assembling on `new Blob(chunks)` is a
  // single allocation that the browser does natively, much cheaper than
  // concatenating Uint8Arrays in JS.
  const reader = res.body?.getReader();
  let blob: Blob;
  if (!reader) {
    // Older browsers / test environments: fall back to the legacy buffered
    // path. Progress reporting is degenerate here; we just emit a final
    // tick after the body lands.
    blob = await res.blob();
    opts.onProgress?.({ received: blob.size, total: total || blob.size });
  } else {
    const chunks: BlobPart[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      opts.onProgress?.({ received, total });
    }
    blob = new Blob(chunks);
  }

  // Trigger save-as. The transient anchor must be in the DOM for some
  // browsers (Firefox in particular ignores .click() on detached nodes).
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Give the browser a moment to actually start the download before we
    // free the blob URL. Revoking too early can race the click in some
    // implementations.
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  return filename;
}

/** Helper: pretty-print a percentage from a DownloadProgress, or `null`
 *  when the total isn't known yet. Used by the button label to avoid
 *  rendering "NaN%" when Content-Length is absent. */
export function progressPct(p: DownloadProgress | null): number | null {
  if (!p) return null;
  if (p.total <= 0) return null;
  return Math.min(100, Math.floor((p.received / p.total) * 100));
}
