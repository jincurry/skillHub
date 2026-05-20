// Static data and configuration shared across the skill editor modules.

export const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

// Only SKILL.md is pinned — it's the bundle's canonical entry point and the
// validate pass treats its absence as a blocker. skill.yaml is a useful
// default but the author can delete it if they want a different structure.
export const REQUIRED_FILES = new Set(['SKILL.md']);

// Recommended skill-bundle layout (matches the Anthropic skill spec).
// We surface these in the file tree (always visible, even when empty) and in
// the side-panel Bundle Structure card.
export const STD_DIRS = [
  { key: 'scripts', label: 'scripts', desc: '可执行脚本（.py / .sh / .ts …）', icon: '🔧' },
  { key: 'references', label: 'references', desc: '参考文档与长篇说明', icon: '📚' },
  { key: 'assets', label: 'assets', desc: '模板与静态资源', icon: '🎨' },
] as const;
export type StdDirKey = (typeof STD_DIRS)[number]['key'];

export const STD_DIR_KEYS = new Set<string>(STD_DIRS.map((d) => d.key));

// Default seed contents used by the "Create dir" shortcut and the categorized
// template list in the new-file dialog. The path is the file we'll actually
// create; the content is what gets PUT to it.
export interface FileTemplate {
  path: string;
  content?: string;
  desc?: string;
}

export const TEMPLATE_GROUPS: { title: string; items: FileTemplate[] }[] = [
  {
    title: '核心',
    items: [
      {
        path: 'SKILL.md',
        desc: '元数据 + 说明（推荐入口）',
        content:
          '---\nname: my-skill\ndescription: (一句话描述)\nlicense: Apache-2.0\n---\n\n' +
          '# my-skill\n\n## 何时使用\n\n- \n\n## 使用方式\n\n## 脚本\n\n## 参考资料\n\n## 资源\n',
      },
    ],
  },
  {
    title: '🔧 scripts/ · 脚本',
    items: [
      {
        path: 'scripts/main.py',
        desc: 'Python 入口',
        content: '#!/usr/bin/env python3\n"""Entry point for this skill."""\n\n\ndef main() -> None:\n    pass\n\n\nif __name__ == "__main__":\n    main()\n',
      },
      {
        path: 'scripts/run.sh',
        desc: 'Shell 入口',
        content: '#!/usr/bin/env bash\nset -euo pipefail\n\n# Entry point — replace with your logic.\necho "hello from skill"\n',
      },
    ],
  },
  {
    title: '📚 references/ · 参考',
    items: [
      { path: 'references/api.md', desc: 'API / 数据规约', content: '# API 规约\n\n## 输入\n\n## 输出\n' },
      { path: 'references/notes.md', desc: '设计笔记', content: '# 设计笔记\n' },
    ],
  },
  {
    title: '🎨 assets/ · 资源',
    items: [
      { path: 'assets/template.json', desc: 'JSON 模板', content: '{\n  "example": true\n}\n' },
      { path: 'assets/prompt.md', desc: 'Prompt 模板', content: '# Prompt 模板\n\n你是一个 ...\n' },
    ],
  },
  {
    title: '其他',
    items: [
      { path: 'docs/usage.md', desc: '使用说明' },
      { path: 'examples/basic.md', desc: '示例' },
      { path: 'tests/fixtures.md', desc: '测试夹具' },
    ],
  },
];

// Debounce window for the network autosave. The localStorage backup is
// written eagerly on every buffer change since it's cheap.
export const AUTOSAVE_MS = 1500;
