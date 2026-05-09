package validate

import (
	"regexp"
	"strings"

	"github.com/jincurry/skillhub/server/internal/model"
)

type Severity string

const (
	SevOK   Severity = "ok"
	SevWarn Severity = "warn"
	SevErr  Severity = "err"
)

type Check struct {
	ID       string   `json:"id"`
	Label    string   `json:"label"`
	Severity Severity `json:"severity"`
	Detail   string   `json:"detail,omitempty"`
}

type Report struct {
	Skill   string  `json:"skill"`
	Version string  `json:"version"`
	Score   int     `json:"score"`
	Summary string  `json:"summary"`
	Checks  []Check `json:"checks"`
}

var (
	reSecret = regexp.MustCompile(`(?i)(api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"']{12,}["']`)
	reName   = regexp.MustCompile(`^[a-z][a-z0-9-]{1,40}$`)
)

// Run computes a validation report for a skill snapshot.
func Run(s *model.Skill) Report {
	var checks []Check

	// 1. schema: required fields
	missing := []string{}
	if s.Name == "" {
		missing = append(missing, "name")
	}
	if s.Description == "" {
		missing = append(missing, "description")
	}
	if s.Classification == "" {
		missing = append(missing, "classification")
	}
	if len(missing) == 0 {
		checks = append(checks, Check{ID: "schema", Label: "Schema 校验", Severity: SevOK, Detail: "所有必填字段就绪"})
	} else {
		checks = append(checks, Check{ID: "schema", Label: "Schema 校验", Severity: SevErr, Detail: "缺失字段: " + strings.Join(missing, ", ")})
	}

	// 2. name format
	if reName.MatchString(s.Name) {
		checks = append(checks, Check{ID: "name", Label: "命名规范", Severity: SevOK, Detail: "符合 kebab-case"})
	} else {
		checks = append(checks, Check{ID: "name", Label: "命名规范", Severity: SevErr, Detail: "需 kebab-case,长度 2-41"})
	}

	// 3. secret scan (over desc + tags)
	hay := s.Description + " " + strings.Join(s.Tags, " ")
	if reSecret.MatchString(hay) {
		checks = append(checks, Check{ID: "secret", Label: "Secret 扫描", Severity: SevErr, Detail: "检测到疑似密钥"})
	} else {
		checks = append(checks, Check{ID: "secret", Label: "Secret 扫描", Severity: SevOK, Detail: "未发现敏感字符串"})
	}

	// 4. classification policy
	switch s.Classification {
	case "L3":
		checks = append(checks, Check{ID: "policy", Label: "密级策略", Severity: SevWarn, Detail: "L3 需 2 名 maintainer 双审"})
	case "L2", "L1":
		checks = append(checks, Check{ID: "policy", Label: "密级策略", Severity: SevOK, Detail: s.Classification + " 仅需单审"})
	default:
		checks = append(checks, Check{ID: "policy", Label: "密级策略", Severity: SevErr, Detail: "未设置密级"})
	}

	// 5. tags count
	switch n := len(s.Tags); {
	case n == 0:
		checks = append(checks, Check{ID: "tags", Label: "标签覆盖", Severity: SevWarn, Detail: "建议至少 2 个标签"})
	case n < 2:
		checks = append(checks, Check{ID: "tags", Label: "标签覆盖", Severity: SevWarn, Detail: "仅 1 个标签"})
	default:
		checks = append(checks, Check{ID: "tags", Label: "标签覆盖", Severity: SevOK, Detail: "已设置 " + itoa(n) + " 个标签"})
	}

	// 6. description quality
	switch n := len(s.Description); {
	case n == 0:
		checks = append(checks, Check{ID: "desc", Label: "描述完整度", Severity: SevErr, Detail: "描述为空"})
	case n < 30:
		checks = append(checks, Check{ID: "desc", Label: "描述完整度", Severity: SevWarn, Detail: "描述过短 (<30 字符)"})
	default:
		checks = append(checks, Check{ID: "desc", Label: "描述完整度", Severity: SevOK, Detail: itoa(n) + " 字符"})
	}

	r := Report{Skill: s.Namespace + "/" + s.Name, Version: "v" + s.Version, Checks: checks}
	r.Score = score(checks)
	r.Summary = summary(checks)
	return r
}

func score(cs []Check) int {
	total := 100
	for _, c := range cs {
		switch c.Severity {
		case SevErr:
			total -= 20
		case SevWarn:
			total -= 5
		}
	}
	if total < 0 {
		total = 0
	}
	return total
}

func summary(cs []Check) string {
	ok, warn, err := 0, 0, 0
	for _, c := range cs {
		switch c.Severity {
		case SevOK:
			ok++
		case SevWarn:
			warn++
		case SevErr:
			err++
		}
	}
	if err > 0 {
		return itoa(err) + " 错误 · " + itoa(warn) + " 警告"
	}
	if warn > 0 {
		return itoa(warn) + " 警告 · 可发布"
	}
	return "全部通过 · " + itoa(ok) + " 项"
}

// HasBlocker returns true if any check has severity err.
func (r Report) HasBlocker() bool {
	for _, c := range r.Checks {
		if c.Severity == SevErr {
			return true
		}
	}
	return false
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	buf := [20]byte{}
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
