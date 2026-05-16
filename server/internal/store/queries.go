package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jincurry/skillhub/server/internal/model"
	"github.com/jincurry/skillhub/server/internal/policy"
	"github.com/jincurry/skillhub/server/internal/templates"
)

// scanReviewSnapshot decodes the policy_snapshot JSON column into a
// *model.PolicySnapshot. Empty string (legacy rows) → nil so callers can
// fall back to the live policy.
func scanReviewSnapshot(raw string) *model.PolicySnapshot {
	if raw == "" {
		return nil
	}
	var snap model.PolicySnapshot
	if err := json.Unmarshal([]byte(raw), &snap); err != nil {
		return nil
	}
	return &snap
}

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
	Limit          int // 0 = no limit
	Offset         int
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
	if f.Limit > 0 {
		q += ` LIMIT ? OFFSET ?`
		args = append(args, f.Limit, f.Offset)
	}

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
	// Seed the bundle. With a templateId, render the named template; otherwise
	// fall back to the default SKILL.md / skill.yaml / README.md trio. Both
	// paths are best-effort: a seeding error doesn't block skill creation
	// since the row is already committed.
	if req.TemplateID != "" {
		if tpl := templates.Get(req.TemplateID); tpl != nil {
			rendered := tpl.Render(templates.Vars{Name: req.Name, Description: req.Description})
			for path, body := range rendered {
				if _, err := s.PutSkillFile(req.Namespace, req.Name, path, body, author); err != nil {
					break
				}
			}
		} else {
			_ = s.SeedDefaultFiles(req.Namespace, req.Name, req.Description, author)
		}
	} else {
		_ = s.SeedDefaultFiles(req.Namespace, req.Name, req.Description, author)
	}
	return s.GetSkill(req.Namespace, req.Name)
}

