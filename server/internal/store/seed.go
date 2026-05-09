package store

import (
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

	users := [][3]string{
		{"alice", "Alice Chen", "Maintainer"},
		{"bob", "Bob Wang", "Maintainer"},
		{"charlie", "Charlie Liu", "Reviewer"},
		{"diana", "Diana Zhao", "Member"},
		{"frank", "Frank Sun", "Maintainer"},
		{"system", "System", "Bot"},
	}
	defaultHash, err := auth.HashPassword("password")
	if err != nil {
		return err
	}
	for _, u := range users {
		if _, err := tx.Exec(`INSERT INTO users(username,display,role,team,password_hash) VALUES(?,?,?,?,?)`,
			u[0], u[1], u[2], "platform-team", defaultHash); err != nil {
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
		ns, name, desc, icon, iconClass, classification, status, version, author string
		rating                                                                   float64
		ratings, activations, delta                                              int
		hot                                                                      bool
		tags                                                                     []string
	}
	skills := []seedSkill{
		{"platform-team", "go-code-review", "Review Go code for bugs, idiomatic patterns, error handling, and Go 1.21+ generics usage.", "Go", "blue", "L2", "published", "1.2.3", "alice", 4.3, 87, 1234, 12, true, []string{"go", "review", "lint"}},
		{"platform-team", "k8s-debug", "Diagnose Kubernetes pod issues from kubectl output.", "k8", "blue", "L2", "published", "1.5.0", "alice", 4.6, 64, 612, 8, false, []string{"k8s", "sre", "debug"}},
		{"data-team", "csv-import", "Validate and import CSV files into Snowflake/PG with schema inference.", "csv", "green", "L1", "published", "2.0.1", "frank", 4.1, 52, 842, -3, false, []string{"data", "etl"}},
		{"data-team", "sql-explain", "Explain and optimise slow SQL queries.", "SQ", "green", "L2", "published", "1.1.0", "frank", 4.5, 78, 1502, 18, true, []string{"sql", "data", "perf"}},
		{"sre-team", "incident-postmortem", "Generate post-mortem drafts from PagerDuty + chat transcripts.", "PM", "amber", "L2", "published", "1.0.4", "bob", 4.8, 41, 318, 5, false, []string{"sre", "ops"}},
		{"finance-team", "expense-validate", "Cross-check expense reports against policy and receipts.", "EX", "violet", "L3", "review", "0.4.0", "diana", 0, 0, 0, 0, false, []string{"finance", "ops"}},
		{"security-team", "auth-audit", "Inspect IAM roles for excessive permissions.", "Au", "red", "L3", "published", "1.7.2", "charlie", 4.9, 22, 287, 11, false, []string{"security", "iam"}},
		{"frontend-team", "react-component-review", "Review React component for accessibility & perf.", "Rc", "violet", "L1", "published", "0.9.0", "alice", 4.0, 18, 102, -8, false, []string{"react", "frontend", "a11y"}},
		{"platform-team", "deploy-helper", "Helm/Argo deploy helper.", "🚀", "violet", "L2", "draft", "0.1.0", "alice", 0, 0, 0, 0, false, []string{"deploy", "k8s"}},
	}
	for _, k := range skills {
		hot := 0
		if k.hot {
			hot = 1
		}
		if _, err := tx.Exec(`
			INSERT INTO skills(ns,name,description,icon,icon_class,classification,status,version,author,
				rating,ratings_count,activations,delta_pct,hot,tags_csv,updated_at)
			VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			k.ns, k.name, k.desc, k.icon, k.iconClass, k.classification, k.status, k.version, k.author,
			k.rating, k.ratings, k.activations, k.delta, hot, strings.Join(k.tags, ","), time.Now().Add(-time.Duration(len(k.name))*time.Hour),
		); err != nil {
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
	for _, r := range reviews {
		if _, err := tx.Exec(`
			INSERT INTO reviews(ns,skill_name,version,classification,author,reviewers_csv,status,urgency,sla,note,submitted_at)
			VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
			r.ns, r.name, r.version, r.class, r.author, strings.Join(r.reviewers, ","),
			"pending", r.urgency, r.sla, r.note, time.Now().Add(-12*time.Hour),
		); err != nil {
			return err
		}
	}

	notifs := []struct {
		kind, body string
		unread     bool
	}{
		{"review", "你的 platform-team/go-code-review v1.3.0 已请求 @bob @charlie 审批", true},
		{"comment", "@charlie 在 sre-team/incident-postmortem 留下了 2 条评论", true},
		{"publish", "data-team/csv-import v2.0.1 已成功发布", false},
		{"warn", "security-team/auth-audit 24h 成功率下降到 92%", true},
	}
	for _, n := range notifs {
		u := 0
		if n.unread {
			u = 1
		}
		if _, err := tx.Exec(`INSERT INTO notifications(user,kind,body,unread,created_at) VALUES(?,?,?,?,?)`,
			"alice", n.kind, n.body, u, time.Now().Add(-time.Hour)); err != nil {
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
