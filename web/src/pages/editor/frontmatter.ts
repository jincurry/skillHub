// SKILL.md frontmatter helpers. We deliberately keep the parser tiny — only
// scalar `key: value` lines — and quote on output only when a value contains
// characters that would round-trip ambiguously.

export interface ParsedFrontmatter {
  /** Recognized scalar fields. Unparseable lines (lists, nested objects) are
      preserved by leaving the raw region in place when we don't write back. */
  fields: Record<string, string>;
  /** Doc body after the closing fence (or the whole doc when there's no fm). */
  body: string;
  /** True if the doc starts with a `---` block we recognised. */
  hasFrontmatter: boolean;
}

export function parseFrontmatter(src: string): ParsedFrontmatter {
  if (!src.startsWith('---\n') && !src.startsWith('---\r\n')) {
    return { fields: {}, body: src, hasFrontmatter: false };
  }
  const after = src.indexOf('\n', 3) + 1;
  const close = src.indexOf('\n---', after);
  if (close < 0) {
    return { fields: {}, body: src, hasFrontmatter: false };
  }
  const raw = src.slice(after, close);
  let bodyStart = close + 4;            // past "\n---"
  if (src[bodyStart] === '\r') bodyStart++;
  if (src[bodyStart] === '\n') bodyStart++;
  const fields: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
      (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
    ) {
      v = v.slice(1, -1);
    }
    fields[m[1]] = v;
  }
  return { fields, body: src.slice(bodyStart), hasFrontmatter: true };
}

export function serializeFrontmatter(fields: Record<string, string>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === '') {
      lines.push(`${k}: ""`);
      continue;
    }
    const needsQuote = /[:#"']/.test(v) || /^\s|\s$/.test(v) || /^[[{|>|&*!%@`]/.test(v);
    lines.push(`${k}: ${needsQuote ? JSON.stringify(v) : v}`);
  }
  return lines.join('\n');
}

/** Replace the frontmatter region in `src` with `fields`. If `src` had no
    frontmatter, prepend a fresh one. */
export function setFrontmatter(src: string, fields: Record<string, string>): string {
  const yaml = serializeFrontmatter(fields);
  const parsed = parseFrontmatter(src);
  if (parsed.hasFrontmatter) {
    return `---\n${yaml}\n---\n${parsed.body}`;
  }
  return `---\n${yaml}\n---\n\n${src}`;
}

/** Strip frontmatter so the preview pane only renders the document body. */
export function bodyForPreview(src: string): string {
  return parseFrontmatter(src).body;
}
