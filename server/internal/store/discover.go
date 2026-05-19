package store

import (
	"strings"

	"github.com/jincurry/skillhub/server/internal/model"
)

// Achievements computes a fixed set of badges for the user from existing data.
// Server-side so the rules stay consistent across UIs and so the "earned"
// thresholds can change without a frontend deploy.
func (s *Store) Achievements(username string) ([]model.Achievement, error) {
	stats, err := s.MeStats(username)
	if err != nil {
		return nil, err
	}

	var distinctNs int
	if err := s.DB.QueryRow(`SELECT COUNT(DISTINCT ns) FROM skills WHERE author = ?`, username).Scan(&distinctNs); err != nil {
		return nil, err
	}

	var maxActivations int
	if err := s.DB.QueryRow(`SELECT COALESCE(MAX(activations), 0) FROM skills WHERE author = ?`, username).Scan(&maxActivations); err != nil {
		return nil, err
	}

	var l3Count int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM skills WHERE author = ? AND classification = 'L3' AND status = 'published'`, username).Scan(&l3Count); err != nil {
		return nil, err
	}

	var docCount int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM skills WHERE author = ? AND length(long_desc) >= 80`, username).Scan(&docCount); err != nil {
		return nil, err
	}

	var unhealthy int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM skills WHERE author = ? AND status IN ('deprecated','yanked')`, username).Scan(&unhealthy); err != nil {
		return nil, err
	}

	progress := func(have, need int) float64 {
		if need <= 0 || have >= need {
			return 1
		}
		return float64(have) / float64(need)
	}

	out := []model.Achievement{
		{
			ID: "first_publish", Name: "首次发布", Desc: "发布了你的第一个 skill", Icon: "🚀",
			Earned: stats.Published >= 1, Progress: progress(stats.Published, 1),
			Hint: "去 Skills 创建并提交你的第一个 skill",
		},
		{
			ID: "hundred_activations", Name: "百次激活", Desc: "单个 skill 周激活突破 100", Icon: "🎯",
			Earned: maxActivations >= 100, Progress: progress(maxActivations, 100),
		},
		{
			ID: "thousand_activations", Name: "千人之师", Desc: "累计激活突破 1,000", Icon: "📚",
			Earned: stats.Activations >= 1000, Progress: progress(stats.Activations, 1000),
		},
		{
			ID: "million_activations", Name: "百万激活", Desc: "累计激活突破 1,000,000", Icon: "💎",
			Earned: stats.Activations >= 1_000_000, Progress: progress(stats.Activations, 1_000_000),
			Rare: true,
		},
		{
			ID: "reviewer_10", Name: "审批达人", Desc: "完成 10 次以上审批", Icon: "✅",
			Earned: stats.ReviewsCompleted >= 10, Progress: progress(stats.ReviewsCompleted, 10),
		},
		{
			ID: "star_collector", Name: "社区之星", Desc: "收到 100+ 颗 ⭐", Icon: "🏆",
			Earned: stats.RatingsReceived >= 100, Progress: progress(stats.RatingsReceived, 100),
		},
		{
			ID: "polyglot", Name: "多面手", Desc: "在 3 个以上 namespace 维护 skill", Icon: "🌟",
			Earned: distinctNs >= 3, Progress: progress(distinctNs, 3),
			Rare: distinctNs >= 5,
		},
		{
			ID: "documenter", Name: "文档大师", Desc: "至少一个 skill 有完整 README", Icon: "📜",
			Earned: docCount >= 1, Progress: progress(docCount, 1),
		},
		{
			ID: "security_clearance", Name: "安全意识", Desc: "发布过 L3 密级 skill", Icon: "🛡️",
			Earned: l3Count >= 1, Progress: progress(l3Count, 1),
			Rare: true,
		},
		{
			ID: "no_zombie", Name: "持续维护", Desc: "你发布的 skill 都还在线 (无 deprecated/yanked)", Icon: "🔥",
			Earned: stats.Published >= 1 && unhealthy == 0,
			Progress: func() float64 {
				if stats.Published == 0 {
					return 0
				}
				if unhealthy == 0 {
					return 1
				}
				return 0
			}(),
		},
	}
	return out, nil
}

// Search runs a single-pass query across skills, namespaces, and users for the
// global ⌘K search. Returns at most 8 / 5 / 5 hits per bucket. Empty q
// returns empty buckets so the client can render a neutral state.
func (s *Store) Search(q string) (*model.SearchResult, error) {
	out := &model.SearchResult{
		Skills:     []model.Skill{},
		Namespaces: []model.Namespace{},
		Users:      []model.SearchUserHit{},
	}
	q = strings.TrimSpace(q)
	if q == "" {
		return out, nil
	}
	like := "%" + q + "%"

	skillRows, err := s.DB.Query(`SELECT `+skillCols+`
		FROM skills
		WHERE name LIKE ? OR description LIKE ? OR tags_csv LIKE ? OR ns LIKE ?
		ORDER BY hot DESC, activations DESC
		LIMIT 8`, like, like, like, like)
	if err != nil {
		return nil, err
	}
	defer skillRows.Close()
	for skillRows.Next() {
		k, err := scanSkill(skillRows)
		if err != nil {
			return nil, err
		}
		out.Skills = append(out.Skills, k)
	}

	nsRows, err := s.DB.Query(`
		SELECT n.id, n.owner, COALESCE(c.cnt, 0)
		FROM namespaces n
		LEFT JOIN (SELECT ns, COUNT(*) cnt FROM skills GROUP BY ns) c ON c.ns = n.id
		WHERE n.id LIKE ? OR n.owner LIKE ?
		ORDER BY n.id
		LIMIT 5`, like, like)
	if err != nil {
		return nil, err
	}
	defer nsRows.Close()
	for nsRows.Next() {
		var n model.Namespace
		if err := nsRows.Scan(&n.ID, &n.Owner, &n.Count); err != nil {
			return nil, err
		}
		out.Namespaces = append(out.Namespaces, n)
	}

	// Hide the `system` bot from people search.
	userRows, err := s.DB.Query(`
		SELECT username, display, role, team FROM users
		WHERE username != 'system' AND (username LIKE ? OR display LIKE ?)
		ORDER BY username
		LIMIT 5`, like, like)
	if err != nil {
		return nil, err
	}
	defer userRows.Close()
	for userRows.Next() {
		var u model.SearchUserHit
		if err := userRows.Scan(&u.Username, &u.Display, &u.Role, &u.Team); err != nil {
			return nil, err
		}
		out.Users = append(out.Users, u)
	}
	return out, nil
}
