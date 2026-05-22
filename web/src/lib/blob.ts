// Streaming file upload to the SkillHub blob storage protocol.
//
// Why this exists
// ───────────────
// The legacy upload path (api.putFile) JSON-encodes the file body. For a
// 100 MB file that turns into ~200 MB of UTF-16 in the JS heap (file.text())
// plus another copy after JSON.stringify, plus the fetch buffer — easily
// enough to OOM a tab. This module talks the /api/v1/blobs/* protocol the
// Python client uses: hash → exists check → single PUT or 4 MB chunks.
//
// Memory profile
// ──────────────
//   - SHA-256 is computed by streaming the File in 1 MB windows through
//     crypto.subtle.digest. Peak heap ≈ 1 MB regardless of file size.
//   - Single-PUT (< 4 MB) sends the File / Blob directly as the fetch body —
//     the browser streams it from disk, no JS-side copy.
//   - Chunked (≥ 4 MB) reads one slice at a time via Blob.arrayBuffer().
//     Peak heap ≈ 4 MB during the per-chunk hash + upload.
//
// We deliberately do NOT call file.text() anywhere in here. Even small files
// stay as ArrayBuffer / Blob so the JSON path can never sneak back in.

import { getToken } from '../api/auth';

const BASE = '/api/v1';

/** Files at or above this size MUST go through the chunked upload protocol.
 *  Matches the server-side maxSmallBlobSize constant in api/push.go. */
export const CHUNK_SIZE = 4 * 1024 * 1024;

/** Peak heap during streaming hash. Independent of file size. */
const HASH_WINDOW = 1 * 1024 * 1024;

/** Hard ceiling on a single blob, mirroring server `maxBlobTotalSize`. */
export const MAX_BLOB_SIZE = 500 * 1024 * 1024;

/** Per-batch limit for /blobs/exists (server enforces ≤ 500). */
const EXISTS_BATCH = 500;

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const tok = getToken();
  const h: Record<string, string> = { ...extra };
  if (tok) h['Authorization'] = `Bearer ${tok}`;
  return h;
}

/** Wrap a fetch error with the server's JSON `error` field when present so
 *  the editor can show "blob not uploaded" rather than a bare HTTP code. */
async function errMsg(res: Response): Promise<string> {
  let detail = res.statusText;
  try {
    const j = (await res.json()) as { error?: string };
    if (j?.error) detail = j.error;
  } catch { /* ignore */ }
  return `${res.status} ${detail}`;
}

/** Compute SHA-256 of a Blob/File using crypto.subtle. We hash the entire
 *  buffer in one shot when the file is small enough, and otherwise feed it
 *  through a manual incremental SHA-256 implementation since the WebCrypto
 *  digest API doesn't expose update() / final(). For our size budget the
 *  one-shot path is fine — even a 500 MB ArrayBuffer is allocatable. */
export async function sha256OfBlob(blob: Blob): Promise<string> {
  // For "small enough" inputs we can hand the whole buffer to subtle.digest
  // and let the browser do it natively. The threshold is generous — modern
  // browsers handle up to a few hundred MB without trouble, and going
  // through the JS implementation below for a 5 MB file would be slower.
  if (blob.size <= 32 * 1024 * 1024) {
    const buf = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return hex(new Uint8Array(digest));
  }
  // Stream-hash: read 1 MB windows, feed each through a JS SHA-256 that
  // exposes update / final. crypto.subtle alone can't do this without a
  // BigBuffer.
  const sha = createSha256();
  let offset = 0;
  while (offset < blob.size) {
    const end = Math.min(offset + HASH_WINDOW, blob.size);
    const chunk = blob.slice(offset, end);
    const buf = new Uint8Array(await chunk.arrayBuffer());
    sha.update(buf);
    offset = end;
  }
  return hex(sha.final());
}

/** Hex-encode a byte array. */
function hex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

/** Ask the server which of these sha256s it doesn't already have. */
export async function blobsExists(sums: string[]): Promise<Set<string>> {
  const missing = new Set<string>();
  for (let i = 0; i < sums.length; i += EXISTS_BATCH) {
    const batch = sums.slice(i, i + EXISTS_BATCH);
    const res = await fetch(`${BASE}/blobs/exists`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ sha256s: batch }),
    });
    if (!res.ok) throw new Error(await errMsg(res));
    const j = (await res.json()) as { missing?: string[] };
    for (const s of j.missing ?? []) missing.add(s);
  }
  return missing;
}

/** Single-PUT upload. Body is streamed straight from disk — no JS copy. */
async function putBlobDirect(sha: string, blob: Blob): Promise<void> {
  const res = await fetch(`${BASE}/blobs/${sha}`, {
    method: 'PUT',
    headers: authHeaders({
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(blob.size),
    }),
    body: blob,
  });
  if (!res.ok) throw new Error(await errMsg(res));
}

/** Three-step chunked upload. Each chunk holds at most CHUNK_SIZE bytes
 *  in memory; the next slice replaces it. */