// HardDeleteSkill erases a skill and every child row that references it.
// This is a destructive operation reserved for admin cleanup (e.g. in
// preparation to delete the owning namespace). Callers that want a safer
// lifecycle transition should use yankSkill / deprecateSkill instead.
//
// The transaction deletes:
//
//   - reviews for the skill  → cascades comments + review_files (FK)
//   - skill_versions         (manual, no FK)
//   - skill_files            (manual, no FK)
//   - skill_daily_metrics    (manual, no FK)
//   - notifications targeting the skill (manual; target_kind='skill')
//   - skills row             → cascades skill_ratings (FK)
//
// audit_logs are intentionally left in place so the deletion itself remains
// visible in the admin overview feed.
func (s *Store) HardDeleteSkill(ns, name string) error {
	// Existence check keeps the error message clean when the user pastes
	// the wrong slug.
	var id int64
	if err := s.DB.QueryRow(`SELECT id FROM skills WHERE ns=? AND name=?`, ns, name).Scan(&id); err != nil {
		if err == sql.ErrNoRows {
			return fmt.Errorf("skill 不存在: %s/%s", ns, name)
		}
		return err
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Reviews first so the FK-cascaded comments / review_files go too.
	if _, err := tx.Exec(`DELETE FROM reviews WHERE ns=? AND skill_name=?`, ns, name); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM skill_versions WHERE ns=? AND name=?`, ns, name); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM skill_files WHERE ns=? AND skill_name=?`, ns, name); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM skill_daily_metrics WHERE ns=? AND name=?`, ns, name); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM notifications WHERE target_kind='skill' AND target_ref=?`, ns+"/"+name); err != nil {
		return err
	}
	// Finally the skill itself — skill_ratings cascade on FK.
	if _, err := tx.Exec(`DELETE FROM skills WHERE id=?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

// DeleteNamespace removes a namespace only if it has zero skills. We refuse
// to cascade because skills drag along reviews, comments, ratings, audit
// logs and file snapshots — deleting all of that by accident would be
// catastrophic. The caller (admin API) is expected to surface the error
// message back to the user so they understand why the delete was blocked.
//
// What gets cleaned up on a successful call:
//   - namespaces row
//   - namespace_members rows for this ns
//   - namespace_policies rows for this ns
//
// sql.ErrNoRows is translated into a friendlier "not found" error.
func (s *Store) DeleteNamespace(ns string) error {
	// Verify the namespace exists up-front so we return a clean error
	// instead of silently succeeding on a typo.
	var owner string
	if err := s.DB.QueryRow(`SELECT owner FROM namespaces WHERE id=?`, ns).Scan(&owner); err != nil {
		if err == sql.ErrNoRows {
			return fmt.Errorf("命名空间不存在: %s", ns)
		}
		return err
	}
	var skillCount int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM skills WHERE ns=?`, ns).Scan(&skillCount); err != nil {
		return err
	}
	if skillCount > 0 {
		return fmt.Errorf("命名空间下仍有 %d 个 Skill，不能删除。请先删除或迁移其中的 Skill。", skillCount)
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM namespace_policies WHERE ns=?`, ns); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM namespace_members WHERE ns=?`, ns); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM namespaces WHERE id=?`, ns); err != nil {
		return err
	}
	return tx.Commit()
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

// reviewSelectCols centralises the column list so ListReviews/GetReview
// always agree on order; new fields go here once.
const reviewSelectCols = `id,ns,skill_name,version,classification,author,reviewers_csv,
	status,urgency,sla,note,submitted_at,is_hotfix,hotfix_reason,policy_snapshot`

// scanReviewRow reads one row from a query that selected reviewSelectCols,
// in order. Used by both list and get paths.
func scanReviewRow(scan func(...any) error) (model.Review, error) {
	var r model.Review
	var rev, snap string
	var hotfix int
	if err := scan(&r.ID, &r.Namespace, &r.SkillName, &r.Version, &r.Classification,
		&r.Author, &rev, &r.Status, &r.Urgency, &r.SLA, &r.Note, &r.SubmittedAt,
		&hotfix, &r.HotfixReason, &snap); err != nil {
		return r, err
	}
	r.Reviewers = splitCSV(rev)
	r.IsHotfix = hotfix != 0
	r.PolicySnapshot = scanReviewSnapshot(snap)
	return r, nil
}

func (s *Store) ListReviews(status string, limit, offset int) ([]model.Review, error) {
	q := `SELECT ` + reviewSelectCols + ` FROM reviews`
	args := []any{}
	if status != "" {
		q += ` WHERE status = ?`
		args = append(args, status)
	}
	q += ` ORDER BY submitted_at DESC`
	if limit > 0 {
		q += ` LIMIT ? OFFSET ?`
		args = append(args, limit, offset)
	}
	rows, err := s.DB.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.Review
	for rows.Next() {
		r, err := scanReviewRow(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) GetReview(id int64) (*model.Review, error) {
	row := s.DB.QueryRow(`SELECT `+reviewSelectCols+` FROM reviews WHERE id=?`, id)
	r, err := scanReviewRow(row.Scan)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
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
		if _, err := tx.Exec(`INSERT INTO notifications(user,kind,target_kind,target_ref,body) VALUES(?,?,?,?,?)`,
			author, notifKind, "review", strconv.FormatInt(id, 10), body); err != nil {
			return err
		}
	}
	// On a successful publish: fan out to subscribers and bump the
	// auto-managed "latest" dist-tag so consumers pinning latest see the
	// new version immediately.
	if decision == "approve" {
		if err := fanOutPublishNotifTx(tx, ns, name, version, author, actor); err != nil {
			return err
		}
		if err := upsertDistTagTx(tx, ns, name, "latest", version, "system"); err != nil {
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
			if _, err := tx.Exec(`INSERT INTO notifications(user,kind,target_kind,target_ref,body) VALUES(?,?,?,?,?)`,
				p, "comment", "review", strconv.FormatInt(reviewID, 10), notifBody); err != nil {
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
	rows, err := s.DB.Query(`SELECT id,kind,body,COALESCE(target_kind,''),COALESCE(target_ref,''),unread,created_at
		FROM notifications WHERE user=? ORDER BY created_at DESC LIMIT 50`, user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.Notification
	for rows.Next() {
		var n model.Notification
		var unread int
		if err := rows.Scan(&n.ID, &n.Kind, &n.Body, &n.TargetKind, &n.TargetRef, &unread, &n.CreatedAt); err != nil {
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

// SubmitDraftOptions bundles optional parameters for SubmitDraftForReview so
// the call sites stay readable as we add features (hotfix, policy snapshot).
type SubmitDraftOptions struct {
	IsHotfix     bool
	HotfixReason string
}

// SubmitDraftForReview transitions a draft skill to "review" status and creates a Review row.
// Returns ErrNoRows-equivalent if the skill is missing or not a draft.
func (s *Store) SubmitDraftForReview(ns, name, version, note, author string, reviewers []string, opts SubmitDraftOptions) (*model.Review, error) {
	// Look up classification *before* starting the write tx. ResolvePolicy
	// (and the classification probe below) issue independent queries on
	// s.DB, and with SetMaxOpenConns(1) any nested DB call after tx.Begin()
	// blocks forever waiting for the connection the tx is holding.
	var classification, status, currentVersion string
	if err := s.DB.QueryRow(`SELECT classification, status, version FROM skills WHERE ns=? AND name=?`, ns, name).
		Scan(&classification, &status, &currentVersion); err != nil {
		return nil, err
	}
	if status != "draft" {
		return nil, sql.ErrNoRows
	}
	if version == "" {
		// Fall back to whatever's on the skill row — usually set by the
		// CreateDraftVersion bump that preceded this submit. The old default
		// of "0.1.0" silently rewrote published versions back to 0.1.0.
		version = currentVersion
		if version == "" {
			version = "0.1.0"
		}
	}
	var pol policy.Policy
	if opts.IsHotfix {
		// Hotfix override: 1 approver, 4h SLA. The reviewer-pick logic still
		// runs against the namespace's hotfix-eligible roles via the slot
		// list returned here.
		pol = policy.HotfixPolicy(classification)
	} else {
		p, _, err := s.ResolvePolicy(ns, classification)
		if err != nil {
			return nil, err
		}
		pol = p
	}
	sla := fmt.Sprintf("%dh", pol.SLAHours)
	urgency := "ok"
	if opts.IsHotfix {
		urgency = "hot" // surfaced as a red badge in review queues
	}
	// Freeze the policy as JSON so reviewers see the rules that were in
	// effect at submission, even if admins change them later.
	snapJSON, err := json.Marshal(pol.Snapshot(opts.IsHotfix))
	if err != nil {
		return nil, err
	}

	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`UPDATE skills SET status='review', version=?, updated_at=CURRENT_TIMESTAMP WHERE ns=? AND name=?`, version, ns, name); err != nil {
		return nil, err
	}
	revCSV := strings.Join(reviewers, ",")
	hotfixInt := 0
	if opts.IsHotfix {
		hotfixInt = 1
	}
	res, err := tx.Exec(`INSERT INTO reviews
		(ns,skill_name,version,classification,author,reviewers_csv,status,urgency,sla,note,
		 is_hotfix,hotfix_reason,policy_snapshot)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		ns, name, version, classification, author, revCSV, "pending", urgency, sla, note,
		hotfixInt, opts.HotfixReason, string(snapJSON))
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	if _, err := tx.Exec(`INSERT INTO audit_logs(actor,action,target,version,ip) VALUES(?,?,?,?,?)`,
		author, "submit_review", ns+"/"+name, "v"+version, "127.0.0.1"); err != nil {
		return nil, err
	}
	if opts.IsHotfix {
		// Persist the reason in audit so platform admins can spot abuse of
		// the emergency channel after the fact.
		if _, err := tx.Exec(`INSERT INTO audit_logs(actor,action,target,version,ip) VALUES(?,?,?,?,?)`,
			author, "hotfix_submit", ns+"/"+name+": "+opts.HotfixReason, "v"+version, "127.0.0.1"); err != nil {
			return nil, err
		}
	}
	if _, err := tx.Exec(`INSERT INTO skill_versions(ns,name,version,status,author,note,review_id) VALUES(?,?,?,?,?,?,?)`,
		ns, name, version, "review", author, note, id); err != nil {
		return nil, err
	}
	// Snapshot the file bundle the author is asking reviewers to look at,
	// alongside the body of each path in the previous approved review (if
	// any). The diff view reads this back; subsequent edits to skill_files
	// won't change what the reviewer sees.
	if err := snapshotReviewFiles(tx, id, ns, name); err != nil {
		return nil, err
	}
	notifBody := "@" + author + " 请求审批 " + ns + "/" + name + " v" + version
	reviewRef := strconv.FormatInt(id, 10)
	for _, rv := range reviewers {
		if rv == "" || rv == author {
			continue
		}
		if _, err := tx.Exec(`INSERT INTO notifications(user,kind,target_kind,target_ref,body) VALUES(?,?,?,?,?)`,
			rv, "review", "review", reviewRef, notifBody); err != nil {
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
		COALESCE(avatar_url,''),COALESCE(cover_preset,'sunset'),
		COALESCE(cover_from,''),COALESCE(cover_to,''),
		COALESCE(is_admin,0),
		joined_at
		FROM users WHERE username=?`, username)
	var u model.Me
	var isAdmin int
	if err := row.Scan(&u.Username, &u.Display, &u.Role, &u.Team,
		&u.Email, &u.Bio, &u.Location,
		&u.AvatarURL, &u.CoverPreset, &u.CoverFrom, &u.CoverTo,
		&isAdmin,
		&u.JoinedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	u.IsAdmin = isAdmin == 1
	return &u, nil
}

// IsAdmin reports whether the user has the system-wide admin flag set.
// Used by the requireAdmin middleware to gate AI provider configuration.
func (s *Store) IsAdmin(username string) (bool, error) {
	var n int
	err := s.DB.QueryRow(`SELECT COALESCE(is_admin,0) FROM users WHERE username = ?`, username).Scan(&n)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return n == 1, nil
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
	if _, err := tx.Exec(`INSERT INTO notifications(user,kind,target_kind,target_ref,body,unread) VALUES(?,?,?,?,?,1)`,
		author, "warn", "skill", ns+"/"+name, body); err != nil {
		return err
	}
	return tx.Commit()
}

// snapshotReviewFiles writes one row per file in the skill bundle into
// review_files, capturing both the body the author is submitting *and* the
// body of the same path in the most recent approved/published review (if
// any). Runs inside the SubmitDraftForReview transaction so the snapshot is
// atomic with the review row creation.
//
// The "previous approved" lookup is intentionally simple: we take the newest
// review for (ns, name) whose status is "approved" or "closed". That covers
// the lifecycle: a published version is reachable via its old review's
// snapshot, and never-published skills correctly produce empty base content.
func snapshotReviewFiles(tx *sql.Tx, reviewID int64, ns, name string) error {
	// Step 1: resolve the previous review id (might be 0 if never approved).
	var prevID int64
	err := tx.QueryRow(`
		SELECT id FROM reviews
		WHERE ns = ? AND skill_name = ? AND status IN ('approved','closed') AND id < ?
		ORDER BY id DESC LIMIT 1
	`, ns, name, reviewID).Scan(&prevID)
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	prevContents := map[string]string{}
	if prevID != 0 {
		rows, err := tx.Query(`SELECT path, new_content FROM review_files WHERE review_id = ?`, prevID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var p, c string
			if err := rows.Scan(&p, &c); err != nil {
				rows.Close()
				return err
			}
			prevContents[p] = c
		}
		rows.Close()
	}

	// Step 2: pull every file currently in the bundle.
	curRows, err := tx.Query(`SELECT path, content FROM skill_files WHERE ns = ? AND skill_name = ?`, ns, name)
	if err != nil {
		return err
	}
	curContents := map[string]string{}
	for curRows.Next() {
		var p, c string
		if err := curRows.Scan(&p, &c); err != nil {
			curRows.Close()
			return err
		}
		curContents[p] = c
	}
	curRows.Close()

	// Step 3: union of paths so deletions show up too.
	seen := map[string]bool{}
	for p := range prevContents {
		seen[p] = true
	}
	for p := range curContents {
		seen[p] = true
	}
	for p := range seen {
		base, hadBase := prevContents[p]
		newC, hasNew := curContents[p]
		var kind string
		switch {
		case !hadBase && hasNew:
			kind = "added"
		case hadBase && !hasNew:
			kind = "deleted"
		case base == newC:
			kind = "unchanged"
		default:
			kind = "modified"
		}
		if _, err := tx.Exec(`INSERT INTO review_files(review_id, path, base_content, new_content, change_kind)
			VALUES(?,?,?,?,?)`,
			reviewID, p, base, newC, kind); err != nil {
			return err
		}
	}
	return nil
}

// ListReviewFiles returns the snapshot rows for one review id. Empty list is
// a valid response (e.g. legacy reviews submitted before the snapshot table
// existed).
func (s *Store) ListReviewFiles(reviewID int64) ([]model.ReviewFile, error) {
	rows, err := s.DB.Query(`SELECT path, base_content, new_content, change_kind
		FROM review_files WHERE review_id = ? ORDER BY path`, reviewID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.ReviewFile{}
	for rows.Next() {
		var f model.ReviewFile
		if err := rows.Scan(&f.Path, &f.BaseContent, &f.NewContent, &f.ChangeKind); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// GetPlatformMetrics aggregates the numbers the admin dashboard needs. All
// queries are independent so a bad column name in one doesn't blow up the
// whole response — we just surface partial data. Every aggregate is a
// single COUNT/SUM so the total query cost is trivial; this can be called
// synchronously on page load.
func (s *Store) GetPlatformMetrics() (*model.PlatformMetrics, error) {
	m := &model.PlatformMetrics{
		SkillsByStatus:    map[string]int{},
		ReviewsByStatus:   map[string]int{},
		ActivationsTrend:  []model.TrendPoint{},
		RecentAudit:       []model.AuditLog{},
		AvgDecisionHours:  -1,
	}

	_ = s.DB.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&m.Users)
	_ = s.DB.QueryRow(`SELECT COUNT(*) FROM namespaces`).Scan(&m.Namespaces)

	// Skills grouped by status. Also bumps TotalSkills alongside so the
	// client doesn't have to sum the map.
	if rows, err := s.DB.Query(`SELECT status, COUNT(*) FROM skills GROUP BY status`); err == nil {
		for rows.Next() {
			var st string
			var c int
			if err := rows.Scan(&st, &c); err == nil {
				m.SkillsByStatus[st] = c
				m.TotalSkills += c
			}
		}
		rows.Close()
	}

	// Reviews grouped by status. changes_requested rolls up into rejected
	// to match the /reviews page UX.
	if rows, err := s.DB.Query(`SELECT status, COUNT(*) FROM reviews GROUP BY status`); err == nil {
		for rows.Next() {
			var st string
			var c int
			if err := rows.Scan(&st, &c); err == nil {
				key := st
				if st == "changes_requested" {
					key = "rejected"
				}
				m.ReviewsByStatus[key] += c
				m.TotalReviews += c
			}
		}
		rows.Close()
	}

	// SLA numbers mirror ReviewStats (same query shapes, different consumer).
	_ = s.DB.QueryRow(`
		SELECT COUNT(*) FROM reviews
		WHERE status='pending' AND urgency='overdue'`).Scan(&m.Overdue)
	decided := m.ReviewsByStatus["approved"] + m.ReviewsByStatus["rejected"]
	if decided > 0 {
		var lateDecided int
		_ = s.DB.QueryRow(`
			SELECT COUNT(*) FROM reviews
			WHERE status IN ('approved','rejected','changes_requested')
			  AND urgency='overdue'`).Scan(&lateDecided)
		m.SlaComplianceRate = float64(decided-lateDecided) / float64(decided) * 100.0
	}
	var avg sql.NullFloat64
	if err := s.DB.QueryRow(`
		SELECT AVG((julianday(decided_at) - julianday(submitted_at)) * 24.0)
		FROM reviews WHERE decided_at IS NOT NULL`).Scan(&avg); err == nil && avg.Valid {
		m.AvgDecisionHours = avg.Float64
	}

	// AI provider counters. has_key = 1 when the encrypted column is
	// non-empty; see store/ai.go for how that's stored.
	_ = s.DB.QueryRow(`SELECT COUNT(*) FROM ai_providers`).Scan(&m.AIProviders.Total)
	_ = s.DB.QueryRow(`SELECT COUNT(*) FROM ai_providers WHERE enabled = 1`).Scan(&m.AIProviders.Enabled)
	_ = s.DB.QueryRow(`SELECT COUNT(*) FROM ai_providers WHERE api_key_enc IS NOT NULL AND api_key_enc != ''`).Scan(&m.AIProviders.WithKey)

	// Platform-wide 30-day activation trend: sum per day across every skill.
	today := time.Now().UTC().Truncate(24 * time.Hour)
	trendBy := make(map[string]int, 30)
	if rows, err := s.DB.Query(`
		SELECT day, SUM(activations)
		FROM skill_daily_metrics
		WHERE day >= ?
		GROUP BY day`,
		today.AddDate(0, 0, -29).Format("2006-01-02"),
	); err == nil {
		for rows.Next() {
			var d string
			var v int
			if err := rows.Scan(&d, &v); err == nil {
				trendBy[d] = v
			}
		}
		rows.Close()
	}
	m.ActivationsTrend = make([]model.TrendPoint, 30)
	for i := 0; i < 30; i++ {
		day := today.AddDate(0, 0, -(29 - i))
		key := day.Format("2006-01-02")
		v := trendBy[key]
		m.ActivationsTrend[i] = model.TrendPoint{Day: key, Activations: v}
		m.Activations30d += v
	}

	// Last 10 audit log entries so the dashboard has an at-a-glance feed.
	logs, err := s.ListAuditLogs(AuditFilter{Limit: 10})
	if err == nil {
		m.RecentAudit = logs
	}
	return m, nil
}

// GetSkillTrend returns one TrendPoint per day for the last `days` days, in
// chronological order. Days that have no row in skill_daily_metrics are
// filled in with 0 activations so the client can plot a continuous line
// without gap-handling.
func (s *Store) GetSkillTrend(ns, name string, days int) ([]model.TrendPoint, error) {
	if days <= 0 {
		days = 30
	}
	if days > 365 {
		days = 365
	}

	// Pull whatever rows exist into a map keyed by day string. Done first so
	// the loop below can do O(1) lookups while it walks the desired range.
	rows, err := s.DB.Query(`
		SELECT day, activations
		FROM skill_daily_metrics
		WHERE ns = ? AND name = ?
		ORDER BY day DESC
		LIMIT ?`, ns, name, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	by := make(map[string]int, days)
	for rows.Next() {
		var d string
		var v int
		if err := rows.Scan(&d, &v); err != nil {
			return nil, err
		}
		by[d] = v
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	today := time.Now().UTC().Truncate(24 * time.Hour)
	out := make([]model.TrendPoint, days)
	for i := 0; i < days; i++ {
		day := today.AddDate(0, 0, -(days - 1 - i))
		key := day.Format("2006-01-02")
		out[i] = model.TrendPoint{Day: key, Activations: by[key]}
	}
	return out, nil
}
