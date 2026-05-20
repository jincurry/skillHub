package store

import (
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/jincurry/skillhub/server/internal/audit"
	"github.com/jincurry/skillhub/server/internal/model"
)

// validRole is the canonical set of namespace roles. Kept here so add/patch
// member calls reject typos consistently.
func validRole(r string) bool {
	switch r {
	case "owner", "maintainer", "reviewer", "member":
		return true
	}
	return false
}

// bumpedVersion returns the next patch version. "1.2.3" → "1.2.4". Falls back
// to appending ".1" if the input isn't a clean semver-ish triple.
var semverRe = regexp.MustCompile(`^(\d+)\.(\d+)\.(\d+)([-+].*)?$`)

func bumpedVersion(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return "0.1.0"
	}
	m := semverRe.FindStringSubmatch(v)
	if m == nil {
		return v + ".1"
	}
	patch, err := strconv.Atoi(m[3])
	if err != nil {
		return v + ".1"
	}
	return fmt.Sprintf("%s.%s.%d", m[1], m[2], patch+1)
}

// CreateDraftVersion lets the author of a published / yanked / deprecated skill
// open a new editable draft. The current skill row is mutated in place:
//   - status        → 'draft'
//   - version       → newVersion (or auto-bumped if empty)
//
// The previous published version stays in skill_versions for audit/diff.
//
// Validation:
//   - skill must exist
//   - skill.status must be 'published', 'yanked', or 'deprecated' (cannot
//     stack drafts on top of a draft / in-flight review)
//   - newVersion (if provided) must be different from the current version
func (s *Store) CreateDraftVersion(ns, name, newVersion, actor string) (*model.Skill, error) {
	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var status, current string
	if err := tx.QueryRow(`SELECT status, version FROM skills WHERE ns=? AND name=?`, ns, name).Scan(&status, &current); err != nil {
		if err == sql.ErrNoRows {
			return nil, errors.New("skill not found")
		}
		return nil, err
	}
	switch status {
	case "published", "yanked", "deprecated":
		// allowed
	default:
		return nil, errors.New("skill is " + status + "; create a draft only from published / yanked / deprecated")
	}

	newVersion = strings.TrimSpace(newVersion)
	if newVersion == "" {
		newVersion = bumpedVersion(current)
	}
	if newVersion == current {
		return nil, errors.New("new version must differ from current " + current)
	}

	if _, err := tx.Exec(`UPDATE skills SET status='draft', version=?, updated_at=CURRENT_TIMESTAMP WHERE ns=? AND name=?`,
		newVersion, ns, name); err != nil {
		return nil, err
	}
	if err := audit.LogTx(tx, actor, "create_draft", ns+"/"+name, "v"+newVersion, ""); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetSkill(ns, name)
}

// ---------------------------------------------------------------------------
// Namespace member mutations. Existing list / role-lookup helpers live in
// members.go; this file owns the writes.
// ---------------------------------------------------------------------------

// AddNamespaceMember inserts a member row. Fails if the user doesn't exist or
// is already a member. The 'owner' role is reserved for the namespace's
// canonical owner (set at namespace create time); we still allow adding extra
// owners but the caller is expected to gate that.
func (s *Store) AddNamespaceMember(ns, username, role, actor string) error {
	username = strings.TrimSpace(username)
	role = strings.TrimSpace(role)
	if username == "" {
		return errors.New("username is required")
	}
	if !validRole(role) {
		return errors.New("invalid role; must be one of owner/maintainer/reviewer/member")
	}

	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var nsExists int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM namespaces WHERE id=?`, ns).Scan(&nsExists); err != nil {
		return err
	}
	if nsExists == 0 {
		return errors.New("namespace not found")
	}
	var userExists int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM users WHERE username=?`, username).Scan(&userExists); err != nil {
		return err
	}
	if userExists == 0 {
		return errors.New("user @" + username + " does not exist")
	}
	var memberExists int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM namespace_members WHERE ns=? AND username=?`, ns, username).Scan(&memberExists); err != nil {
		return err
	}
	if memberExists > 0 {
		return errors.New("@" + username + " is already a member of " + ns)
	}
	if _, err := tx.Exec(`INSERT INTO namespace_members(ns, username, ns_role) VALUES(?, ?, ?)`, ns, username, role); err != nil {
		return err
	}
	if err := audit.LogTx(tx, actor, "add_member", ns+":@"+username+"/"+role, "", ""); err != nil {
		return err
	}
	body := fmt.Sprintf("@%s 把你加入了 %s (%s)", actor, ns, role)
	if _, err := tx.Exec(`INSERT INTO notifications(user,kind,target_kind,target_ref,body,unread) VALUES(?,?,?,?,?,1)`,
		username, "review", "namespace", ns, body); err != nil {
		// Notification is nice-to-have; don't fail the whole call.
		_ = err
	}
	return tx.Commit()
}

// UpdateNamespaceMemberRole changes an existing member's role. Returns an
// error if the member doesn't exist or the role is invalid.
func (s *Store) UpdateNamespaceMemberRole(ns, username, role, actor string) error {
	if !validRole(role) {
		return errors.New("invalid role")
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var current string
	if err := tx.QueryRow(`SELECT ns_role FROM namespace_members WHERE ns=? AND username=?`, ns, username).Scan(&current); err != nil {
		if err == sql.ErrNoRows {
			return errors.New("@" + username + " is not a member of " + ns)
		}
		return err
	}
	if current == role {
		return nil
	}
	// Prevent demoting the last owner.
	if current == "owner" && role != "owner" {
		var owners int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM namespace_members WHERE ns=? AND ns_role='owner'`, ns).Scan(&owners); err != nil {
			return err
		}
		if owners <= 1 {
			return errors.New("cannot demote the last owner of " + ns)
		}
	}
	if _, err := tx.Exec(`UPDATE namespace_members SET ns_role=? WHERE ns=? AND username=?`, role, ns, username); err != nil {
		return err
	}
	if err := audit.LogTx(tx, actor, "update_member_role", ns+":@"+username+"/"+role, "", ""); err != nil {
		return err
	}
	return tx.Commit()
}