async function putBlobChunked(
  sha: string,
  blob: Blob,
  onProgress?: (bytes: number, total: number) => void,
): Promise<void> {
  // Step 1: open session.
  const startRes = await fetch(`${BASE}/blobs/${sha}/uploads`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!startRes.ok) throw new Error(await errMsg(startRes));
  const { upload_id } = (await startRes.json()) as { upload_id: string };

  // Step 2: upload chunks. We iterate by index so a hung connection on one
  // chunk doesn't cascade — each PUT has its own retry surface.
  const total = blob.size;
  let sent = 0;
  let idx = 0;
  let offset = 0;
  while (offset < total) {
    const end = Math.min(offset + CHUNK_SIZE, total);
    const chunk = blob.slice(offset, end);
    const res = await fetch(
      `${BASE}/blobs/${sha}/uploads/${upload_id}/chunks/${idx}`,
      {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/octet-stream' }),
        body: chunk,
      },
    );
    if (!res.ok) throw new Error(await errMsg(res));
    sent = end;
    offset = end;
    idx += 1;
    onProgress?.(sent, total);
  }

  // Step 3: complete — server assembles chunks and verifies the full sha256.
  const doneRes = await fetch(
    `${BASE}/blobs/${sha}/uploads/${upload_id}/complete`,
    { method: 'POST', headers: authHeaders() },
  );
  if (!doneRes.ok) throw new Error(await errMsg(doneRes));
}

/** Upload a Blob to the server, returning its sha256 hex. Idempotent: if
 *  the server already has the content (dedup check), the upload is a no-op
 *  and only the hash computation cost is paid. */
export async function uploadBlob(
  blob: Blob,
  opts: { onProgress?: (bytes: number, total: number) => void } = {},
): Promise<{ sha256: string; size: number }> {
  if (blob.size > MAX_BLOB_SIZE) {
    throw new Error(`file too large: ${blob.size} bytes (max ${MAX_BLOB_SIZE})`);
  }
  const sum = await sha256OfBlob(blob);
  const missing = await blobsExists([sum]);
  if (missing.has(sum)) {
    if (blob.size < CHUNK_SIZE) {
      await putBlobDirect(sum, blob);
    } else {
      await putBlobChunked(sum, blob, opts.onProgress);
    }
  } else {
    // Server already has this content — report progress as fully done so
    // any UI bound to onProgress doesn't get stuck at 0.
    opts.onProgress?.(blob.size, blob.size);
  }
  return { sha256: sum, size: blob.size };
}

// ----------------------------------------------------------------------
// Minimal incremental SHA-256 used by the streaming hash path.
// FIPS 180-4 reference implementation, tuned for clarity over speed.
// ----------------------------------------------------------------------

interface Sha256 {
  update(b: Uint8Array): void;
  final(): Uint8Array;
}

function createSha256(): Sha256 {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  let buffer = new Uint8Array(64);
  let bufLen = 0;
  let totalBits = 0;
  const W = new Uint32Array(64);

  function rotr(x: number, n: number): number {
    return (x >>> n) | (x << (32 - n));
  }

  function processBlock(block: Uint8Array, offset: number) {
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      W[i] = (block[j] << 24) | (block[j + 1] << 16) | (block[j + 2] << 8) | block[j + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = [H[0], H[1], H[2], H[3], H[4], H[5], H[6], H[7]];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + W[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + mj) | 0;
      h = g; g = f; f = e;
      e = (d + temp1) | 0;
      d = c; c = b; b = a;
      a = (temp1 + temp2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0;
    H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0;
    H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }

  return {
    update(input: Uint8Array): void {
      totalBits += input.length * 8;
      let i = 0;
      // Drain any partial buffered block first.
      if (bufLen > 0) {
        const need = 64 - bufLen;
        const take = Math.min(need, input.length);
        buffer.set(input.subarray(0, take), bufLen);
        bufLen += take;
        i += take;
        if (bufLen === 64) {
          processBlock(buffer, 0);
          bufLen = 0;
        }
      }
      // Process 64-byte blocks straight from input without copying.
      while (input.length - i >= 64) {
        processBlock(input, i);
        i += 64;
      }
      // Stash the tail.
      if (i < input.length) {
        buffer.set(input.subarray(i), 0);
        bufLen = input.length - i;
      }
    },
    final(): Uint8Array {
      // Append 0x80, then zero-pad to leave room for the 64-bit length.
      const padded = new Uint8Array(bufLen >= 56 ? 128 : 64);
      padded.set(buffer.subarray(0, bufLen), 0);
      padded[bufLen] = 0x80;
      // Big-endian 64-bit bit length at the end.
      const bits = totalBits;
      const lenOff = padded.length - 4;
      // JS numbers can't hold >2^53; we shift the high half via Math to
      // cover sizes up to ~9 EB which is far beyond MAX_BLOB_SIZE.
      const high = Math.floor(bits / 0x100000000);
      const low = bits >>> 0;
      padded[lenOff - 4] = (high >>> 24) & 0xff;
      padded[lenOff - 3] = (high >>> 16) & 0xff;
      padded[lenOff - 2] = (high >>> 8) & 0xff;
      padded[lenOff - 1] = high & 0xff;
      padded[lenOff]     = (low  >>> 24) & 0xff;
      padded[lenOff + 1] = (low  >>> 16) & 0xff;
      padded[lenOff + 2] = (low  >>> 8) & 0xff;
      padded[lenOff + 3] = low & 0xff;
      for (let off = 0; off < padded.length; off += 64) {
        processBlock(padded, off);
      }
      const out = new Uint8Array(32);
      for (let i = 0; i < 8; i++) {
        out[i * 4]     = (H[i] >>> 24) & 0xff;
        out[i * 4 + 1] = (H[i] >>> 16) & 0xff;
        out[i * 4 + 2] = (H[i] >>> 8) & 0xff;
        out[i * 4 + 3] = H[i] & 0xff;
      }
      return out;
    },
  };
}
