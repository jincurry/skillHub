package store

import (
	"database/sql"

	"github.com/jincurry/skillhub/server/internal/policy"
)

// NamespaceMember represents a (user, role) pair within a namespace.
type NamespaceMember struct {
	Username string `json:"username"`
	Role     string `json:"role"`
}

// ListNamespaceMembers returns all members of a namespace.
func (s *Store) ListNamespaceMembers(ns string) ([]NamespaceMember, error) {
	rows, err := s.DB.Query(`SELECT username, ns_role FROM namespace_members WHERE ns=? ORDER BY ns_role, username`, ns)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []NamespaceMember
	for rows.Next() {
		var m NamespaceMember
		if err := rows.Scan(&m.Username, &m.Role); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// UserRoleInNamespace returns the user's ns_role, or "" if not a member.
func (s *Store) UserRoleInNamespace(ns, user string) (string, error) {
	var role string
	err := s.DB.QueryRow(`SELECT ns_role FROM namespace_members WHERE ns=? AND username=?`, ns, user).Scan(&role)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return role, err
}

// PickHotfixReviewers picks reviewers using the relaxed `HotfixPolicy`
// (1 approver among owner/maintainer/reviewer, 4h SLA). Same selection rules
// as the regular picker — local namespace first, then cross-namespace
// fallback — just driven by a different slot list. We use the same code
// path so behaviour stays consistent (no special "first match" cheat).
func (s *Store) PickHotfixReviewers(ns, author, classification string) ([]string, error) {
	pol := policy.HotfixPolicy(classification)
	picked, err := s.pickReviewersForPolicy(ns, author, pol)
	if err != nil || len(picked) > 0 {
		return picked, err
	}
	// Last-ditch fallback: any owner/maintainer anywhere. This only fires
	// when no namespace member matched the hotfix slot at all (small / new
	// org), so we don't lose the ability to start an emergency review.
	row := s.DB.QueryRow(`
		SELECT username FROM namespace_members
		WHERE username != ? AND ns_role IN ('owner','maintainer')
		ORDER BY ns = ? DESC
		LIMIT 1`, author, ns)
	var u string
	if err := row.Scan(&u); err != nil {
		return nil, err
	}
	return []string{u}, nil
}

// PickReviewersByPolicy selects reviewer usernames that satisfy the given policy
// for namespace `ns`, excluding the author. Returns the picked reviewers in
// slot order, and the policy that was applied.
//
// Selection rules per slot:
//   - prefer users whose ns_role appears earliest in slot.Roles
//   - skip users already picked
//   - if the namespace cannot fill a slot, fall back to any namespace_members row
//     across all namespaces matching the same role priority (cross-team reviewers)
//   - never include `author`
func (s *Store) PickReviewersByPolicy(ns, author, classification string) ([]string, policy.Policy, error) {
	pol, _, err := s.ResolvePolicy(ns, classification)
	if err != nil {
		return nil, pol, err
	}
	picked, err := s.pickReviewersForPolicy(ns, author, pol)
	return picked, pol, err
}

// pickReviewersForPolicy is the shared slot-walking algorithm. It runs
// against an arbitrary policy so callers can inject HotfixPolicy without
// touching the namespace_policies table.
func (s *Store) pickReviewersForPolicy(ns, author string, pol policy.Policy) ([]string, error) {
	localMembers, err := s.ListNamespaceMembers(ns)
	if err != nil {
		return nil, err
	}

	picked := make([]string, 0, pol.TotalRequired())
	taken := map[string]bool{author: true}

	tryPickFrom := func(members []NamespaceMember, slot policy.Slot, need int) int {
		for _, role := range slot.Roles {
			if need == 0 {
				return 0
			}
			for _, m := range members {
				if need == 0 {
					break
				}
				if taken[m.Username] {
					continue
				}
				if m.Role == role {
					picked = append(picked, m.Username)
					taken[m.Username] = true
					need--
				}
			}
		}
		return need
	}

	for _, slot := range pol.Slots {
		need := slot.Count
		need = tryPickFrom(localMembers, slot, need)
		if need == 0 {
			continue
		}
		// Fallback: borrow from any other namespace.
		rows, err := s.DB.Query(`
			SELECT username, ns_role FROM namespace_members
			WHERE ns != ?
			ORDER BY CASE ns_role
				WHEN 'owner'      THEN 0
				WHEN 'maintainer' THEN 1
				WHEN 'reviewer'   THEN 2
				ELSE 3
			END`, ns)
		if err != nil {
			return nil, err
		}
		var crossMembers []NamespaceMember
		for rows.Next() {
			var m NamespaceMember
			if err := rows.Scan(&m.Username, &m.Role); err != nil {
				rows.Close()
				return nil, err
			}
			crossMembers = append(crossMembers, m)
		}
		rows.Close()
		_ = tryPickFrom(crossMembers, slot, need)
	}

	return picked, nil
}
