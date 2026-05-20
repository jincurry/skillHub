import type { StdDirKey } from './constants';

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

// --------- recommended-dir seeding --------------------------------------

// Quick-create stub for a missing recommended dir. We seed the dir with a
// short index.md so the directory actually exists in storage (the backend has
// no concept of empty dirs) and so the file gives the maintainer a hint about
// what to put there.
export function seedFileForDir(d: StdDirKey, name: string): { path: string; content: string } {
  switch (d) {
    case 'scripts':
      return {
        path: 'scripts/index.md',
        content: '# scripts/\n\n可执行脚本（Python / Shell / TypeScript）。\n\n约定:\n- 第一个 shebang 行声明解释器\n- 每个脚本都应能独立运行\n',
      };
    case 'references':
      return {
        path: 'references/index.md',
        content: '# references/\n\n参考资料与长篇说明文档放在这里。SKILL.md 应当只放最关键的指引，详细内容链接到这里。\n',
      };
    case 'assets':
      return {
        path: 'assets/index.md',
        content: '# assets/\n\n模板、Prompt 片段、静态资源（JSON / YAML / 图片等）放在这里。\n',
      };
  }
  // Unreachable but TS demands the path.
  return { path: `${name}/index.md`, content: `# ${name}/\n` };
}
