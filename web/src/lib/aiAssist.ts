// SSE client for the editor's AI assistant.
//
// We can't use EventSource because it doesn't support custom Authorization
// headers, and we need to send the Bearer token. Instead we drive a fetch()
// request with `Accept: text/event-stream`, then parse the response body as
// a ReadableStream of bytes split on the SSE \n\n boundary.
//
// The server speaks a tiny dialect:
//   data: {"delta":"...some text..."}\n\n   ← any number of these
//   data: {"done":true}\n\n                  ← terminator
// Plus optional error events:
//   event: error\ndata: {"error":"..."}\n\n
import { getToken } from '../api/auth';
import type { AIAssistRequest } from '../api/types';

export interface AssistCallbacks {
  /** Called for every incremental token. Concatenate to assemble the full output. */
  onDelta: (chunk: string) => void;
  /** Called once when the stream terminates cleanly. */
  onDone?: () => void;
  /**
   * Called on any failure: HTTP-level (non-2xx response, network drop, abort)
   * or stream-level (event: error frame). Mutually exclusive with onDone.
   */
  onError?: (message: string) => void;
}

export interface AssistHandle {
  /** Aborts the in-flight request; safe to call after completion (no-op). */
  abort: () => void;
}

/**
 * runAssist starts a streaming AI assist call against the given skill and
 * returns a handle for cancellation. Caller is responsible for keeping the
 * handle alive until the stream finishes.
 */
export function runAssist(
  ns: string,
  name: string,
  body: AIAssistRequest,
  cb: AssistCallbacks,
): AssistHandle {
  const ctl = new AbortController();
  const tok = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (tok) headers.Authorization = `Bearer ${tok}`;

  const url = `/api/v1/ai/skills/${encodeURIComponent(ns)}/${encodeURIComponent(name)}/assist`;

  // Kick off the request asynchronously. We don't await here because the
  // caller wants the abort handle right away.
  (async () => {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
    } catch (e) {
      // AbortError comes through here when the user clicks "stop".
      if ((e as Error).name === 'AbortError') return;
      cb.onError?.((e as Error).message);
      return;
    }

    if (!res.ok || !res.body) {
      // Errors before the stream starts arrive as JSON, not SSE.
      let detail = `${res.status} ${res.statusText}`;
      try {
        const j = await res.json() as { error?: string };
        if (j?.error) detail = j.error;
      } catch { /* ignore: non-JSON body */ }
      cb.onError?.(detail);
      return;
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder('utf-8');
    let buf = '';
    let sawError = false;

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });

        // SSE frames are separated by a blank line. Keep the trailing
        // partial frame in the buffer for the next read.
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const parsed = parseFrame(frame);
          if (!parsed) continue;
          if (parsed.event === 'error') {
            sawError = true;
            cb.onError?.(parsed.data?.error ?? 'unknown error');
            // Don't break — let the server close the stream cleanly.
          } else if (parsed.data?.done) {
            // Server marker for end-of-stream. The reader will hit `done`
            // on its own once the connection actually closes.
          } else if (typeof parsed.data?.delta === 'string') {
            cb.onDelta(parsed.data.delta);
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        cb.onError?.((e as Error).message);
        return;
      }
      return; // user aborted
    }

    if (!sawError) cb.onDone?.();
  })();

  return { abort: () => ctl.abort() };
}

interface ParsedFrame {
  event: string; // 'message' by default
  data: { delta?: string; done?: boolean; error?: string } | null;
}

// parseFrame turns one raw "event: foo\ndata: {...}" block into an event +
// JSON-decoded payload. Frames without a JSON `data:` line are dropped.
function parseFrame(frame: string): ParsedFrame | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
    // anything else (empty line, id:, retry:, comments) → ignored
  }
  if (dataLines.length === 0) return null;
  const raw = dataLines.join('\n');
  try {
    return { event, data: JSON.parse(raw) };
  } catch {
    return { event, data: null };
  }
}
