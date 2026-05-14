package store

import (
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

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
	if _, err := tx.Exec(`INSERT INTO audit_logs(actor,action,target,version,ip) VALUES(?,?,?,?,?)`,
		actor, "create_draft", ns+"/"+name, "v"+newVersion, "127.0.0.1"); err != nil {
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
	if _, err := tx.Exec(`INSERT INTO audit_logs(actor,action,target,version,ip) VALUES(?,?,?,?,?)`,
		actor, "add_member", ns+":@"+username+"/"+role, "", "127.0.0.1"); err != nil {
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
	if _, err := tx.Exec(`INSERT INTO audit_logs(actor,action,target,version,ip) VALUES(?,?,?,?,?)`,
		actor, "update_member_role", ns+":@"+username+"/"+role, "", "127.0.0.1"); err != nil {
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
	if _, err := tx.Exec(`INSERT INTO audit_logs(actor,action,target,version,ip) VALUES(?,?,?,?,?)`,
		actor, "remove_member", ns+":@"+username, "", "127.0.0.1"); err != nil {
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
		FROM review_files WHERE review_id = ? ORDER BY path`, reviewID)
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
		FROM skill_files WHERE ns=? AND skill_name=? ORDER BY path`, ns, name)
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
