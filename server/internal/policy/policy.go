package policy

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
