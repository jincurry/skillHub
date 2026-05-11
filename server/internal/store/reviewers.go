package store

import (
	"database/sql"
	"errors"
	"strings"

	"github.com/jincurry/skillhub/server/internal/model"
)

// reviewerCSVOps centralises CSV manipulation so add/remove agree on whitespace
// and duplicate handling.
func splitReviewers(csv string) []string {
	parts := strings.Split(csv, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// AddReviewer appends `username` to a pending review's reviewers list.
// Returns the refreshed Review.
//
// Validation rules (all surface as user-facing errors):
//   - review must exist
//   - review.status must be 'pending' (closed reviews are immutable)
//   - username must be a real, non-bot user
//   - username cannot equal the review author (no self-approval)
//   - username must not already be a reviewer
func (s *Store) AddReviewer(reviewID int64, username, actor string) (*model.Review, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return nil, errors.New("username is required")
	}
	if username == "system" {
		return nil, errors.New("'system' cannot be a reviewer")
	}

	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var ns, name, version, author, revCSV, status string
	err = tx.QueryRow(`SELECT ns, skill_name, version, author, reviewers_csv, status
		FROM reviews WHERE id=?`, reviewID).Scan(&ns, &name, &version, &author, &revCSV, &status)
	if err == sql.ErrNoRows {
		return nil, errors.New("review not found")
	}
	if err != nil {
		return nil, err
	}
	if status != "pending" {
		return nil, errors.New("review is " + status + "; reviewers can only change while pending")
	}
	if username == author {
		return nil, errors.New("review author cannot be added as a reviewer")
	}

	// Real user check — also keeps a typo from silently creating ghost reviewers.
	var exists int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM users WHERE username=?`, username).Scan(&exists); err != nil {
		return nil, err
	}
	if exists == 0 {
		return nil, errors.New("user @" + username + " does not exist")
	}

	cur := splitReviewers(revCSV)
	for _, r := range cur {
		if r == username {
			return nil, errors.New("@" + username + " is already a reviewer")
		}
	}
	cur = append(cur, username)
	newCSV := strings.Join(cur, ",")

	if _, err := tx.Exec(`UPDATE reviews SET reviewers_csv=? WHERE id=?`, newCSV, reviewID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(`INSERT INTO audit_logs(actor,action,target,version,ip) VALUES(?,?,?,?,?)`,
		actor, "add_reviewer", ns+"/"+name+":@"+username, "v"+version, "127.0.0.1"); err != nil {
		return nil, err
	}
	body := "@" + actor + " 邀请你审批 " + ns + "/" + name + " v" + version
	if _, err := tx.Exec(`INSERT INTO notifications(user,kind,body) VALUES(?,?,?)`,
		username, "review", body); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetReview(reviewID)
}

// RemoveReviewer drops `username` from a pending review's reviewers list.
// Removing a reviewer who has already posted a decision is allowed — the
// comments and audit trail they left behind are preserved.
func (s *Store) RemoveReviewer(reviewID int64, username, actor string) (*model.Review, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return nil, errors.New("username is required")
	}

	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var ns, name, version, revCSV, status string
	err = tx.QueryRow(`SELECT ns, skill_name, version, reviewers_csv, status
		FROM reviews WHERE id=?`, reviewID).Scan(&ns, &name, &version, &revCSV, &status)
	if err == sql.ErrNoRows {
		return nil, errors.New("review not found")
	}
	if err != nil {
		return nil, err
	}
	if status != "pending" {
		return nil, errors.New("review is " + status + "; reviewers can only change while pending")
	}

	cur := splitReviewers(revCSV)
	kept := make([]string, 0, len(cur))
	found := false
	for _, r := range cur {
		if r == username {
			found = true
			continue
		}
		kept = append(kept, r)
	}
	if !found {
		return nil, errors.New("@" + username + " is not a reviewer of this review")
	}
	if len(kept) == 0 {
		return nil, errors.New("cannot remove the last reviewer; close the review instead")
	}

	if _, err := tx.Exec(`UPDATE reviews SET reviewers_csv=? WHERE id=?`, strings.Join(kept, ","), reviewID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(`INSERT INTO audit_logs(actor,action,target,version,ip) VALUES(?,?,?,?,?)`,
		actor, "remove_reviewer", ns+"/"+name+":@"+username, "v"+version, "127.0.0.1"); err != nil {
		return nil, err
	}
	// Notify the removed reviewer so the assignment doesn't silently vanish
	// from their queue.
	body := "@" + actor + " 已把你从 " + ns + "/" + name + " v" + version + " 的审批中移除"
	if _, err := tx.Exec(`INSERT INTO notifications(user,kind,body) VALUES(?,?,?)`,
		username, "review", body); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetReview(reviewID)
}
