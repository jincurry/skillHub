package store

import (
	"database/sql"
	"errors"
	"strings"

	"github.com/jincurry/skillhub/server/internal/auth"
	"github.com/jincurry/skillhub/server/internal/model"
)

// UpdateMe applies a partial profile update. Returns the refreshed Me row.
// Each field in req that is non-nil overwrites the stored value (an empty
// string is a valid "clear it" instruction).
func (s *Store) UpdateMe(username string, req model.UpdateMeRequest) (*model.Me, error) {
	sets := []string{}
	args := []any{}
	if req.Display != nil {
		sets = append(sets, "display = ?")
		args = append(args, strings.TrimSpace(*req.Display))
	}
	if req.Email != nil {
		sets = append(sets, "email = ?")
		args = append(args, strings.TrimSpace(*req.Email))
	}
	if req.Bio != nil {
		sets = append(sets, "bio = ?")
		args = append(args, *req.Bio)
	}
	if req.Location != nil {
		sets = append(sets, "location = ?")
		args = append(args, strings.TrimSpace(*req.Location))
	}
	if req.CoverPreset != nil {
		sets = append(sets, "cover_preset = ?")
		args = append(args, strings.TrimSpace(*req.CoverPreset))
	}
	if req.CoverFrom != nil {
		sets = append(sets, "cover_from = ?")
		args = append(args, strings.TrimSpace(*req.CoverFrom))
	}
	if req.CoverTo != nil {
		sets = append(sets, "cover_to = ?")
		args = append(args, strings.TrimSpace(*req.CoverTo))
	}
	if len(sets) == 0 {
		return s.GetUser(username)
	}
	args = append(args, username)
	q := "UPDATE users SET " + strings.Join(sets, ", ") + " WHERE username = ?"
	res, err := s.DB.Exec(q, args...)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, errors.New("user not found")
	}
	_, _ = s.DB.Exec(`INSERT INTO audit_logs(actor,action,target,ip) VALUES(?,?,?,?)`,
		username, "update_profile", "@"+username, "127.0.0.1")
	return s.GetUser(username)
}

// SetAvatarURL updates only the avatar_url column on a user, used by the
// avatar upload handler. An empty string clears the column (back to gradient
// fallback). Writes an audit log entry so changes are visible in the trail.
func (s *Store) SetAvatarURL(username, url string) (*model.Me, error) {
	res, err := s.DB.Exec(`UPDATE users SET avatar_url = ? WHERE username = ?`, url, username)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, errors.New("user not found")
	}
	_, _ = s.DB.Exec(`INSERT INTO audit_logs(actor,action,target,ip) VALUES(?,?,?,?)`,
		username, "update_profile", "@"+username, "127.0.0.1")
	return s.GetUser(username)
}

// MeStats aggregates per-user counts across skills, ratings, and reviews.
func (s *Store) MeStats(username string) (*model.MeStats, error) {
	// Use case-expressions instead of FILTER so we work on older SQLite too.
	out := &model.MeStats{}
	var ratingsSum int
	if err := s.DB.QueryRow(`
		SELECT
			COALESCE(SUM(CASE WHEN status='published' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN status='draft'     THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(activations),    0),
			COALESCE(SUM(ratings_count),  0),
			COALESCE(SUM(ratings_sum),    0)
		FROM skills WHERE author = ?`, username).Scan(
		&out.Published, &out.Drafts, &out.Activations, &out.RatingsReceived, &ratingsSum,
	); err != nil {
		return nil, err
	}
	if out.RatingsReceived > 0 {
		out.AvgRating = float64(ratingsSum) / float64(out.RatingsReceived)
	}

	// Pending reviews assigned to me (csv match).
	if err := s.DB.QueryRow(`
		SELECT COUNT(*) FROM reviews
		WHERE status = 'pending'
		  AND (',' || reviewers_csv || ',') LIKE ?`,
		"%,"+username+",%").Scan(&out.PendingReviews); err != nil {
		return nil, err
	}
	// Reviews completed by me (audit-log proxy).
	if err := s.DB.QueryRow(`
		SELECT COUNT(*) FROM audit_logs
		WHERE actor = ? AND action IN ('approve_review','reject_review','request_changes')`,
		username).Scan(&out.ReviewsCompleted); err != nil {
		return nil, err
	}
	return out, nil
}

// ChangePassword validates oldPassword against the stored hash, then replaces
// it with the hash of newPassword. Returns an error if oldPassword is wrong.
func (s *Store) ChangePassword(username, oldPassword, newPassword string) error {
	var hash string
	if err := s.DB.QueryRow(`SELECT password_hash FROM users WHERE username=?`, username).Scan(&hash); err != nil {
		if err == sql.ErrNoRows {
			return errors.New("user not found")
		}
		return err
	}
	if !auth.VerifyPassword(hash, oldPassword) {
		return errors.New("旧密码不正确")
	}
	newHash, err := auth.HashPassword(newPassword)
	if err != nil {
		return err
	}
	if _, err := s.DB.Exec(`UPDATE users SET password_hash=? WHERE username=?`, newHash, username); err != nil {
		return err
	}
	_, _ = s.DB.Exec(`INSERT INTO audit_logs(actor,action,target,ip) VALUES(?,?,?,?)`,
		username, "change_password", "@"+username, "127.0.0.1")
	return nil
}

