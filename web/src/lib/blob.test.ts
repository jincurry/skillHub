// @vitest-environment node
//
// Lock down the streaming SHA-256 path in lib/blob.ts. The big-file path can't
// piggy-back on crypto.subtle.digest because the WebCrypto API doesn't expose
// update / final, so we implemented FIPS 180-4 by hand. A mistake there would
// silently corrupt every large upload — the server rehashes on receipt, so a
// hash mismatch becomes a confusing 422 in the editor instead of an obvious
// "your hash function is broken".
//
// Tests run under the `node` env (not jsdom). We rely on the global
// `crypto.subtle` exposed by Node 19+ (matching the browser) so the test
// imports stay browser-tsconfig-compatible — `node:crypto` would break the
// production tsc build.

import { describe, expect, it } from 'vitest';
import { sha256OfBlob } from './blob';

// FIPS 180-4 known-answer vectors.
const VECTORS: { name: string; input: () => Uint8Array; sha: string }[] = [
  {
    name: 'empty',
    input: () => new Uint8Array(0),
    sha: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  },
  {
    name: 'abc',
    input: () => new TextEncoder().encode('abc'),
    sha: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  },
  {
    name: '448-bit message (multi-block)',
    input: () => new TextEncoder().encode(
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    ),
    sha: '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  },
  {
    name: 'one million a',
    // FIPS 180-4 big-vector input. ~1 MB so it still fits the subtle.digest
    // branch but exercises >16-block message scheduling internally if we
    // ever flipped the threshold lower for debugging.
    input: () => {
      const a = new Uint8Array(1_000_000);
      a.fill(0x61);
      return a;
    },
    sha: 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
  },
];

/** Hex-encode an ArrayBuffer for cross-checking. */
function digestHex(buf: ArrayBuffer): string {
  const view = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < view.length; i++) s += view[i].toString(16).padStart(2, '0');
  return s;
}

describe('sha256OfBlob', () => {
  for (const v of VECTORS) {
    it(`hashes ${v.name}`, async () => {
      const bytes = v.input();
      // Wrap the typed array as a plain Uint8Array so the BlobPart type
      // inference doesn't trip over the parameterised ArrayBufferLike.
      const blob = new Blob([new Uint8Array(bytes)]);
      expect(await sha256OfBlob(blob)).toBe(v.sha);
    });
  }

  it('streaming JS implementation matches WebCrypto reference for 33MB blob', async () => {
    // Build 33 MB by repeating a known 1 MB vector. This crosses the
    // 32 MB threshold inside sha256OfBlob, forcing the JS update / final
    // path. WebCrypto on the same buffer gives an independent reference.
    const oneMillionA = new Uint8Array(1_000_000);
    oneMillionA.fill(0x61);
    const parts: BlobPart[] = [];
    for (let i = 0; i < 33; i++) parts.push(new Uint8Array(oneMillionA));
    const blob = new Blob(parts);

    const refDigest = await crypto.subtle.digest(
      'SHA-256',
      await blob.arrayBuffer(),
    );
    const expected = digestHex(refDigest);

    expect(await sha256OfBlob(blob)).toBe(expected);
  });
});
