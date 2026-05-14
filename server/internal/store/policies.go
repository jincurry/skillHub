package store

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/jincurry/skillhub/server/internal/policy"
)

// ResolvePolicy returns the effective approval policy for a (namespace,
// classification) pair. The lookup order is:
//
//  1. namespace_policies row, if one exists.
//  2. The hard-coded default from policy.ForClassification.
//
// The second return value reports whether an override was found, which is
// what the admin UI uses to render "default" vs "custom" badges.
func (s *Store) ResolvePolicy(ns, classification string) (policy.Policy, bool, error) {
	var mode, slotsJSON string
	var slaHours int
	err := s.DB.QueryRow(`
		SELECT mode, sla_hours, slots_json
		FROM namespace_policies
		WHERE ns = ? AND classification = ?`, ns, classification).Scan(&mode, &slaHours, &slotsJSON)
	if err == sql.ErrNoRows {
		return policy.ForClassification(classification), false, nil
	}
	if err != nil {
		return policy.Policy{}, false, err
	}
	var slots []policy.Slot
	if err := json.Unmarshal([]byte(slotsJSON), &slots); err != nil {
		// Corrupt row — fall back to default rather than break the submit
		// path; admin can re-save to fix.
		return policy.ForClassification(classification), false, fmt.Errorf("namespace_policies(%s,%s).slots_json decode: %w", ns, classification, err)
	}
	return policy.Policy{
		Classification: classification,
		Mode:           mode,
		SLAHours:       slaHours,
		Slots:          slots,
	}, true, nil
}

// UpsertNamespacePolicy writes (or replaces) the namespace-level override.
// Validation of `mode` / classification / slot shape happens in the API
// handler so the store stays focused on persistence.
func (s *Store) UpsertNamespacePolicy(ns, classification string, p policy.Policy, actor string) error {
	slotsJSON, err := json.Marshal(p.Slots)
	if err != nil {
		return err
	}
	_, err = s.DB.Exec(`
		INSERT INTO namespace_policies(ns, classification, mode, sla_hours, slots_json, updated_by)
		VALUES(?,?,?,?,?,?)
		ON CONFLICT(ns, classification) DO UPDATE SET
			mode       = excluded.mode,
			sla_hours  = excluded.sla_hours,
			slots_json = excluded.slots_json,
			updated_by = excluded.updated_by,
			updated_at = CURRENT_TIMESTAMP
	`, ns, classification, p.Mode, p.SLAHours, string(slotsJSON), actor)
	return err
}

// DeleteNamespacePolicy removes the override row, causing future reviews to
// fall back to the global default. No-op if no row exists.
func (s *Store) DeleteNamespacePolicy(ns, classification string) error {
	_, err := s.DB.Exec(`DELETE FROM namespace_policies WHERE ns = ? AND classification = ?`, ns, classification)
	return err
}

// NamespacePolicyView packages one policy with the metadata the admin UI
// needs to distinguish a default from an explicit override.
type NamespacePolicyView struct {
	Classification string        `json:"classification"`
	Mode           string        `json:"mode"`
	SLAHours       int           `json:"slaHours"`
	Slots          []policy.Slot `json:"slots"`
	IsOverride     bool          `json:"isOverride"`
}

// ListNamespacePolicies returns the effective policy for every supported
// classification (L1, L2, L3) for one namespace. Each entry reports whether
// it's a stored override or a fallback to the default.
func (s *Store) ListNamespacePolicies(ns string) ([]NamespacePolicyView, error) {
	out := make([]NamespacePolicyView, 0, 3)
	for _, cls := range []string{"L1", "L2", "L3"} {
		p, overridden, err := s.ResolvePolicy(ns, cls)
		if err != nil {
			return nil, err
		}
		out = append(out, NamespacePolicyView{
			Classification: cls,
			Mode:           p.Mode,
			SLAHours:       p.SLAHours,
			Slots:          p.Slots,
			IsOverride:     overridden,
		})
	}
	return out, nil
}
