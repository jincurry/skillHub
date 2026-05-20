// Package templates provides built-in skill scaffolds. A template is a
// named bundle of files (path → content) that the new-skill flow seeds
// instead of the bare SKILL.md scaffold. Every
// template gets variable substitution so authors land on a draft that
// already mentions their skill name and description.
//
// Built-ins are embedded into the binary so the backend stays single-
// binary deployable. Future work could move templates into a DB-backed
// table per organisation; the API contract here is shaped to make that
// drop-in.
package templates

import (
	"strings"
)

// Template is a single skill scaffold.
type Template struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	// Files maps a relative path inside the bundle to its raw text. Use
	// {{name}} and {{description}} as substitution markers.
	Files map[string]string `json:"-"`
}

// Vars are the substitution variables passed to Render.
type Vars struct {
	Name        string
	Description string
}

// Render returns the file map with variables substituted. The returned
// map is a fresh copy so callers may mutate it safely.
func (t *Template) Render(v Vars) map[string]string {
	out := make(map[string]string, len(t.Files))
	rep := strings.NewReplacer(
		"{{name}}", v.Name,
		"{{description}}", v.Description,
	)
	for path, body := range t.Files {
		out[path] = rep.Replace(body)
	}
	return out
}

// All returns every built-in template, in display order. The "blank"
// template is intentionally not in this list — it's the implicit
// default produced by SeedDefaultFiles when no templateId is supplied,
// and keeping it separate avoids a UI footgun where users pick "blank"
// and wonder why a template was even applied.
func All() []*Template {
	return []*Template{
		codeReviewTemplate(),
		docExtractTemplate(),
		workflowTemplate(),
	}
}

// Get returns the template with the given id, or nil if not found.
func Get(id string) *Template {
	for _, t := range All() {
		if t.ID == id {
			return t
		}
	}
	return nil
}

// ── built-ins ─────────────────────────────────────────────────────────

func codeReviewTemplate() *Template {
	return &Template{
		ID:          "code-review",
		Name:        "代码审查",
		Description: "针对某种语言/框架的代码 review skill 骨架，含触发条件、检查清单与示例。",
		Files: map[string]string{
			"SKILL.md": `---
name: {{name}}
description: {{description}}
license: Apache-2.0
---

# {{name}}

{{description}}

## 何时使用

- 用户请求 review .go / .py / .ts 等代码文件时
- 评审 PR diff 时

## 检查清单

- [ ] 命名清晰：函数 / 变量名是否表意
- [ ] 错误处理：是否吞错或忽略 err
- [ ] 复杂度：是否需要拆分函数 / 提前 return
- [ ] 测试：关键路径是否覆盖
- [ ] 性能：是否有 O(n²) 或不必要的内存分配

## 输出格式

按"严重程度 + 文件:行 + 一句话"逐条列出问题，结尾给整体结论。
`,
			"references/style-guide.md": `# 团队代码风格

补充团队约定（命名、目录结构、测试要求）。
`,
		},
	}
}

func docExtractTemplate() *Template {
	return &Template{
		ID:          "doc-extract",
		Name:        "文档提取",
		Description: "从长篇技术文档中抽取结构化字段（API endpoint、参数、错误码）的 skill 骨架。",
		Files: map[string]string{
			"SKILL.md": `---
name: {{name}}
description: {{description}}
license: Apache-2.0
---

# {{name}}

{{description}}

## 何时使用

- 输入是一段 README / RFC / 设计文档
- 用户希望抽取出 API、表结构、错误码或配置项

## 抽取规则

- API：method + path + 参数 + 返回类型
- 错误码：code + 含义 + 建议处理
- 配置项：键 + 类型 + 默认值 + 是否必需

## 输出格式

输出 Markdown 表格或 YAML 数组，由用户原始 query 决定。如果用户没指定，
默认表格。
`,
			"references/example-input.md": `# 示例输入

放一份典型的源文档，便于回归测试 skill 的抽取效果。
`,
		},
	}
}

func workflowTemplate() *Template {
	return &Template{
		ID:          "workflow",
		Name:        "工作流编排",
		Description: "把多步骤操作（拉数据 → 调 API → 生成报表）封装成一个可重复执行的 skill。",
		Files: map[string]string{
			"SKILL.md": `---
name: {{name}}
description: {{description}}
license: Apache-2.0
---

# {{name}}

{{description}}

## 何时使用

- 用户描述一个跨多步骤的目标（如"从 BigQuery 拉昨日数据并发到 Slack"）
- 步骤之间存在数据依赖

## 步骤模板

1. **采集**：明确输入源（DB / API / 文件）
2. **转换**：清洗、聚合、对齐
3. **执行**：调用下游系统（Slack / 邮件 / 工单）
4. **校验**：检查结果，必要时重试

## 失败处理

每一步都说明：可重试 / 不可重试 / 需要人工介入。

## 脚本

可执行代码放在 ` + "`scripts/`" + `，例如 ` + "`scripts/run.py`" + `。
`,
			"scripts/run.py": `#!/usr/bin/env python3
"""{{name}} — {{description}}"""


def main() -> None:
    raise NotImplementedError("implement steps 1-4 from SKILL.md")


if __name__ == "__main__":
    main()
`,
		},
	}
}
