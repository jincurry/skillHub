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
