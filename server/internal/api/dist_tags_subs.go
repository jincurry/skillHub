package api

import (
	"database/sql"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/jincurry/skillhub/server/internal/model"
)

// ---------- dist_tags --------------------------------------------------------

func (s *Server) listDistTags(c *gin.Context) {
	ns, name := c.Param("ns"), c.Param("name")
	out, err := s.store.ListDistTags(ns, name)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	if out == nil {
		out = []model.DistTag{}
	}
	c.JSON(200, out)
}

// setDistTag pins a tag to a version. Author-or-namespace-maintainer only.
func (s *Server) setDistTag(c *gin.Context) {
	ns, name, tag := c.Param("ns"), c.Param("name"), c.Param("tag")
	tag = strings.TrimSpace(tag)
	if tag == "" {
		c.JSON(400, gin.H{"error": "tag is required"})
		return
	}
	user := s.currentUser(c)
	allowed, err := s.canEditSkill(user, ns, name)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	if !allowed {
		c.JSON(403, gin.H{"error": "需要 author 或 namespace owner / maintainer 身份"})
		return
	}
	// "latest" is auto-managed by the publish flow; pinning it manually
	// would be useful for rollbacks though, so we allow it but log loudly.
	var req model.SetDistTagRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	req.Version = strings.TrimSpace(req.Version)
	if err := s.store.SetDistTag(ns, name, tag, req.Version, user); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	_, _ = s.store.DB.Exec(`INSERT INTO audit_logs(actor,action,target,version,ip) VALUES(?,?,?,?,?)`,
		user, "set_dist_tag", ns+"/"+name+":"+tag, "v"+req.Version, "127.0.0.1")
	c.JSON(200, gin.H{"tag": tag, "version": req.Version})
}

func (s *Server) deleteDistTag(c *gin.Context) {
	ns, name, tag := c.Param("ns"), c.Param("name"), c.Param("tag")
	user := s.currentUser(c)
	allowed, err := s.canEditSkill(user, ns, name)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	if !allowed {
		c.JSON(403, gin.H{"error": "需要 author 或 namespace owner / maintainer 身份"})
		return
	}
	if err := s.store.DeleteDistTag(ns, name, tag); err != nil {
		if err == sql.ErrNoRows {
			c.JSON(404, gin.H{"error": "tag not found"})
			return
		}
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	_, _ = s.store.DB.Exec(`INSERT INTO audit_logs(actor,action,target,version,ip) VALUES(?,?,?,?,?)`,
		user, "delete_dist_tag", ns+"/"+name+":"+tag, "", "127.0.0.1")
	c.JSON(200, gin.H{"ok": true})
}

// ---------- subscriptions ----------------------------------------------------

func (s *Server) subscribeSkill(c *gin.Context) {
	ns, name := c.Param("ns"), c.Param("name")
	user := s.currentUser(c)
	// Reject if the skill doesn't exist; otherwise users could "follow"
	// non-existent rows and never get notifications.
	k, err := s.store.GetSkill(ns, name)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	if k == nil {
		c.JSON(404, gin.H{"error": "skill not found"})
		return
	}
	if err := s.store.Subscribe(user, ns, name); err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{"ok": true, "subscribed": true})
}

func (s *Server) unsubscribeSkill(c *gin.Context) {
	ns, name := c.Param("ns"), c.Param("name")
	user := s.currentUser(c)
	if err := s.store.Unsubscribe(user, ns, name); err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{"ok": true, "subscribed": false})
}

// getSubscriptionState reports whether the current user follows this skill,
// plus the total subscriber count (so the UI can show a "N 关注" chip).
func (s *Server) getSubscriptionState(c *gin.Context) {
	ns, name := c.Param("ns"), c.Param("name")
	user := s.currentUser(c)
	subbed, err := s.store.IsSubscribed(user, ns, name)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	count, err := s.store.CountSubscribers(ns, name)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{"subscribed": subbed, "count": count})
}

func (s *Server) listMySubscriptions(c *gin.Context) {
	user := s.currentUser(c)
	out, err := s.store.ListMySubscriptions(user)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, out)
}