// RemoveNamespaceMember drops a member. Refuses to remove the last owner.
func (s *Store) RemoveNamespaceMember(ns, username, actor string) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var current string
	if err := tx.QueryRow(`SELECT ns_role FROM namespace_members WHERE ns=? AND username=?`, ns, username).Scan(&current); err != nil {
		if err == sql.ErrNoRows {
			return errors.New("@" + username + " is not a member of " + ns)
		}
		return err
	}
	if current == "owner" {
		var owners int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM namespace_members WHERE ns=? AND ns_role='owner'`, ns).Scan(&owners); err != nil {
			return err
		}
		if owners <= 1 {
			return errors.New("cannot remove the last owner of " + ns)
		}
	}
	if _, err := tx.Exec(`DELETE FROM namespace_members WHERE ns=? AND username=?`, ns, username); err != nil {
		return err
	}
	if err := audit.LogTx(tx, actor, "remove_member", ns+":@"+username, "", ""); err != nil {
		return err
	}
	return tx.Commit()
}

// ListSkillFilesAtVersion returns the file bundle as it existed at a
// specific published version. Used by the `?tag=` bundle download so a
// consumer pinned to "stable" gets the right snapshot even after the
// author has moved on.
//
// Resolution strategy:
//
//  1. If `version` matches the skill's current row, defer to the live
//     skill_files (cheapest, also covers in-flight drafts).
//  2. Otherwise look up the most recently submitted review for that
//     (ns, name, version) and serve its review_files snapshot.
//  3. If no snapshot exists (legacy skills published before snapshots
//     landed), return ErrNoRows so the caller can 404.
func (s *Store) ListSkillFilesAtVersion(ns, name, version string) ([]model.SkillFile, error) {
	var currentVersion string
	err := s.DB.QueryRow(`SELECT version FROM skills WHERE ns=? AND name=?`, ns, name).Scan(&currentVersion)
	if err != nil {
		return nil, err
	}
	if currentVersion == version {
		return s.ListSkillFilesWithContent(ns, name)
	}
	// Pull the snapshot from the most recent review for that exact version.
	// Approved reviews are preferred (those represent published bundles),
	// but we fall back to any review id since a yanked version still gives
	// a meaningful bundle.
	var reviewID int64
	err = s.DB.QueryRow(`
		SELECT id FROM reviews
		WHERE ns = ? AND skill_name = ? AND version = ?
		ORDER BY (status='approved') DESC, id DESC
		LIMIT 1`, ns, name, version).Scan(&reviewID)
	if err != nil {
		return nil, err
	}
	rows, err := s.DB.Query(`SELECT path, new_content
		FROM review_files
		WHERE review_id = ? AND lower(path) <> 'readme.md'
		ORDER BY path`, reviewID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]model.SkillFile, 0)
	for rows.Next() {
		var f model.SkillFile
		if err := rows.Scan(&f.Path, &f.Content); err != nil {
			return nil, err
		}
		f.Size = len(f.Content)
		out = append(out, f)
	}
	return out, rows.Err()
}

// ListSkillFilesWithContent is used by the bundle endpoint — the standard
// ListSkillFiles excludes content to keep listings cheap. Order matches
// ListSkillFiles so directory traversal is deterministic.
func (s *Store) ListSkillFilesWithContent(ns, name string) ([]model.SkillFile, error) {
	rows, err := s.DB.Query(`SELECT path, content, size, updated_at, updated_by
		FROM skill_files
		WHERE ns=? AND skill_name=? AND lower(path) <> 'readme.md'
		ORDER BY path`, ns, name)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]model.SkillFile, 0)
	for rows.Next() {
		var f model.SkillFile
		if err := rows.Scan(&f.Path, &f.Content, &f.Size, &f.UpdatedAt, &f.UpdatedBy); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// RollbackToVersion is the "hard rollback" path: it overwrites the live
// skill_files with the snapshot from a previously published version, points
// the skill row at that old version, bumps the `latest` dist tag, and
// notifies subscribers.
//
// Constraints:
//   - skill must be in published / yanked / deprecated (not mid-review)
//   - target version must exist in skill_versions and != current version
//   - target's review_files snapshot must exist (legacy versions without
//     snapshots can't be rolled back via this path)
//   - reason is required and goes into audit_logs + notification body
//
// A new skill_versions row is inserted (status='published', review_id=0)
// with a note like "rollback from v1.2.0 to v1.1.0: <reason>" so the
// version list shows the rollback action without silently mutating older
// rows.
func (s *Store) RollbackToVersion(ns, name, target, reason, actor string) (*model.Skill, error) {
	target = strings.TrimSpace(target)
	reason = strings.TrimSpace(reason)
	if target == "" {
		return nil, errors.New("target version is required")
	}
	if reason == "" {
		return nil, errors.New("rollback reason is required")
	}

	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var status, current, author string
	if err := tx.QueryRow(`SELECT status, version, author FROM skills WHERE ns=? AND name=?`, ns, name).Scan(&status, &current, &author); err != nil {
		if err == sql.ErrNoRows {
			return nil, errors.New("skill not found")
		}
		return nil, err
	}
	switch status {
	case "published", "yanked", "deprecated":
		// allowed
	default:
		return nil, errors.New("skill is " + status + "; cannot rollback while in draft / review")
	}
	if target == current {
		return nil, errors.New("target version equals current; nothing to rollback")
	}

	// Resolve the review_id whose review_files holds the snapshot for
	// `target`. Mirror ListSkillFilesAtVersion: prefer approved reviews,
	// fall back to most recent review id.
	var reviewID int64
	err = tx.QueryRow(`
		SELECT id FROM reviews
		WHERE ns = ? AND skill_name = ? AND version = ?
		ORDER BY (status='approved') DESC, id DESC
		LIMIT 1`, ns, name, target).Scan(&reviewID)
	if err == sql.ErrNoRows {
		return nil, errors.New("no snapshot found for version " + target)
	}
	if err != nil {
		return nil, err
	}

	// Pull the snapshot from review_files. Use new_content (the body the
	// author submitted at that review) as the canonical state of the file
	// at that version.
	rows, err := tx.Query(`SELECT path, new_content FROM review_files WHERE review_id = ? AND lower(path) <> 'readme.md'`, reviewID)
	if err != nil {
		return nil, err
	}
	type snap struct {
		path, body string
	}
	var snaps []snap
	for rows.Next() {
		var p, b string
		if err := rows.Scan(&p, &b); err != nil {
			rows.Close()
			return nil, err
		}
		snaps = append(snaps, snap{p, b})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(snaps) == 0 {
		return nil, errors.New("snapshot for version " + target + " is empty; cannot rollback")
	}

	// Wipe live files, re-insert from snapshot. Single-writer SQLite + tx
	// guarantees no concurrent reader sees an empty file list.
	if _, err := tx.Exec(`DELETE FROM skill_files WHERE ns=? AND skill_name=?`, ns, name); err != nil {
		return nil, err
	}
	for _, sn := range snaps {
		if _, err := tx.Exec(`
			INSERT INTO skill_files(ns, skill_name, path, content, size, updated_by, updated_at)
			VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
			ns, name, sn.path, sn.body, len(sn.body), actor); err != nil {
			return nil, err
		}
	}

	// Point the skill row at the rolled-back version. Status stays
	// 'published' because the rolled-back content is, by definition, a
	// previously approved bundle.
	if _, err := tx.Exec(`UPDATE skills SET status='published', version=?, updated_at=CURRENT_TIMESTAMP WHERE ns=? AND name=?`,
		target, ns, name); err != nil {
		return nil, err
	}

	// Insert a new skill_versions row recording the rollback. review_id=0
	// because there is no real review behind a rollback. Status='published'
	// so dist-tag bookkeeping (which checks skill_versions exists) is happy.
	note := fmt.Sprintf("rollback from v%s to v%s: %s", current, target, reason)
	if _, err := tx.Exec(`INSERT INTO skill_versions(ns,name,version,status,author,note,review_id) VALUES(?,?,?,?,?,?,0)`,
		ns, name, target, "published", actor, note); err != nil {
		return nil, err
	}

	// Auto-bump `latest` so consumers pinned to it pick up the rollback.
	if err := upsertDistTagTx(tx, ns, name, "latest", target, actor); err != nil {
		return nil, err
	}

	// Audit + fan-out notifications. Use a rollback-specific notification
	// body so subscribers can tell this from a normal publish.
	if err := audit.LogTx(tx, actor, "rollback", ns+"/"+name+": "+reason, "v"+target, ""); err != nil {
		return nil, err
	}
	notifBody := ns + "/" + name + " 已回滚到 v" + target
	target_ref := ns + "/" + name
	if _, err := tx.Exec(`
		INSERT INTO notifications(user, kind, target_kind, target_ref, body)
		SELECT username, 'publish', 'skill', ?, ?
		  FROM subscriptions
		 WHERE ns = ? AND skill_name = ?
		   AND username != ? AND username != ?`,
		target_ref, notifBody, ns, name, author, actor); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetSkill(ns, name)
}
