package policy

import (
	"github.com/jincurry/skillhub/server/internal/model"
)

// Slot describes one required reviewer position.
type Slot struct {
	// Roles eligible to fill this slot, in priority order.
	Roles []string
	// Required count of reviewers matching this slot.
	Count int
}

// Policy is the approval policy for a (namespace, classification) pair.
type Policy struct {
	Classification string
	Mode           string // parallel|serial — serial means reviewers approve in listed order
	SLAHours       int
	Slots          []Slot
}

// ForClassification returns the default policy for a classification.
// In MVP these are global (not per-namespace yet).
func ForClassification(classification string) Policy {
	switch classification {
	case "L1":
		return Policy{
			Classification: "L1",
			Mode:           "parallel",
			SLAHours:       24,
			Slots: []Slot{
				{Roles: []string{"owner", "maintainer"}, Count: 1},
			},
		}
	case "L3":
		return Policy{
			Classification: "L3",
			Mode:           "serial",
			SLAHours:       72,
			Slots: []Slot{
				{Roles: []string{"owner", "maintainer"}, Count: 1},
				{Roles: []string{"reviewer", "maintainer"}, Count: 1},
				// 3rd slot: prefer security-team. Caller will fall back to any reviewer.
				{Roles: []string{"reviewer"}, Count: 1},
			},
		}
	default: // L2
		return Policy{
			Classification: "L2",
			Mode:           "parallel",
			SLAHours:       48,
			Slots: []Slot{
				{Roles: []string{"owner", "maintainer"}, Count: 1},
				{Roles: []string{"reviewer", "maintainer"}, Count: 1},
			},
		}
	}
}

// TotalRequired sums all slot counts.
func (p Policy) TotalRequired() int {
	n := 0
	for _, s := range p.Slots {
		n += s.Count
	}
	return n
}

// HotfixPolicy returns the emergency-channel override: a single approver,
// 4-hour SLA, no role gating beyond "owner or maintainer". The submission
// path still requires a justification (hotfix_reason) that's audit-logged.
func HotfixPolicy(classification string) Policy {
	return Policy{
		Classification: classification,
		Mode:           "parallel",
		SLAHours:       4,
		Slots: []Slot{
			{Roles: []string{"owner", "maintainer"}, Count: 1},
		},
	}
}

// Snapshot converts a Policy into its JSON-serialisable model form.
func (p Policy) Snapshot(hotfix bool) *model.PolicySnapshot {
	slots := make([]model.PolicySlot, 0, len(p.Slots))
	for _, s := range p.Slots {
		slots = append(slots, model.PolicySlot{Roles: append([]string{}, s.Roles...), Count: s.Count})
	}
	return &model.PolicySnapshot{
		Classification: p.Classification,
		Mode:           p.Mode,
		SLAHours:       p.SLAHours,
		Slots:          slots,
		Hotfix:         hotfix,
	}
}

// FromSnapshot rehydrates a snapshot back into a runtime Policy so the
// reviewer-picker can still operate on it if needed.
func FromSnapshot(s *model.PolicySnapshot) Policy {
	if s == nil {
		return Policy{}
	}
	slots := make([]Slot, 0, len(s.Slots))
	for _, sl := range s.Slots {
		slots = append(slots, Slot{Roles: append([]string{}, sl.Roles...), Count: sl.Count})
	}
	return Policy{
		Classification: s.Classification,
		Mode:           s.Mode,
		SLAHours:       s.SLAHours,
		Slots:          slots,
	}
}
