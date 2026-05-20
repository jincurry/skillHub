// --------- semver -------------------------------------------------------

export type SemverBump = 'patch' | 'minor' | 'major';

// Parse a semver-ish version into its three numeric components plus an
// optional pre-release tail (so `1.2.3-beta.4` survives intact). We don't
// try to be a full semver parser — just "good enough" to bump correctly.
export function parseSemver(v: string): { maj: number; min: number; patch: number; tail: string } | null {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (!m) return null;
  return { maj: +m[1], min: +m[2], patch: +m[3], tail: m[4] || '' };
}

export function bumpVersion(current?: string, kind: SemverBump = 'patch'): string {
  if (!current) return '0.1.0';
  const p = parseSemver(current);
  if (!p) return current;
  // We deliberately drop the pre-release tail on a bump — semver says a
  // pre-release is "less than" the release, so 1.2.3-beta + patch must
  // become 1.2.4, not 1.2.4-beta.
  switch (kind) {
    case 'major': return `${p.maj + 1}.0.0`;
    case 'minor': return `${p.maj}.${p.min + 1}.0`;
    default:      return `${p.maj}.${p.min}.${p.patch + 1}`;
  }
}

// --------- icons --------------------------------------------------------

export function dirIconFor(name: string): string {
  switch (name) {
    case 'scripts': return '🔧';
    case 'references': return '📚';
    case 'assets': return '🎨';
    case 'docs': return '📘';
    case 'examples': return '💡';
    case 'tests': return '🧪';
    default: return '📁';
  }
}

export function iconFor(path: string): string {
  const ext = path.toLowerCase().split('.').pop() || '';
  if (ext === 'yaml' || ext === 'yml') return '⚙️';
  if (ext === 'md') return '📝';
  if (ext === 'go' || ext === 'py' || ext === 'ts' || ext === 'js' || ext === 'sh') return '🔧';
  if (ext === 'json' || ext === 'toml') return '🧾';
  return '📄';
}

// --------- localStorage drafts ------------------------------------------

// Draft backup keys live under one namespace so we can sweep them later
// (e.g. on logout) without hitting unrelated keys.
export function draftKeyFor(ns: string, name: string, path: string): string {
  return `skillHub:draft:${ns}/${name}/${path}`;
}

