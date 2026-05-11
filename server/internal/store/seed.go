package store

import (
	"strconv"
	"strings"
	"time"

	"github.com/jincurry/skillhub/server/internal/auth"
)

func (s *Store) seedIfEmpty() error {
	var n int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM skills`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}

	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	users := []struct {
		username, display, role, email, location, bio string
	}{
		{"alice", "Alice Chen", "Maintainer", "alice@example.com", "Shanghai · UTC+8", "Platform engineer · 专注 Go、Kubernetes 和开发者工具。"},
		{"bob", "Bob Wang", "Maintainer", "bob@example.com", "Beijing", "SRE & on-call rotation lead."},
		{"charlie", "Charlie Liu", "Reviewer", "charlie@example.com", "Shenzhen", "Security 团队,IAM / token 流程。"},
		{"diana", "Diana Zhao", "Member", "diana@example.com", "Hangzhou", "Finance ops · 报销流程自动化。"},
		{"frank", "Frank Sun", "Maintainer", "frank@example.com", "Chengdu", "Data team · ETL 与分析平台。"},
		{"system", "System", "Bot", "", "", ""},
	}
	defaultHash, err := auth.HashPassword("password")
	if err != nil {
		return err
	}
	for _, u := range users {
		isAdmin := 0
		if u.username == "alice" {
			isAdmin = 1 // bootstrap admin so AI provider config is reachable
		}
		if _, err := tx.Exec(`INSERT INTO users(username,display,role,team,password_hash,email,bio,location,is_admin)
			VALUES(?,?,?,?,?,?,?,?,?)`,
			u.username, u.display, u.role, "platform-team", defaultHash, u.email, u.bio, u.location, isAdmin); err != nil {
			return err
		}
	}

	namespaces := [][2]string{
		{"platform-team", "alice"},
		{"data-team", "frank"},
		{"sre-team", "bob"},
		{"finance-team", "diana"},
		{"security-team", "charlie"},
		{"frontend-team", "alice"},
		{"product-team", "frank"},
	}
	for _, ns := range namespaces {
		if _, err := tx.Exec(`INSERT INTO namespaces(id,owner) VALUES(?,?)`, ns[0], ns[1]); err != nil {
			return err
		}
	}

	// Namespace membership: owner is "owner"; everyone else gets a default role per ns
	// so that policy routing has enough reviewers. system stays out.
	memberSeed := []struct{ ns, user, role string }{
		{"platform-team", "alice", "owner"},
		{"platform-team", "bob", "maintainer"},
		{"platform-team", "charlie", "reviewer"},
		{"platform-team", "diana", "member"},
		{"platform-team", "frank", "reviewer"},

		{"data-team", "frank", "owner"},
		{"data-team", "alice", "maintainer"},
		{"data-team", "bob", "reviewer"},
		{"data-team", "diana", "member"},

		{"sre-team", "bob", "owner"},
		{"sre-team", "alice", "reviewer"},
		{"sre-team", "charlie", "reviewer"},
		{"sre-team", "frank", "member"},

		{"finance-team", "diana", "owner"},
		{"finance-team", "alice", "maintainer"},
		{"finance-team", "charlie", "reviewer"},
		{"finance-team", "frank", "reviewer"},

		{"security-team", "charlie", "owner"},
		{"security-team", "alice", "reviewer"},
		{"security-team", "bob", "reviewer"},

		{"frontend-team", "alice", "owner"},
		{"frontend-team", "diana", "maintainer"},
		{"frontend-team", "frank", "member"},

		{"product-team", "frank", "owner"},
		{"product-team", "alice", "reviewer"},
		{"product-team", "diana", "member"},
	}
	for _, m := range memberSeed {
		if _, err := tx.Exec(`INSERT INTO namespace_members(ns,username,ns_role) VALUES(?,?,?)`, m.ns, m.user, m.role); err != nil {
			return err
		}
	}

	type seedSkill struct {
		ns, name, desc, longDesc, icon, iconClass, classification, status, version, author string
		rating                                                                              float64
		ratings, activations, delta                                                         int
		hot                                                                                 bool
		tags                                                                                []string
	}
	const goReviewReadme = "## 概述\n\n`go-code-review` 在 PR 合并前对 Go 代码做静态检查 — 错误处理、并发安全、idiomatic 模式、Go 1.21+ generics 边界。\n\n## 何时使用\n\n- 想在 review 前自动捕获常见漏洞\n- 团队有明确的代码风格指引\n\n## 使用示例\n\n```bash\nskillhub run go-code-review --diff origin/main\n```\n\n## 注意事项\n\n* 不会跑测试,只做静态分析\n* 警告级别可在 `.skillhub/config.yaml` 调整\n"
	const goReviewReadmeMD = "# go-code-review\n\nReview Go code for bugs, idiomatic patterns, error handling, and Go 1.21+ generics usage.\n\n## 用法\n\n```bash\nskillhub run go-code-review --diff origin/main\n```\n\n## 规则\n\n- error-wrap: 检查 error 返回是否带上下文\n- nil-deref: 检查指针解引用前的 nil 判断\n- generics-bounds: Go 1.21+ generics 类型约束\n"
	const sqlExplainReadme = "## 概述\n\n解析 SQL 执行计划,标记慢查询、缺失索引、笛卡尔积,并给出改写建议。支持 PostgreSQL / MySQL / Snowflake。\n\n## 适用场景\n\n* DBA 复盘事故\n* 应用工程师在 PR 中带上 query plan 自检\n\n## 使用示例\n\n```sql\nEXPLAIN ANALYZE SELECT ...\n```\n"
	skills := []seedSkill{
		{"platform-team", "go-code-review", "Review Go code for bugs, idiomatic patterns, error handling, and Go 1.21+ generics usage.", goReviewReadme, "Go", "blue", "L2", "published", "1.2.3", "alice", 4.3, 87, 1234, 12, true, []string{"go", "review", "lint"}},
		{"platform-team", "k8s-debug", "Diagnose Kubernetes pod issues from kubectl output.", "", "k8", "blue", "L2", "published", "1.5.0", "alice", 4.6, 64, 612, 8, false, []string{"k8s", "sre", "debug"}},
		{"data-team", "csv-import", "Validate and import CSV files into Snowflake/PG with schema inference.", "", "csv", "green", "L1", "published", "2.0.1", "frank", 4.1, 52, 842, -3, false, []string{"data", "etl"}},
		{"data-team", "sql-explain", "Explain and optimise slow SQL queries.", sqlExplainReadme, "SQ", "green", "L2", "published", "1.1.0", "frank", 4.5, 78, 1502, 18, true, []string{"sql", "data", "perf"}},
		{"sre-team", "incident-postmortem", "Generate post-mortem drafts from PagerDuty + chat transcripts.", "", "PM", "amber", "L2", "published", "1.0.4", "bob", 4.8, 41, 318, 5, false, []string{"sre", "ops"}},
		{"finance-team", "expense-validate", "Cross-check expense reports against policy and receipts.", "", "EX", "violet", "L3", "review", "0.4.0", "diana", 0, 0, 0, 0, false, []string{"finance", "ops"}},
		{"security-team", "auth-audit", "Inspect IAM roles for excessive permissions.", "", "Au", "red", "L3", "published", "1.7.2", "charlie", 4.9, 22, 287, 11, false, []string{"security", "iam"}},
		{"frontend-team", "react-component-review", "Review React component for accessibility & perf.", "", "Rc", "violet", "L1", "published", "0.9.0", "alice", 4.0, 18, 102, -8, false, []string{"react", "frontend", "a11y"}},
		{"platform-team", "deploy-helper", "Helm/Argo deploy helper.", "", "🚀", "violet", "L2", "draft", "0.1.0", "alice", 0, 0, 0, 0, false, []string{"deploy", "k8s"}},
	}
	for _, k := range skills {
		hot := 0
		if k.hot {
			hot = 1
		}
		// Derive ratings_sum so weighted-avg calculations don't see 0.
		ratingsSum := int(k.rating*float64(k.ratings) + 0.5)
		if _, err := tx.Exec(`
			INSERT INTO skills(ns,name,description,long_desc,icon,icon_class,classification,status,version,author,
				rating,ratings_count,ratings_sum,activations,delta_pct,hot,tags_csv,updated_at)
			VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			k.ns, k.name, k.desc, k.longDesc, k.icon, k.iconClass, k.classification, k.status, k.version, k.author,
			k.rating, k.ratings, ratingsSum, k.activations, k.delta, hot, strings.Join(k.tags, ","), time.Now().Add(-time.Duration(len(k.name))*time.Hour),
		); err != nil {
			return err
		}
	}

	// Seed bundle files for every skill so the editor opens to real content
	// even on the freshly-seeded demo DB. Each gets skill.yaml + README.md;
	// go-code-review additionally ships a small rules/ folder so the tree has
	// a non-trivial shape.
	type seedFile struct {
		ns, name, path, content string
	}
	files := []seedFile{
		{"platform-team", "go-code-review", "skill.yaml", "name: go-code-review\nversion: \"1.2.3\"\nnamespace: platform-team\nclassification: L2\n\ndescription: |\n  Review Go code for bugs, idiomatic patterns, error handling, and Go 1.21+\n  generics usage.\n\nruntime:\n  image: \"alpine:3.19\"\n  timeout: 60s\n  memory: \"512Mi\"\n\ntags: [go, review, lint]\n\ninputs:\n  - name: diff\n    type: string\n    required: true\n"},
		{"platform-team", "go-code-review", "README.md", goReviewReadmeMD},
		{"platform-team", "go-code-review", "rules/error-wrap.go", "package rules\n\n// ErrorWrapRule flags errors returned without wrapping context.\nfunc ErrorWrapRule(node Node) []Issue {\n\t// TODO: walk return statements\n\treturn nil\n}\n"},
		{"platform-team", "go-code-review", "rules/nil-deref.go", "package rules\n\n// NilDerefRule flags pointer dereferences without nil checks.\nfunc NilDerefRule(node Node) []Issue { return nil }\n"},
		{"platform-team", "go-code-review", "tests/fixtures.go", "package rules\n\n// minimal test fixtures\nvar fixtures = []string{\n\t\"return err\",\n\t\"return nil\",\n}\n"},
	}
	for _, f := range files {
		if _, err := tx.Exec(`INSERT INTO skill_files(ns, skill_name, path, content, size, updated_by) VALUES(?, ?, ?, ?, ?, ?)`,
			f.ns, f.name, f.path, f.content, len(f.content), "alice"); err != nil {
			return err
		}
	}

	reviews := []struct {
		ns, name, version, class, author, urgency, sla, note string
		reviewers                                            []string
	}{
		{"platform-team", "go-code-review", "1.3.0", "L2", "alice", "soon", "8h", "新增 generics 检查", []string{"bob", "charlie"}},
		{"data-team", "csv-import", "2.1.0", "L1", "frank", "ok", "32h", "支持 GZIP 自动解压", []string{"alice"}},
		{"sre-team", "incident-postmortem", "1.0.5", "L2", "bob", "overdue", "已超时 4h", "增加自动 timeline", []string{"alice", "charlie"}},
		{"finance-team", "expense-validate", "0.5.0", "L3", "diana", "soon", "2h", "L3 密级首次发布", []string{"alice", "charlie", "frank"}},
		{"security-team", "auth-audit", "1.7.3", "L3", "charlie", "ok", "48h", "修复 误报", []string{"alice", "bob"}},
	}
	// Track inserted review ids by "ns/name" so we can wire notifications below
	// to actual reviews instead of hard-coding ids.
	reviewIDs := map[string]int64{}
	for _, r := range reviews {
		res, err := tx.Exec(`
			INSERT INTO reviews(ns,skill_name,version,classification,author,reviewers_csv,status,urgency,sla,note,submitted_at)
			VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
			r.ns, r.name, r.version, r.class, r.author, strings.Join(r.reviewers, ","),
			"pending", r.urgency, r.sla, r.note, time.Now().Add(-12*time.Hour),
		)
		if err != nil {
			return err
		}
		if id, err := res.LastInsertId(); err == nil {
			reviewIDs[r.ns+"/"+r.name] = id
		}
	}

	reviewRef := func(key string) string {
		if id, ok := reviewIDs[key]; ok {
			return strconv.FormatInt(id, 10)
		}
		return ""
	}
	notifs := []struct {
		kind, body, targetKind, targetRef string
		unread                            bool
	}{
		{"review", "你的 platform-team/go-code-review v1.3.0 已请求 @bob @charlie 审批", "review", reviewRef("platform-team/go-code-review"), true},
		{"comment", "@charlie 在 sre-team/incident-postmortem 留下了 2 条评论", "review", reviewRef("sre-team/incident-postmortem"), true},
		{"publish", "data-team/csv-import v2.0.1 已成功发布", "skill", "data-team/csv-import", false},
		{"warn", "security-team/auth-audit 24h 成功率下降到 92%", "skill", "security-team/auth-audit", true},
	}
	for _, n := range notifs {
		u := 0
		if n.unread {
			u = 1
		}
		if _, err := tx.Exec(`INSERT INTO notifications(user,kind,target_kind,target_ref,body,unread,created_at) VALUES(?,?,?,?,?,?,?)`,
			"alice", n.kind, n.targetKind, n.targetRef, n.body, u, time.Now().Add(-time.Hour)); err != nil {
			return err
		}
	}

	logs := []struct{ actor, action, target, version string }{
		{"alice", "submit_review", "platform-team/go-code-review", "v1.3.0"},
		{"bob", "publish", "data-team/csv-import", "v2.0.1"},
		{"bob", "approve_review", "data-team/csv-import", "v2.0.1"},
		{"alice", "create_draft", "platform-team/deploy-helper", "v0.1.0"},
		{"system", "rotate_key", "platform-team", ""},
	}
	for i, l := range logs {
		if _, err := tx.Exec(`INSERT INTO audit_logs(actor,action,target,version,ip,created_at) VALUES(?,?,?,?,?,?)`,
			l.actor, l.action, l.target, l.version, "10.4.21."+itoa(14+i*3), time.Now().Add(-time.Duration(i)*time.Hour)); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	digits := "0123456789"
	out := ""
	for i > 0 {
		out = string(digits[i%10]) + out
		i /= 10
	}
	return out
}
