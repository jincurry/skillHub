package store

import (
	"database/sql"
	"fmt"
	"strings"

	"github.com/jincurry/skillhub/server/internal/model"
)

func splitCSV(s string) []string {
	if s == "" {
		return []string{}
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

type SkillFilter struct {
	Namespace      string
	Classification string
	Status         string
	Q              string
}

func (s *Store) ListSkills(f SkillFilter) ([]model.Skill, error) {
	q := `SELECT id,ns,name,description,long_desc,icon,icon_class,classification,status,version,author,
	             rating,ratings_count,activations,delta_pct,hot,tags_csv,updated_at
	      FROM skills WHERE 1=1`
	args := []any{}
	if f.Namespace != "" {
		q += ` AND ns = ?`
		args = append(args, f.Namespace)
	}
	if f.Classification != "" {
		q += ` AND classification = ?`
		args = append(args, f.Classification)
	}
	if f.Status != "" {
		q += ` AND status = ?`
		args = append(args, f.Status)
	}
	if f.Q != "" {
		q += ` AND (name LIKE ? OR description LIKE ? OR tags_csv LIKE ?)`
		like := "%" + f.Q + "%"
		args = append(args, like, like, like)
	}
	q += ` ORDER BY hot DESC, activations DESC, updated_at DESC`

	rows, err := s.DB.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.Skill
	for rows.Next() {
		var k model.Skill
		var tagsCSV string
		var hot int
		if err := rows.Scan(&k.ID, &k.Namespace, &k.Name, &k.Description, &k.LongDesc,
			&k.Icon, &k.IconClass, &k.Classification, &k.Status, &k.Version, &k.Author,
			&k.Rating, &k.Ratings, &k.Activations, &k.DeltaPct, &hot, &tagsCSV, &k.UpdatedAt); err != nil {
			return nil, err
		}
		k.Hot = hot != 0
		k.Tags = splitCSV(tagsCSV)
		out = append(out, k)
	}
	return out, rows.Err()
}

func (s *Store) GetSkill(ns, name string) (*model.Skill, error) {
	row := s.DB.QueryRow(`SELECT id,ns,name,description,long_desc,icon,icon_class,classification,status,version,author,
	             rating,ratings_count,activations,delta_pct,hot,tags_csv,updated_at
	      FROM skills WHERE ns=? AND name=?`, ns, name)
	var k model.Skill
	var tagsCSV string
	var hot int
	if err := row.Scan(&k.ID, &k.Namespace, &k.Name, &k.Description, &k.LongDesc,
		&k.Icon, &k.IconClass, &k.Classification, &k.Status, &k.Version, &k.Author,
		&k.Rating, &k.Ratings, &k.Activations, &k.DeltaPct, &hot, &tagsCSV, &k.UpdatedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	k.Hot = hot != 0
	k.Tags = splitCSV(tagsCSV)
	return &k, nil
}

func (s *Store) CreateSkill(req model.CreateSkillRequest, author string) (*model.Skill, error) {
	if _, err := s.DB.Exec(`INSERT INTO skills(ns,name,description,classification,status,version,author,tags_csv)
		VALUES(?,?,?,?,?,?,?,?)`,
		req.Namespace, req.Name, req.Description, req.Classification, "draft", "0.1.0", author, strings.Join(req.Tags, ",")); err != nil {
		return nil, err
	}
	_, _ = s.DB.Exec(`INSERT INTO audit_logs(actor,action,target,version,ip) VALUES(?,?,?,?,?)`,
		author, "create_draft", req.Namespace+"/"+req.Name, "v0.1.0", "127.0.0.1")
	// Seed the bundle with skill.yaml + README.md so the editor opens to real
	// files instead of synthesised content. Best-effort: if the seed fails, the
	// skill row is already in place and the user can still create files later.
	_ = s.SeedDefaultFiles(req.Namespace, req.Name, req.Description, author)
	return s.GetSkill(req.Namespace, req.Name)
}

func (s *Store) ListNamespaces() ([]model.Namespace, error) {
	rows, err := s.DB.Query(`
		SELECT n.id, n.owner, COALESCE(c.cnt,0)
		FROM namespaces n
		LEFT JOIN (SELECT ns, COUNT(*) cnt FROM skills GROUP BY ns) c ON c.ns = n.id
		ORDER BY n.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.Namespace
	for rows.Next() {
		var n model.Namespace
		if err := rows.Scan(&n.ID, &n.Owner, &n.Count); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func (s *Store) ListReviews(status string) ([]model.Review, error) {
	q := `SELECT id,ns,skill_name,version,classification,author,reviewers_csv,status,urgency,sla,note,submitted_at
	      FROM reviews`
	args := []any{}
	if status != "" {
		q += ` WHERE status = ?`
		args = append(args, status)
	}
	q += ` ORDER BY submitted_at DESC`
	rows, err := s.DB.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.Review
	for rows.Next() {
		var r model.Review
		var rev string
		if err := rows.Scan(&r.ID, &r.Namespace, &r.SkillName, &r.Version, &r.Classification,
			&r.Author, &rev, &r.Status, &r.Urgency, &r.SLA, &r.Note, &r.SubmittedAt); err != nil {
			return nil, err
		}
		r.Reviewers = splitCSV(rev)
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) GetReview(id int64) (*model.Review, error) {
	row := s.DB.QueryRow(`SELECT id,ns,skill_name,version,classification,author,reviewers_csv,status,urgency,sla,note,submitted_at
	      FROM reviews WHERE id=?`, id)
	var r model.Review
	var rev string
	if err := row.Scan(&r.ID, &r.Namespace, &r.SkillName, &r.Version, &r.Classification,
		&r.Author, &rev, &r.Status, &r.Urgency, &r.SLA, &r.Note, &r.SubmittedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	r.Reviewers = splitCSV(rev)
	return &r, nil
}

func (s *Store) DecideReview(id int64, decision, note, actor string) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	newStatus := "approved"
	urgency := "done"
	action := "approve_review"
	notifKind := "publish"
	skillStatus := "" // empty means "no change to skill"
	if decision == "reject" {
		newStatus = "rejected"
		urgency = "rejected"
		action = "reject_review"
		notifKind = "warn"
	} else if decision == "request_changes" {
		newStatus = "changes_requested"
		urgency = "changes"
		action = "request_changes"
		notifKind = "warn"
		skillStatus = "draft"
	} else {
		skillStatus = "published"
	}
	if _, err := tx.Exec(`UPDATE reviews SET status=?, urgency=?, decided_at=CURRENT_TIMESTAMP WHERE id=?`,
		newStatus, urgency, id); err != nil {
		return err
	}
	var ns, name, version, author string
	if err := tx.QueryRow(`SELECT ns,skill_name,version,author FROM reviews WHERE id=?`, id).Scan(&ns, &name, &version, &author); err != nil {
		return err
	}
	switch skillStatus {
	case "published":
		if _, err := tx.Exec(`UPDATE skills SET status='published', version=?, updated_at=CURRENT_TIMESTAMP
			WHERE ns=? AND name=?`, version, ns, name); err != nil {
			return err
		}
	case "draft":
		if _, err := tx.Exec(`UPDATE skills SET status='draft', updated_at=CURRENT_TIMESTAMP
			WHERE ns=? AND name=?`, ns, name); err != nil {
			return err
		}
	}
	// Update the corresponding version row.
	versionStatus := "approved"
	switch decision {
	case "reject":
		versionStatus = "rejected"
	case "request_changes":
		versionStatus = "changes_requested"
	case "approve":
		versionStatus = "published"
	}
	if _, err := tx.Exec(`UPDATE skill_versions SET status=?, updated_at=CURRENT_TIMESTAMP WHERE review_id=?`,
		versionStatus, id); err != nil {
		return err
	}
	if note != "" {
		if _, err := tx.Exec(`INSERT INTO comments(review_id,author,body) VALUES(?,?,?)`, id, actor, note); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`INSERT INTO audit_logs(actor,action,target,version,ip) VALUES(?,?,?,?,?)`,
		actor, action, ns+"/"+name, "v"+version, "127.0.0.1"); err != nil {
		return err
	}
	// Notify the author (skip if they decided their own review).
	if author != "" && author != actor {
		body := "你的 " + ns + "/" + name + " v" + version + " 已审批通过"
		switch decision {
		case "reject":
			body = "你的 " + ns + "/" + name + " v" + version + " 被驳回"
			if note != "" {
				body += "：" + note
			}
		case "request_changes":
			body = "你的 " + ns + "/" + name + " v" + version + " 需要修改"
			if note != "" {
				body += "：" + note
			}
		}
		if _, err := tx.Exec(`INSERT INTO notifications(user,kind,body) VALUES(?,?,?)`,
			author, notifKind, body); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) ListComments(reviewID int64) ([]model.Comment, error) {
	rows, err := s.DB.Query(`SELECT id,review_id,author,body,created_at FROM comments WHERE review_id=? ORDER BY created_at ASC`, reviewID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.Comment
	for rows.Next() {
		var c model.Comment
		if err := rows.Scan(&c.ID, &c.ReviewID, &c.Author, &c.Body, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) AddComment(reviewID int64, author, body string) (*model.Comment, error) {
	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	res, err := tx.Exec(`INSERT INTO comments(review_id,author,body) VALUES(?,?,?)`, reviewID, author, body)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()

	// Notify review author + reviewers (excluding the commenter).
	var ns, name, ra, revCSV string
	if err := tx.QueryRow(`SELECT ns,skill_name,author,reviewers_csv FROM reviews WHERE id=?`, reviewID).Scan(&ns, &name, &ra, &revCSV); err == nil {
		seen := map[string]bool{author: true}
		participants := append([]string{ra}, splitCSV(revCSV)...)
		notifBody := "@" + author + " 在 " + ns + "/" + name + " 留下了评论"
		for _, p := range participants {
			if p == "" || seen[p] {
				continue
			}
			seen[p] = true
			if _, err := tx.Exec(`INSERT INTO notifications(user,kind,body) VALUES(?,?,?)`, p, "comment", notifBody); err != nil {
				return nil, err
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	row := s.DB.QueryRow(`SELECT id,review_id,author,body,created_at FROM comments WHERE id=?`, id)
	var c model.Comment
	if err := row.Scan(&c.ID, &c.ReviewID, &c.Author, &c.Body, &c.CreatedAt); err != nil {
		return nil, err
	}
	return &c, nil
}

// AuditFilter narrows down ListAuditLogs. All fields are optional.
type AuditFilter struct {
	Actor  string // exact match on actor username
	Action string // exact match on action
	Target string // substring match on target (e.g. "platform-team/" or "ns/name")
	Q      string // free-text substring across actor / action / target / version
	Limit  int
}

func (s *Store) ListAuditLogs(f AuditFilter) ([]model.AuditLog, error) {
	if f.Limit <= 0 || f.Limit > 500 {
		f.Limit = 100
	}
	q := `SELECT id,actor,action,target,version,ip,created_at FROM audit_logs WHERE 1=1`
	args := []any{}
	if f.Actor != "" {
		q += ` AND actor = ?`
		args = append(args, f.Actor)
	}
	if f.Action != "" {
		q += ` AND action = ?`
		args = append(args, f.Action)
	}
	if f.Target != "" {
		q += ` AND target LIKE ?`
		args = append(args, "%"+f.Target+"%")
	}
	if f.Q != "" {
		q += ` AND (actor LIKE ? OR action LIKE ? OR target LIKE ? OR version LIKE ?)`
		like := "%" + f.Q + "%"
		args = append(args, like, like, like, like)
	}
	q += ` ORDER BY created_at DESC LIMIT ?`
	args = append(args, f.Limit)

	rows, err := s.DB.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.AuditLog
	for rows.Next() {
		var l model.AuditLog
		if err := rows.Scan(&l.ID, &l.Actor, &l.Action, &l.Target, &l.Version, &l.IP, &l.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func (s *Store) ListNotifications(user string) ([]model.Notification, error) {
	rows, err := s.DB.Query(`SELECT id,kind,body,unread,created_at FROM notifications WHERE user=? ORDER BY created_at DESC LIMIT 50`, user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.Notification
	for rows.Next() {
		var n model.Notification
		var unread int
		if err := rows.Scan(&n.ID, &n.Kind, &n.Body, &unread, &n.CreatedAt); err != nil {
			return nil, err
		}
		n.Unread = unread != 0
		out = append(out, n)
	}
	return out, rows.Err()
}

// MarkNotificationsRead clears the unread flag on a user's notifications.
// If all is true, every unread row for that user is cleared; otherwise only the
// rows matching ids (and owned by user) are cleared.
func (s *Store) MarkNotificationsRead(user string, ids []int64, all bool) error {
	if all {
		_, err := s.DB.Exec(`UPDATE notifications SET unread=0 WHERE user=? AND unread=1`, user)
		return err
	}
	if len(ids) == 0 {
		return nil
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, id := range ids {
		if _, err := tx.Exec(`UPDATE notifications SET unread=0 WHERE id=? AND user=?`, id, user); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) ListMyDrafts(user string) ([]model.Skill, error) {
	rows, err := s.DB.Query(`SELECT id,ns,name,description,long_desc,icon,icon_class,classification,status,version,author,
		rating,ratings_count,activations,delta_pct,hot,tags_csv,updated_at
		FROM skills WHERE author=? AND status='draft' ORDER BY updated_at DESC`, user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.Skill
	for rows.Next() {
		var k model.Skill
		var tagsCSV string
		var hot int
		if err := rows.Scan(&k.ID, &k.Namespace, &k.Name, &k.Description, &k.LongDesc,
			&k.Icon, &k.IconClass, &k.Classification, &k.Status, &k.Version, &k.Author,
			&k.Rating, &k.Ratings, &k.Activations, &k.DeltaPct, &hot, &tagsCSV, &k.UpdatedAt); err != nil {
			return nil, err
		}
		k.Hot = hot != 0
		k.Tags = splitCSV(tagsCSV)
		out = append(out, k)
	}
	return out, rows.Err()
}

// SubmitDraftForReview transitions a draft skill to "review" status and creates a Review row.
// Returns ErrNoRows-equivalent if the skill is missing or not a draft.
func (s *Store) SubmitDraftForReview(ns, name, version, note, author string, reviewers []string) (*model.Review, error) {
	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var classification, status string
	if err := tx.QueryRow(`SELECT classification, status FROM skills WHERE ns=? AND name=?`, ns, name).Scan(&classification, &status); err != nil {
		return nil, err
	}
	if status != "draft" {
		return nil, sql.ErrNoRows
	}
	if version == "" {
		version = "0.1.0"
	}
	if _, err := tx.Exec(`UPDATE skills SET status='review', version=?, updated_at=CURRENT_TIMESTAMP WHERE ns=? AND name=?`, version, ns, name); err != nil {
		return nil, err
	}
	revCSV := strings.Join(reviewers, ",")
	res, err := tx.Exec(`INSERT INTO reviews(ns,skill_name,version,classification,author,reviewers_csv,status,urgency,sla,note)
		VALUES(?,?,?,?,?,?,?,?,?,?)`,
		ns, name, version, classification, author, revCSV, "pending", "ok", "72h", note)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	if _, err := tx.Exec(`INSERT INTO audit_logs(actor,action,target,version,ip) VALUES(?,?,?,?,?)`,
		author, "submit_review", ns+"/"+name, "v"+version, "127.0.0.1"); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(`INSERT INTO skill_versions(ns,name,version,status,author,note,review_id) VALUES(?,?,?,?,?,?,?)`,
		ns, name, version, "review", author, note, id); err != nil {
		return nil, err
	}
	notifBody := "@" + author + " 请求审批 " + ns + "/" + name + " v" + version
	for _, rv := range reviewers {
		if rv == "" || rv == author {
			continue
		}
		if _, err := tx.Exec(`INSERT INTO notifications(user,kind,body) VALUES(?,?,?)`, rv, "review", notifBody); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetReview(id)
}

func (s *Store) GetUser(username string) (*model.Me, error) {
	// joined_at is left raw (no COALESCE) so the SQLite driver can decode it
	// directly into time.Time — wrapping it in COALESCE collapses the column
	// type to TEXT and breaks the scan.
	row := s.DB.QueryRow(`SELECT username,display,role,team,
		COALESCE(email,''),COALESCE(bio,''),COALESCE(location,''),
		joined_at
		FROM users WHERE username=?`, username)
	var u model.Me
	if err := row.Scan(&u.Username, &u.Display, &u.Role, &u.Team,
		&u.Email, &u.Bio, &u.Location, &u.JoinedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &u, nil
}

// SetSkillLifecycleStatus transitions a skill into a non-versioning lifecycle
// state (yanked / deprecated). It writes the status change, an audit row, and
// notifies the skill author.
func (s *Store) SetSkillLifecycleStatus(ns, name, newStatus, actor, reason string) error {
	if newStatus != "yanked" && newStatus != "deprecated" {
		return fmt.Errorf("invalid status %q", newStatus)
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var author, version string
	if err := tx.QueryRow(`SELECT author,version FROM skills WHERE ns=? AND name=?`, ns, name).Scan(&author, &version); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE skills SET status=?, updated_at=CURRENT_TIMESTAMP WHERE ns=? AND name=?`, newStatus, ns, name); err != nil {
		return err
	}
	action := newStatus
	if _, err := tx.Exec(`INSERT INTO audit_logs(actor,action,target,version,ip) VALUES(?,?,?,?,?)`,
		actor, action, ns+"/"+name, "v"+version, "127.0.0.1"); err != nil {
		return err
	}
	body := fmt.Sprintf("%s/%s 已被 @%s 标记为 %s", ns, name, actor, newStatus)
	if reason != "" {
		body += "：" + reason
	}
	if _, err := tx.Exec(`INSERT INTO notifications(user,kind,body,unread) VALUES(?,?,?,1)`, author, "warn", body); err != nil {
		return err
	}
	return tx.Commit()
}