// ReviewStats summarises the entire approval queue. Decision-time stats only
// count rows that have a decided_at value, so legacy rows don't pollute the
// average.
func (s *Store) ReviewStats() (*model.ReviewStats, error) {
	out := &model.ReviewStats{AvgDecisionHours: -1}
	rows, err := s.DB.Query(`SELECT status, urgency FROM reviews`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var status, urgency string
		if err := rows.Scan(&status, &urgency); err != nil {
			rows.Close()
			return nil, err
		}
		out.Total++
		switch status {
		case "pending":
			out.Pending++
			if urgency == "overdue" {
				out.Overdue++
			}
		case "approved":
			out.Approved++
		case "rejected", "changes_requested":
			out.Rejected++
		}
	}
	rows.Close()

	// SLA compliance: % of decided reviews whose urgency != 'overdue'.
	decided := out.Approved + out.Rejected
	if decided > 0 {
		var lateDecided int
		if err := s.DB.QueryRow(`
			SELECT COUNT(*) FROM reviews
			WHERE status IN ('approved','rejected','changes_requested') AND urgency='overdue'`,
		).Scan(&lateDecided); err != nil {
			return nil, err
		}
		out.SLAComplianceRate = float64(decided-lateDecided) / float64(decided) * 100.0
	}

	// Avg decision hours, only over rows that have decided_at.
	var avg sql.NullFloat64
	if err := s.DB.QueryRow(`
		SELECT AVG((julianday(decided_at) - julianday(submitted_at)) * 24.0)
		FROM reviews
		WHERE decided_at IS NOT NULL`).Scan(&avg); err == nil && avg.Valid {
		out.AvgDecisionHours = avg.Float64
	}
	return out, nil
}

// CreateNamespace inserts a new namespace and registers the owner as 'owner'.
// Returns the created Namespace row (with count=0).
func (s *Store) CreateNamespace(id, owner string) (*model.Namespace, error) {
	id = strings.TrimSpace(id)
	owner = strings.TrimSpace(owner)
	if id == "" || owner == "" {
		return nil, errors.New("namespace id and owner are required")
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	// Owner must exist as a real user.
	var u string
	if err := tx.QueryRow(`SELECT username FROM users WHERE username = ?`, owner).Scan(&u); err != nil {
		if err == sql.ErrNoRows {
			return nil, errors.New("owner user does not exist")
		}
		return nil, err
	}

	if _, err := tx.Exec(`INSERT INTO namespaces(id, owner) VALUES(?, ?)`, id, owner); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(`INSERT INTO namespace_members(ns, username, ns_role) VALUES(?, ?, 'owner')`, id, owner); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(`INSERT INTO audit_logs(actor,action,target,ip) VALUES(?,?,?,?)`,
		owner, "create_namespace", id, "127.0.0.1"); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &model.Namespace{ID: id, Owner: owner, Count: 0}, nil
}

// UpdateSkillMeta applies a partial update to a skill's metadata fields.
// Only non-nil fields in req are written. Returns the refreshed skill row.
func (s *Store) UpdateSkillMeta(ns, name string, req model.UpdateSkillMetaRequest) (*model.Skill, error) {
	sets := []string{}
	args := []any{}
	if req.Description != nil {
		sets = append(sets, "description = ?")
		args = append(args, strings.TrimSpace(*req.Description))
	}
	if req.LongDesc != nil {
		sets = append(sets, "long_desc = ?")
		args = append(args, *req.LongDesc)
	}
	if req.Icon != nil {
		sets = append(sets, "icon = ?")
		args = append(args, *req.Icon)
	}
	if req.IconClass != nil {
		sets = append(sets, "icon_class = ?")
		args = append(args, *req.IconClass)
	}
	if req.Classification != nil {
		c := *req.Classification
		if c != "L1" && c != "L2" && c != "L3" {
			return nil, errors.New("classification must be L1, L2, or L3")
		}
		sets = append(sets, "classification = ?")
		args = append(args, c)
	}
	if req.Version != nil {
		sets = append(sets, "version = ?")
		args = append(args, strings.TrimSpace(*req.Version))
	}
	if req.Tags != nil {
		sets = append(sets, "tags_csv = ?")
		args = append(args, strings.Join(req.Tags, ","))
	}
	if len(sets) == 0 {
		return s.GetSkill(ns, name)
	}
	sets = append(sets, "updated_at = CURRENT_TIMESTAMP")
	args = append(args, ns, name)
	res, err := s.DB.Exec("UPDATE skills SET "+strings.Join(sets, ", ")+" WHERE ns = ? AND name = ?", args...)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, errors.New("skill not found")
	}
	return s.GetSkill(ns, name)
}

// SetSkillLongDesc updates the markdown README body of a skill. Author or a
// namespace maintainer/owner is expected to be enforced by the caller.
func (s *Store) SetSkillLongDesc(ns, name, longDesc string) error {
	res, err := s.DB.Exec(`UPDATE skills SET long_desc = ?, updated_at = CURRENT_TIMESTAMP WHERE ns = ? AND name = ?`,
		longDesc, ns, name)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return errors.New("skill not found")
	}
	return nil
}
