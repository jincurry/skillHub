// File-related helpers shared across the editor and review-diff views.

/**
 * Map a path to a Monaco language id. Used for both the regular editor and
 * the review diff editor so syntax highlighting agrees between the two.
 */
export function languageFor(path: string): string {
  const ext = path.toLowerCase().split('.').pop() || '';
  switch (ext) {
    case 'yaml':
    case 'yml': return 'yaml';
    case 'md':
    case 'markdown': return 'markdown';
    case 'json': return 'json';
    case 'go': return 'go';
    case 'py': return 'python';
    case 'ts':
    case 'tsx': return 'typescript';
    case 'js':
    case 'jsx': return 'javascript';
    case 'sh':
    case 'bash': return 'shell';
    case 'sql': return 'sql';
    case 'toml': return 'toml';
    case 'dockerfile': return 'dockerfile';
    default:
      return path.toLowerCase().endsWith('dockerfile') ? 'dockerfile' : 'plaintext';
  }
}

export function isRootReadme(path: string): boolean {
  return path.toLowerCase() === 'readme.md';
}

export function shouldDisplaySkillFile(path: string): boolean {
  return !isRootReadme(path);
}

/** Extensions that the editor is willing to load as inline text (Monaco-
 *  editable). Anything else uploaded gets routed through the blob protocol
 *  so we never call file.text() on it (which would corrupt binary data and
 *  blow up the JS heap on large files). Mirrors `isTextFile` in
 *  server/internal/store/merge.go plus the few common scripting languages
 *  the editor knows how to highlight. */
const INLINE_TEXT_EXTS = new Set([
  '.md', '.markdown',
  '.yaml', '.yml',
  '.json', '.toml',
  '.sh', '.bash',
  '.txt',
  '.py', '.go', '.rs',
  '.js', '.jsx', '.ts', '.tsx',
  '.html', '.css',
  '.sql',
]);

/** Files at or above this size go through the blob protocol regardless of
 *  extension, so the upload path can never JSON-encode a multi-MB body and
 *  blow up the tab. The server's inline cap is 1 MiB; we stay well below
 *  that to leave headroom for JSON / fetch buffers. */
export const INLINE_UPLOAD_MAX = 256 * 1024;

/** Decide whether an uploaded File should take the inline (Monaco-editable)
 *  path or be stored as a blob. The blob path is the safe default; the
 *  inline path is only chosen when the file is both small AND likely text. */
export function shouldUploadInline(file: File): boolean {
  if (file.size > INLINE_UPLOAD_MAX) return false;
  const lastDot = file.name.lastIndexOf('.');
  if (lastDot < 0) return false;
  return INLINE_TEXT_EXTS.has(file.name.slice(lastDot).toLowerCase());
}

/** Format a byte count for display. Used by the binary-file placeholder. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
