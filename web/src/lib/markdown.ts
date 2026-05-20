// Tiny dependency-free Markdown renderer. Handles headings, lists, paragraphs,
// fenced code blocks, GFM pipe tables, inline code, bold/italic, and links.
// User content is HTML-escaped before any markdown transforms run, so the
// result is safe to hand to dangerouslySetInnerHTML.

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]);
}

function renderInline(s: string): string {
  let out = escapeHtml(s);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => {
    const safe = /^https?:\/\//.test(href) ? href : '#';
    return `<a href="${safe}" target="_blank" rel="noopener">${label}</a>`;
  });
  return out;
}

// Split a single GFM pipe-table row into cells. Strips the optional leading
// and trailing pipes, then splits on `|` while honouring `\|` escapes.
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') {
      buf += '|';
      i++;
      continue;
    }
    if (ch === '|') {
      cells.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  cells.push(buf.trim());
  return cells;
}

// Returns the alignment list if `line` is a valid GFM table separator
// (e.g. `| --- | :---: | ---: |`), otherwise null.
function parseAlignRow(line: string): (string | null)[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes('|') && !trimmed.includes('-')) return null;
  // Must be entirely made of pipes, dashes, colons, and whitespace.
  if (!/^[\s|:-]+$/.test(trimmed)) return null;
  const cells = splitRow(trimmed);
  if (cells.length === 0) return null;
  const aligns: (string | null)[] = [];
  for (const cell of cells) {
    const m = cell.match(/^(:?)-{3,}(:?)$/);
    if (!m) return null;
    const left = m[1] === ':';
    const right = m[2] === ':';
    if (left && right) aligns.push('center');
    else if (right) aligns.push('right');
    else if (left) aligns.push('left');
    else aligns.push(null);
  }
  return aligns;
}

// Looks like a table header? Must contain a pipe and not be a code fence.
function looksLikeTableHeader(line: string): boolean {
  if (!line.includes('|')) return false;
  if (/^\s*```/.test(line)) return false;
  return true;
}

export function renderMarkdown(src: string): string {
  if (!src) return '';
  const lines = src.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1] || '';
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      out.push(`<pre><code class="language-${escapeHtml(lang)}">${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i++;
      continue;
    }
    // GFM pipe table: header line + separator + zero or more body rows.
    // We only commit if the next line is a valid alignment row, otherwise
    // fall through to paragraph handling.
    if (looksLikeTableHeader(line) && i + 1 < lines.length) {
      const aligns = parseAlignRow(lines[i + 1]);
      if (aligns) {
        const headers = splitRow(line);
        // Pad / truncate so header count matches the alignment row.
        const colCount = aligns.length;
        const padHeaders = headers.slice(0, colCount);
        while (padHeaders.length < colCount) padHeaders.push('');
        const headHtml = padHeaders.map((cell, idx) => {
          const a = aligns[idx];
          const style = a ? ` style="text-align:${a}"` : '';
          return `<th${style}>${renderInline(cell)}</th>`;
        }).join('');
        const bodyRows: string[] = [];
        i += 2;
        while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
          const cells = splitRow(lines[i]);
          const padded = cells.slice(0, colCount);
          while (padded.length < colCount) padded.push('');
          const rowHtml = padded.map((cell, idx) => {
            const a = aligns[idx];
            const style = a ? ` style="text-align:${a}"` : '';
            return `<td${style}>${renderInline(cell)}</td>`;
          }).join('');
          bodyRows.push(`<tr>${rowHtml}</tr>`);
          i++;
        }
        const bodyHtml = bodyRows.length ? `<tbody>${bodyRows.join('')}</tbody>` : '';
        out.push(`<table><thead><tr>${headHtml}</tr></thead>${bodyHtml}</table>`);
        continue;
      }
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }
    if (line.trim() === '') {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^(#|```|[-*]\s|\d+\.\s)/.test(lines[i])) {
      para.push(renderInline(lines[i]));
      i++;
    }
    out.push(`<p>${para.join(' ')}</p>`);
  }
  return out.join('\n');
}
