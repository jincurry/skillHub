package api

import (
	"github.com/gin-gonic/gin"

	"github.com/jincurry/skillhub/server/internal/policy"
)

// listNamespacePolicies returns L1/L2/L3 policies for the namespace, with an
// `isOverride` flag so the admin UI can distinguish stored overrides from
// the global defaults.
func (s *Server) listNamespacePolicies(c *gin.Context) {
	ns := c.Param("ns")
	out, err := s.store.ListNamespacePolicies(ns)
	if err != nil {
		serverError(c, err)
		return
	}
	c.JSON(200, gin.H{"ns": ns, "policies": out})
}

// upsertNamespacePolicyRequest is the JSON body for PUT
// /admin/namespaces/:ns/policies/:classification.
type upsertNamespacePolicyRequest struct {
	Mode     string        `json:"mode"     binding:"required,oneof=parallel serial"`
	SLAHours int           `json:"slaHours" binding:"required,min=1,max=720"`
	Slots    []policy.Slot `json:"slots"    binding:"required,min=1,max=8,dive"`
}

// upsertNamespacePolicy validates input then stores the override. The
// classification path param is the source of truth (we ignore any classifi-
// cation field in the body) so a single mistyped tab can't cross-write.
func (s *Server) upsertNamespacePolicy(c *gin.Context) {
	ns := c.Param("ns")
	cls := c.Param("classification")
	if cls != "L1" && cls != "L2" && cls != "L3" {
		c.JSON(400, gin.H{"error": "classification must be L1, L2 or L3"})
		return
	}
	var req upsertNamespacePolicyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	// Validate every slot has at least one role and a positive count.
	for i, slot := range req.Slots {
		if slot.Count < 1 || slot.Count > 16 {
			c.JSON(400, gin.H{"error": "slot " + itoa(i) + ": count must be 1..16"})
			return
		}
		if len(slot.Roles) == 0 {
			c.JSON(400, gin.H{"error": "slot " + itoa(i) + ": at least one role required"})
			return
		}
		for _, r := range slot.Roles {
			switch r {
			case "owner", "maintainer", "reviewer", "member":
			default:
				c.JSON(400, gin.H{"error": "slot " + itoa(i) + ": unknown role " + r})
				return
			}
		}
	}
	pol := policy.Policy{
		Classification: cls,
		Mode:           req.Mode,
		SLAHours:       req.SLAHours,
		Slots:          req.Slots,
	}
	actor := s.currentUser(c)
	if err := s.store.UpsertNamespacePolicy(ns, cls, pol, actor); err != nil {
		serverError(c, err)
		return
	}
	// Echo back the full list so the UI can refresh in one round-trip.
	out, err := s.store.ListNamespacePolicies(ns)
	if err != nil {
		serverError(c, err)
		return
	}
	c.JSON(200, gin.H{"ns": ns, "policies": out})
}

// deleteNamespacePolicy removes the override row, falling back to the global
// default. Idempotent: deleting a non-existent override is fine.
func (s *Server) deleteNamespacePolicy(c *gin.Context) {
	ns := c.Param("ns")
	cls := c.Param("classification")
	if cls != "L1" && cls != "L2" && cls != "L3" {
		c.JSON(400, gin.H{"error": "classification must be L1, L2 or L3"})
		return
	}
	if err := s.store.DeleteNamespacePolicy(ns, cls); err != nil {
		serverError(c, err)
		return
	}
	out, err := s.store.ListNamespacePolicies(ns)
	if err != nil {
		serverError(c, err)
		return
	}
	c.JSON(200, gin.H{"ns": ns, "policies": out})
}

// itoa is a tiny strconv.Itoa stand-in so we don't pull strconv into a file
// that only needs it for two error messages.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
