package api

import (
	"archive/tar"
	"compress/gzip"
	"database/sql"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jincurry/skillhub/server/internal/auth"
	"github.com/jincurry/skillhub/server/internal/config"
	"github.com/jincurry/skillhub/server/internal/model"
	"github.com/jincurry/skillhub/server/internal/store"
	"github.com/jincurry/skillhub/server/internal/validate"
)

type Server struct {
	cfg   config.Config
	store *store.Store
}

func New(cfg config.Config, st *store.Store) *Server {
	return &Server{cfg: cfg, store: st}
}

func (s *Server) Routes() *gin.Engine {
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery(), corsMiddleware())

	r.GET("/healthz", func(c *gin.Context) { c.JSON(200, gin.H{"status": "ok"}) })

	v1 := r.Group("/api/v1")
	{
		// public
		v1.POST("/auth/login", s.login)
		// Avatars are served publicly so <img src=...> works without auth headers.
		// gin.Static safely scopes file serving to the given directory.
		v1.Static("/avatars", "./data/avatars")
	}

	auth := v1.Group("")
	auth.Use(s.authMiddleware())
	{
		auth.GET("/me", s.getMe)
		auth.PATCH("/me", s.patchMe)
		auth.GET("/me/stats", s.getMeStats)
		auth.GET("/me/achievements", s.getMeAchievements)
		auth.GET("/me/notifications", s.listNotifications)
		auth.POST("/me/notifications/read", s.markNotificationsRead)
		auth.GET("/me/drafts", s.listMyDrafts)
		auth.POST("/me/avatar", s.uploadAvatar)
		auth.DELETE("/me/avatar", s.deleteAvatar)

		auth.GET("/search", s.search)

		auth.GET("/namespaces", s.listNamespaces)
		auth.POST("/namespaces", s.createNamespace)
		auth.GET("/namespaces/:ns/members", s.listNamespaceMembers)
		auth.POST("/namespaces/:ns/members", s.addNamespaceMember)
		auth.PATCH("/namespaces/:ns/members/:username", s.updateNamespaceMemberRole)
		auth.DELETE("/namespaces/:ns/members/:username", s.removeNamespaceMember)
		auth.GET("/namespaces/:ns/policy", s.getNamespacePolicy)

		auth.GET("/skills", s.listSkills)
		auth.POST("/skills", s.createSkill)
		auth.GET("/skills/:ns/:name", s.getSkill)
		auth.GET("/skills/:ns/:name/validate", s.validateSkill)
		auth.POST("/skills/:ns/:name/submit", s.submitForReview)
		auth.GET("/skills/:ns/:name/versions", s.listVersions)
		auth.GET("/skills/:ns/:name/trend", s.getSkillTrend)
		auth.GET("/skills/:ns/:name/ratings", s.listRatings)
		auth.POST("/skills/:ns/:name/ratings", s.rateSkill)
		auth.POST("/skills/:ns/:name/yank", s.yankSkill)
		auth.POST("/skills/:ns/:name/deprecate", s.deprecateSkill)
		// Author-facing hard delete. Only works while the skill is still a
		// draft and only the original author can call it — anything else
		// (published / yanked / deprecated) routes through the admin path.
		auth.DELETE("/skills/:ns/:name", s.deleteDraftSkill)

		auth.GET("/skills/:ns/:name/files", s.listSkillFiles)
		auth.GET("/skills/:ns/:name/files/*path", s.getSkillFile)
		auth.PUT("/skills/:ns/:name/files/*path", s.putSkillFile)
		auth.DELETE("/skills/:ns/:name/files/*path", s.deleteSkillFile)
		auth.POST("/skills/:ns/:name/draft", s.createSkillDraft)
		auth.GET("/skills/:ns/:name/bundle", s.downloadSkillBundle)
		// Rename lives on a sibling route because the `files/*path` catch-all
		// above would otherwise swallow a "/files/rename" segment as the
		// wildcard value.
		auth.POST("/skills/:ns/:name/rename-file", s.renameSkillFile)

		// dist_tags: latest/stable/beta/<custom> aliases pinning a version.
		auth.GET("/skills/:ns/:name/tags", s.listDistTags)
		auth.PUT("/skills/:ns/:name/tags/:tag", s.setDistTag)
		auth.DELETE("/skills/:ns/:name/tags/:tag", s.deleteDistTag)

		// subscriptions: per-user follow stream for publish events.
		auth.POST("/skills/:ns/:name/subscribe", s.subscribeSkill)
		auth.DELETE("/skills/:ns/:name/subscribe", s.unsubscribeSkill)
		auth.GET("/skills/:ns/:name/subscription", s.getSubscriptionState)
		auth.GET("/me/subscriptions", s.listMySubscriptions)

		auth.GET("/reviews", s.listReviews)
		auth.GET("/reviews/stats", s.getReviewStats)
		auth.GET("/reviews/:id", s.getReview)
		auth.POST("/reviews/:id/decision", s.decideReview)
		auth.GET("/reviews/:id/comments", s.listComments)
		auth.POST("/reviews/:id/comments", s.addComment)
		auth.POST("/reviews/:id/reviewers", s.addReviewer)
		auth.DELETE("/reviews/:id/reviewers/:username", s.removeReviewer)
		auth.GET("/reviews/:id/files", s.listReviewFiles)

		auth.GET("/audit-logs", s.listAuditLogs)

		// AI assistance: any logged-in user can list available providers and
		// run an assist call against a skill they can edit.
		auth.GET("/ai/providers", s.listAIProviderRefs)
		auth.POST("/ai/skills/:ns/:name/assist", s.aiAssist)
	}

	// Admin-only configuration. requireAdmin checks users.is_admin = 1.
	adminAI := auth.Group("/admin")
	adminAI.Use(s.requireAdmin())
	{
		adminAI.GET("/ai-providers", s.listAIProviders)
		adminAI.POST("/ai-providers", s.createAIProvider)
		adminAI.PATCH("/ai-providers/:id", s.updateAIProvider)
		adminAI.DELETE("/ai-providers/:id", s.deleteAIProvider)
		adminAI.POST("/ai-providers/:id/test", s.testAIProvider)

		// Per-namespace approval policies. The hard-coded defaults still
		// apply when no override row exists; PUT writes one, DELETE removes
		// it ("reset to default").
		adminAI.GET("/namespaces/:ns/policies", s.listNamespacePolicies)
		adminAI.PUT("/namespaces/:ns/policies/:classification", s.upsertNamespacePolicy)
		adminAI.DELETE("/namespaces/:ns/policies/:classification", s.deleteNamespacePolicy)

		// Namespace hard delete (only when empty). Cleans up the row itself
		// plus dependent namespace_members / namespace_policies.
		adminAI.DELETE("/namespaces/:ns", s.deleteNamespace)

		// Hard delete a skill + all dependent rows (versions / files /
		// ratings / reviews / comments / snapshots / metrics / notifs).
		// Used by the admin cleanup flow before deleting a namespace.
		adminAI.DELETE("/skills/:ns/:name", s.adminDeleteSkill)

		// Platform-wide metrics for the Admin overview dashboard.
		adminAI.GET("/metrics", s.adminMetrics)
	}
	return r
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type,Authorization")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	}
}

func (s *Server) authMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		h := c.GetHeader("Authorization")
		if !strings.HasPrefix(h, "Bearer ") {
			c.AbortWithStatusJSON(401, gin.H{"error": "missing bearer token"})
			return
		}
		tok := strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
		sub, err := auth.ParseJWT(tok, s.cfg.JWTSecret)
		if err != nil {
			c.AbortWithStatusJSON(401, gin.H{"error": err.Error()})
			return
		}
		c.Set("user", sub)
		c.Next()
	}
}

func (s *Server) login(c *gin.Context) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Username == "" || req.Password == "" {
		c.JSON(400, gin.H{"error": "username and password required"})
		return
	}
	ok, err := s.store.AuthenticateUser(req.Username, req.Password)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	if !ok {
		c.JSON(401, gin.H{"error": "invalid credentials"})
		return
	}
	tok, err := auth.SignJWT(req.Username, s.cfg.JWTSecret, s.cfg.JWTTTL)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	user, _ := s.store.GetUser(req.Username)
	c.JSON(200, gin.H{"token": tok, "user": user})
}

func (s *Server) currentUser(c *gin.Context) string {
	if v, ok := c.Get("user"); ok {
		if u, ok := v.(string); ok && u != "" {
			return u
		}
	}
	return s.cfg.User
}

func (s *Server) getMe(c *gin.Context) {
	u, err := s.store.GetUser(s.currentUser(c))
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	if u == nil {
		c.JSON(404, gin.H{"error": "user not found"})
		return
	}
	c.JSON(200, u)
}

func (s *Server) listSkills(c *gin.Context) {
	out, err := s.store.ListSkills(store.SkillFilter{
		Namespace:      c.Query("ns"),
		Classification: c.Query("classification"),
		Status:         c.Query("status"),
		Q:              c.Query("q"),
	})
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, out)
}

func (s *Server) getSkill(c *gin.Context) {
	k, err := s.store.GetSkill(c.Param("ns"), c.Param("name"))
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	if k == nil {
		c.JSON(404, gin.H{"error": "not found"})
		return
	}
	c.JSON(200, k)
}

func (s *Server) createSkill(c *gin.Context) {
	var req model.CreateSkillRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	user := s.currentUser(c)
	role, err := s.store.UserRoleInNamespace(req.Namespace, user)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	if role == "" {
		c.JSON(403, gin.H{"error": "not a member of namespace " + req.Namespace})
		return
	}
	k, err := s.store.CreateSkill(req, user)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(201, k)
}

func (s *Server) submitForReview(c *gin.Context) {
	var req model.SubmitReviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	ns, name := c.Param("ns"), c.Param("name")
	k, err := s.store.GetSkill(ns, name)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	if k == nil {
		c.JSON(404, gin.H{"error": "skill not found"})
		return
	}
	rep := validate.Run(k)
	if rep.HasBlocker() {
		c.JSON(422, gin.H{"error": "validation failed", "report": rep})
		return
	}
	user := s.currentUser(c)
	// Authorization: must be a member of the namespace and must be the author
	// (or a maintainer/owner) to submit. Submitter cannot be in the reviewer set.
	role, err := s.store.UserRoleInNamespace(ns, user)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	if role == "" {
		c.JSON(403, gin.H{"error": "not a member of namespace " + ns})
		return
	}
	if k.Author != user && role != "owner" && role != "maintainer" {
		c.JSON(403, gin.H{"error": "only the author or a namespace maintainer can submit"})
		return
	}
	// Hotfix gate: only owner/maintainer of the namespace can open the
	// emergency channel, and only with a written justification (audited).
	if req.IsHotfix {
		if role != "owner" && role != "maintainer" {
			c.JSON(403, gin.H{"error": "hotfix 通道仅限命名空间 owner / maintainer 发起"})
			return
		}
		if strings.TrimSpace(req.HotfixReason) == "" {
			c.JSON(400, gin.H{"error": "hotfix 必须填写紧急原因"})
			return
		}
	}
	// Auto-pick reviewers if none provided. Hotfix uses the relaxed
	// (1-approver) policy; regular submits use the namespace-resolved one.
	if len(req.Reviewers) == 0 {
		if req.IsHotfix {
			picked, err := s.store.PickHotfixReviewers(ns, user, k.Classification)
			if err != nil {
				c.JSON(500, gin.H{"error": err.Error()})
				return
			}
			req.Reviewers = picked
		} else {
			picked, _, err := s.store.PickReviewersByPolicy(ns, user, k.Classification)
			if err != nil {
				c.JSON(500, gin.H{"error": err.Error()})
				return
			}
			req.Reviewers = picked
		}
	}
	// Enforce no-self-approval and de-duplicate.
	seen := map[string]bool{user: true}
	cleaned := make([]string, 0, len(req.Reviewers))
	for _, r := range req.Reviewers {
		if r == "" || seen[r] {
			continue
		}
		seen[r] = true
		cleaned = append(cleaned, r)
	}
	if len(cleaned) == 0 {
		c.JSON(400, gin.H{"error": "no eligible reviewers (cannot be the author)"})
		return
	}
	req.Reviewers = cleaned
	r, err := s.store.SubmitDraftForReview(ns, name, req.Version, req.Note, user, req.Reviewers, store.SubmitDraftOptions{
		IsHotfix:     req.IsHotfix,
		HotfixReason: strings.TrimSpace(req.HotfixReason),
	})
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	c.JSON(201, r)
}

func (s *Server) validateSkill(c *gin.Context) {
	k, err := s.store.GetSkill(c.Param("ns"), c.Param("name"))
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	if k == nil {
		c.JSON(404, gin.H{"error": "not found"})
		return
	}
	c.JSON(200, validate.Run(k))
}

func (s *Server) listVersions(c *gin.Context) {
	out, err := s.store.ListSkillVersions(c.Param("ns"), c.Param("name"))
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, out)
}

// getSkillTrend serves the per-day activation series the SkillDetail
// sparkline plots. Defaults to 30 days; clamps to [1, 365] inside the
// store layer. Missing days come back as zero so the client can plot a
// continuous line.
func (s *Server) getSkillTrend(c *gin.Context) {
	days := 30
	if q := c.Query("days"); q != "" {
		if n, err := strconv.Atoi(q); err == nil && n > 0 {
			days = n
		}
	}
	out, err := s.store.GetSkillTrend(c.Param("ns"), c.Param("name"), days)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, out)
}

func (s *Server) yankSkill(c *gin.Context)       { s.lifecycleAction(c, "yanked") }
func (s *Server) deprecateSkill(c *gin.Context) { s.lifecycleAction(c, "deprecated") }

func (s *Server) lifecycleAction(c *gin.Context, status string) {
	ns, name := c.Param("ns"), c.Param("name")
	user := s.currentUser(c)
	role, _ := s.store.UserRoleInNamespace(ns, user)
	if role != "owner" && role != "maintainer" {
		c.JSON(403, gin.H{"error": "需要 maintainer 或 owner 角色"})
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&req)
	if status == "yanked" && strings.TrimSpace(req.Reason) == "" {
		c.JSON(400, gin.H{"error": "yank 操作必须提供 reason"})
		return
	}
	if err := s.store.SetSkillLifecycleStatus(ns, name, status, user, req.Reason); err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{"ok": true, "status": status})
}

func (s *Server) listRatings(c *gin.Context) {
	ns, name := c.Param("ns"), c.Param("name")
	summary, err := s.store.RatingSummary(ns, name, s.currentUser(c))
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	items, err := s.store.ListRatings(ns, name)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{"summary": summary, "items": items})
}

func (s *Server) rateSkill(c *gin.Context) {
	var req model.RateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	summary, err := s.store.RateSkill(c.Param("ns"), c.Param("name"), s.currentUser(c), req.Stars, req.Comment)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(201, summary)
}

func (s *Server) listNamespaces(c *gin.Context) {
	out, err := s.store.ListNamespaces()
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, out)
}

func (s *Server) listNamespaceMembers(c *gin.Context) {
	out, err := s.store.ListNamespaceMembers(c.Param("ns"))
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, out)
}

// canManageNamespace gates writes to namespace_members. We accept the namespace's
// own owner (so teams can self-administer) and any platform admin.
func (s *Server) canManageNamespace(user, ns string) (bool, error) {
	if u, err := s.store.GetUser(user); err == nil && u != nil && u.IsAdmin {
		return true, nil
	}
	role, err := s.store.UserRoleInNamespace(ns, user)
	if err != nil {
		return false, err
	}
	return role == "owner", nil
}

func (s *Server) addNamespaceMember(c *gin.Context) {
	ns := c.Param("ns")
	allowed, err := s.canManageNamespace(s.currentUser(c), ns)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	if !allowed {
		c.JSON(403, gin.H{"error": "需要 namespace owner 或 admin 身份"})
		return
	}
	var req struct {
		Username string `json:"username" binding:"required"`
		Role     string `json:"role" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	if err := s.store.AddNamespaceMember(ns, req.Username, req.Role, s.currentUser(c)); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	out, _ := s.store.ListNamespaceMembers(ns)
	c.JSON(200, out)
}

func (s *Server) updateNamespaceMemberRole(c *gin.Context) {
	ns := c.Param("ns")
	username := c.Param("username")
	allowed, err := s.canManageNamespace(s.currentUser(c), ns)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	if !allowed {
		c.JSON(403, gin.H{"error": "需要 namespace owner 或 admin 身份"})
		return
	}
	var req struct {
		Role string `json:"role" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	if err := s.store.UpdateNamespaceMemberRole(ns, username, req.Role, s.currentUser(c)); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	out, _ := s.store.ListNamespaceMembers(ns)
	c.JSON(200, out)
}

func (s *Server) removeNamespaceMember(c *gin.Context) {
	ns := c.Param("ns")
	username := c.Param("username")
	allowed, err := s.canManageNamespace(s.currentUser(c), ns)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	if !allowed {
		c.JSON(403, gin.H{"error": "需要 namespace owner 或 admin 身份"})
		return
	}
	if err := s.store.RemoveNamespaceMember(ns, username, s.currentUser(c)); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	out, _ := s.store.ListNamespaceMembers(ns)
	c.JSON(200, out)
}

func (s *Server) getNamespacePolicy(c *gin.Context) {
	ns := c.Param("ns")
	classification := c.DefaultQuery("classification", "L2")
	user := s.currentUser(c)
	picked, pol, err := s.store.PickReviewersByPolicy(ns, user, classification)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{
		"classification": pol.Classification,
		"mode":           pol.Mode,
		"slaHours":       pol.SLAHours,
		"slots":          pol.Slots,
		"suggested":      picked,
	})
}

func (s *Server) listReviews(c *gin.Context) {
	out, err := s.store.ListReviews(c.Query("status"))
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, out)
}

func (s *Server) parseID(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(400, gin.H{"error": "invalid id"})
		return 0, false
	}
	return id, true
}

func (s *Server) getReview(c *gin.Context) {
	id, ok := s.parseID(c)
	if !ok {
		return
	}
	r, err := s.store.GetReview(id)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	if r == nil {
		c.JSON(404, gin.H{"error": "not found"})
		return
	}
	c.JSON(200, r)
}

func (s *Server) decideReview(c *gin.Context) {
	id, ok := s.parseID(c)
	if !ok {
		return
	}
	var req model.DecisionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	user := s.currentUser(c)
	r, err := s.store.GetReview(id)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	if r == nil {
		c.JSON(404, gin.H{"error": "review not found"})
		return
	}
	if r.Status != "pending" {
		c.JSON(409, gin.H{"error": "review already " + r.Status})
		return
	}
	if r.Author == user {
		c.JSON(403, gin.H{"error": "cannot self-approve"})
		return
	}
	assigned := false
	for _, rv := range r.Reviewers {
		if rv == user {
			assigned = true
			break
		}
	}
	if !assigned {
		c.JSON(403, gin.H{"error": "not assigned as a reviewer"})
		return
	}
	if err := s.store.DecideReview(id, req.Decision, req.Note, user); err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	r, _ = s.store.GetReview(id)
	c.JSON(200, r)
}

func (s *Server) listComments(c *gin.Context) {
	id, ok := s.parseID(c)
	if !ok {
		return
	}
	out, err := s.store.ListComments(id)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, out)
}

// listReviewFiles serves the file-by-file diff snapshot for a review. Any
// authenticated user can read it — same audience as listComments — because
// surfacing what was changed is the whole point of the review queue.
func (s *Server) listReviewFiles(c *gin.Context) {
	id, ok := s.parseID(c)
	if !ok {
		return
	}
	out, err := s.store.ListReviewFiles(id)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, out)
}

func (s *Server) addComment(c *gin.Context) {
	id, ok := s.parseID(c)
	if !ok {
		return
	}
	var req model.CommentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	cm, err := s.store.AddComment(id, s.currentUser(c), req.Body)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(201, cm)
}

// canManageReviewers gates POST/DELETE on /reviews/:id/reviewers. We accept:
//   - the review author (they invited the original set; adding more is fine)
//   - an already-assigned reviewer (delegation: pull in a peer when stuck)
//   - an owner or maintainer of the skill's namespace
//   - a platform admin
//
// The check is intentionally loose for adds/removes — it's an org-internal
// product and the audit log captures who did what.
func (s *Server) canManageReviewers(user string, r *model.Review) (bool, error) {
	if r == nil {
		return false, nil
	}
	if r.Author == user {
		return true, nil
	}
	for _, rv := range r.Reviewers {
		if rv == user {
			return true, nil
		}
	}
	if u, err := s.store.GetUser(user); err == nil && u != nil && u.IsAdmin {
		return true, nil
	}
	role, err := s.store.UserRoleInNamespace(r.Namespace, user)
	if err != nil {
		return false, err
	}
	return role == "owner" || role == "maintainer", nil
}

func (s *Server) addReviewer(c *gin.Context) {
	id, ok := s.parseID(c)
	if !ok {
		return
	}
	r, err := s.store.GetReview(id)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	if r == nil {
		c.JSON(404, gin.H{"error": "review not found"})
		return
	}
	allowed, err := s.canManageReviewers(s.currentUser(c), r)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	if !allowed {
		c.JSON(403, gin.H{"error": "需要作者、reviewer 或 namespace 维护者身份"})
		return
	}
	var req struct {
		Username string `json:"username" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	out, err := s.store.AddReviewer(id, req.Username, s.currentUser(c))
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, out)
}

func (s *Server) removeReviewer(c *gin.Context) {
	id, ok := s.parseID(c)
	if !ok {
		return
	}
	username := c.Param("username")
	r, err := s.store.GetReview(id)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	if r == nil {
		c.JSON(404, gin.H{"error": "review not found"})
		return
	}
	allowed, err := s.canManageReviewers(s.currentUser(c), r)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	if !allowed {
		c.JSON(403, gin.H{"error": "需要作者、reviewer 或 namespace 维护者身份"})
		return
	}
	out, err := s.store.RemoveReviewer(id, username, s.currentUser(c))
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, out)
}

func (s *Server) listAuditLogs(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	out, err := s.store.ListAuditLogs(store.AuditFilter{
		Actor:  c.Query("actor"),
		Action: c.Query("action"),
		Target: c.Query("target"),
		Q:      c.Query("q"),
		Limit:  limit,
	})
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, out)
}

// patchMe updates the current user's profile fields.
func (s *Server) patchMe(c *gin.Context) {
	var req model.UpdateMeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	user, err := s.store.UpdateMe(s.currentUser(c), req)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, user)
}

// allowedAvatarExts is the whitelist of file extensions accepted by the avatar
// upload handler. Anything else is rejected to keep the static directory free
// of weird MIME types.
var allowedAvatarExts = map[string]bool{
	".jpg":  true,
	".jpeg": true,
	".png":  true,
	".webp": true,
	".gif":  true,
}

const maxAvatarBytes = 2 * 1024 * 1024 // 2 MiB

// uploadAvatar accepts a multipart upload (field name "avatar") and saves it
// to ./data/avatars/<username><ext>. Old files for that user are removed first
// so the directory keeps at most one file per user. The returned URL embeds a
// cache-buster query so browsers always pick up the new image.
func (s *Server) uploadAvatar(c *gin.Context) {
	file, err := c.FormFile("avatar")
	if err != nil {
		c.JSON(400, gin.H{"error": "missing 'avatar' file"})
		return
	}
	if file.Size > maxAvatarBytes {
		c.JSON(413, gin.H{"error": "file too large (max 2MB)"})
		return
	}
	ext := strings.ToLower(filepath.Ext(file.Filename))
	if !allowedAvatarExts[ext] {
		c.JSON(400, gin.H{"error": "unsupported file type, allowed: jpg, jpeg, png, webp, gif"})
		return
	}

	user := s.currentUser(c)
	dir := "./data/avatars"
	if err := os.MkdirAll(dir, 0o755); err != nil {
		c.JSON(500, gin.H{"error": "mkdir: " + err.Error()})
		return
	}

	// Remove any previous avatar(s) for this user (different ext, etc.).
	if old, _ := filepath.Glob(filepath.Join(dir, user+".*")); len(old) > 0 {
		for _, p := range old {
			_ = os.Remove(p)
		}
	}

	dst := filepath.Join(dir, user+ext)
	if err := c.SaveUploadedFile(file, dst); err != nil {
		c.JSON(500, gin.H{"error": "save: " + err.Error()})
		return
	}

	url := "/api/v1/avatars/" + user + ext + "?v=" + strconv.FormatInt(time.Now().Unix(), 10)
	me, err := s.store.SetAvatarURL(user, url)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, me)
}

// deleteAvatar removes the on-disk file(s) for the current user and clears the
// avatar_url column so the UI falls back to the gradient initial.
func (s *Server) deleteAvatar(c *gin.Context) {
	user := s.currentUser(c)
	if old, _ := filepath.Glob(filepath.Join("./data/avatars", user+".*")); len(old) > 0 {
		for _, p := range old {
			_ = os.Remove(p)
		}
	}
	me, err := s.store.SetAvatarURL(user, "")
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, me)
}

// getMeStats returns aggregate counts for the current user's dashboard.
func (s *Server) getMeStats(c *gin.Context) {
	stats, err := s.store.MeStats(s.currentUser(c))
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, stats)
}

// getMeAchievements returns the badge list for the current user.
func (s *Server) getMeAchievements(c *gin.Context) {
	out, err := s.store.Achievements(s.currentUser(c))
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, out)
}

// search powers the global ⌘K command palette. Returns 3 buckets in one round
// trip; empty q returns empty buckets.
func (s *Server) search(c *gin.Context) {
	out, err := s.store.Search(c.Query("q"))
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, out)
}

// getReviewStats returns the org-wide review queue summary.
func (s *Server) getReviewStats(c *gin.Context) {
	stats, err := s.store.ReviewStats()
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, stats)
}

// canEditSkill reports whether the user can write or delete a skill's files.
// Author of the skill always wins; otherwise the user must be an owner or
// maintainer of the owning namespace. This mirrors the rule applied by
// submitForReview — if you can't submit a bundle, you shouldn't be able to
// rewrite it either.
func (s *Server) canEditSkill(user, ns, name string) (bool, error) {
	k, err := s.store.GetSkill(ns, name)
	if err != nil {
		return false, err
	}
	if k == nil {
		return false, nil
	}
	if k.Author == user {
		return true, nil
	}
	role, err := s.store.UserRoleInNamespace(ns, user)
	if err != nil {
		return false, err
	}
	return role == "owner" || role == "maintainer", nil
}

// extractFilePath normalises gin's wildcard path (which arrives with a leading
// slash) and runs it through the path-safety validator.
func extractFilePath(c *gin.Context) (string, bool) {
	raw := strings.TrimPrefix(c.Param("path"), "/")
	cleaned, err := store.ValidateFilePath(raw)
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return "", false
	}
	return cleaned, true
}

func (s *Server) listSkillFiles(c *gin.Context) {
	ns, name := c.Param("ns"), c.Param("name")
	if k, _ := s.store.GetSkill(ns, name); k == nil {
		c.JSON(404, gin.H{"error": "skill not found"})
		return
	}
	out, err := s.store.ListSkillFiles(ns, name)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, out)
}

func (s *Server) getSkillFile(c *gin.Context) {
	ns, name := c.Param("ns"), c.Param("name")
	p, ok := extractFilePath(c)
	if !ok {
		return
	}
	f, err := s.store.GetSkillFile(ns, name, p)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	if f == nil {
		c.JSON(404, gin.H{"error": "file not found"})
		return
	}
	c.JSON(200, f)
}

func (s *Server) putSkillFile(c *gin.Context) {
	ns, name := c.Param("ns"), c.Param("name")
	p, ok := extractFilePath(c)
	if !ok {
		return
	}
	user := s.currentUser(c)
	allowed, err := s.canEditSkill(user, ns, name)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	if !allowed {
		c.JSON(403, gin.H{"error": "需要 author 或 namespace 成员身份"})
		return
	}
	var req model.PutFileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	f, err := s.store.PutSkillFile(ns, name, p, req.Content, user)
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	_, _ = s.store.DB.Exec(`INSERT INTO audit_logs(actor,action,target,version,ip) VALUES(?,?,?,?,?)`,
		user, "edit_file", ns+"/"+name+":"+p, "", "127.0.0.1")
	c.JSON(200, f)
}

func (s *Server) deleteSkillFile(c *gin.Context) {
	ns, name := c.Param("ns"), c.Param("name")
	p, ok := extractFilePath(c)
	if !ok {
		return
	}
	user := s.currentUser(c)
	allowed, err := s.canEditSkill(user, ns, name)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	if !allowed {
		c.JSON(403, gin.H{"error": "需要 author 或 namespace 成员身份"})
		return
	}
	// skill.yaml / README.md are bundle anchors; refuse to delete them so the
	// editor never ends up empty.
	if p == "skill.yaml" || p == "SKILL.md" || p == "README.md" {
		c.JSON(400, gin.H{"error": "this file is required and cannot be deleted"})
		return
	}
	deleted, err := s.store.DeleteSkillFile(ns, name, p)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	if !deleted {
		c.JSON(404, gin.H{"error": "file not found"})
		return
	}
	_, _ = s.store.DB.Exec(`INSERT INTO audit_logs(actor,action,target,version,ip) VALUES(?,?,?,?,?)`,
		user, "delete_file", ns+"/"+name+":"+p, "", "127.0.0.1")
	c.JSON(204, nil)
}

// renameSkillFile moves a file within a skill bundle. Required files are
// pinned (matching deleteSkillFile) so the editor never ends up missing
// SKILL.md / README.md / skill.yaml. The destination path must clear the same
// ValidateFilePath rules as a fresh upload.
func (s *Server) renameSkillFile(c *gin.Context) {
	ns, name := c.Param("ns"), c.Param("name")
	user := s.currentUser(c)
	allowed, err := s.canEditSkill(user, ns, name)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	if !allowed {
		c.JSON(403, gin.H{"error": "需要 author 或 namespace 成员身份"})
		return
	}
	var req model.RenameFileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	from, err := store.ValidateFilePath(req.From)
	if err != nil {
		c.JSON(400, gin.H{"error": "from: " + err.Error()})
		return
	}
	to, err := store.ValidateFilePath(req.To)
	if err != nil {
		c.JSON(400, gin.H{"error": "to: " + err.Error()})
		return
	}
	if from == "skill.yaml" || from == "SKILL.md" || from == "README.md" {
		c.JSON(400, gin.H{"error": "this file is required and cannot be renamed"})
		return
	}
	f, err := s.store.RenameSkillFile(ns, name, from, to, user)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(404, gin.H{"error": "source file not found"})
			return
		}
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	_, _ = s.store.DB.Exec(`INSERT INTO audit_logs(actor,action,target,version,ip) VALUES(?,?,?,?,?)`,
		user, "rename_file", ns+"/"+name+":"+from+"→"+to, "", "127.0.0.1")
	c.JSON(200, f)
}

// createNamespace lets any authenticated user spin up a namespace they will
// own. Owner falls back to the calling user when omitted.
func (s *Server) createNamespace(c *gin.Context) {
	var req model.CreateNamespaceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	owner := strings.TrimSpace(req.Owner)
	if owner == "" {
		owner = s.currentUser(c)
	}
	ns, err := s.store.CreateNamespace(req.ID, owner)
	if err != nil {
		// Surface the most useful errors to the client.
		msg := err.Error()
		switch {
		case strings.Contains(msg, "UNIQUE"):
			c.JSON(409, gin.H{"error": "namespace already exists"})
		case strings.Contains(msg, "owner user does not exist"):
			c.JSON(400, gin.H{"error": msg})
		default:
			c.JSON(500, gin.H{"error": msg})
		}
		return
	}
	c.JSON(201, ns)
}

// adminMetrics drives the platform overview dashboard. Admin-only; the
// store layer does all the heavy lifting so this is just a pass-through.
func (s *Server) adminMetrics(c *gin.Context) {
	out, err := s.store.GetPlatformMetrics()
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, out)
}

// deleteDraftSkill is the author-facing variant of HardDeleteSkill. It
// refuses anything that has progressed past `draft` (use yank/deprecate
// once a version is out in the world) and rejects callers who didn't
// create the skill — even ns owners route through the admin endpoint so
// the audit trail stays clear.
func (s *Server) deleteDraftSkill(c *gin.Context) {
	ns, name := c.Param("ns"), c.Param("name")
	k, err := s.store.GetSkill(ns, name)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	if k == nil {
		c.JSON(404, gin.H{"error": "skill not found"})
		return
	}
	if k.Status != "draft" {
		c.JSON(409, gin.H{"error": "只能删除草稿状态的 skill;已发布请使用 yank/deprecate,或联系管理员"})
		return
	}
	actor := s.currentUser(c)
	if actor != k.Author {
		c.JSON(403, gin.H{"error": "只有作者可以删除自己的草稿"})
		return
	}
	if err := s.store.HardDeleteSkill(ns, name); err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	_, _ = s.store.DB.Exec(
		`INSERT INTO audit_logs(actor,action,target,version,ip) VALUES(?,?,?,?,?)`,
		actor, "delete_draft", ns+"/"+name, "", c.ClientIP())
	c.JSON(200, gin.H{"ok": true})
}

// adminDeleteSkill is the admin escape hatch for wiping a skill entirely,
// including its history. Regular users should be using yank/deprecate
// instead — this is only meant to support the "empty a namespace before
// deleting it" admin flow.
func (s *Server) adminDeleteSkill(c *gin.Context) {
	ns, name := c.Param("ns"), c.Param("name")
	if err := s.store.HardDeleteSkill(ns, name); err != nil {
		msg := err.Error()
		if strings.Contains(msg, "不存在") {
			c.JSON(404, gin.H{"error": msg})
			return
		}
		c.JSON(500, gin.H{"error": msg})
		return
	}
	_, _ = s.store.DB.Exec(
		`INSERT INTO audit_logs(actor,action,target,version,ip) VALUES(?,?,?,?,?)`,
		s.currentUser(c), "delete_skill", ns+"/"+name, "", c.ClientIP())
	c.JSON(200, gin.H{"ok": true})
}

// deleteNamespace is admin-only and will refuse when the namespace still has
// skills attached. The store layer enforces the same invariant — this
// handler just maps store errors onto sensible HTTP codes so the UI can
// display the message directly.
func (s *Server) deleteNamespace(c *gin.Context) {
	ns := c.Param("ns")
	if err := s.store.DeleteNamespace(ns); err != nil {
		msg := err.Error()
		switch {
		case strings.Contains(msg, "不存在"):
			c.JSON(404, gin.H{"error": msg})
		case strings.Contains(msg, "仍有"):
			// Namespace not empty — use 409 Conflict so the client can
			// distinguish this from a server-side failure.
			c.JSON(409, gin.H{"error": msg})
		default:
			c.JSON(500, gin.H{"error": msg})
		}
		return
	}
	_, _ = s.store.DB.Exec(
		`INSERT INTO audit_logs(actor,action,target,version,ip) VALUES(?,?,?,?,?)`,
		s.currentUser(c), "delete_namespace", ns, "", c.ClientIP())
	c.JSON(200, gin.H{"ok": true})
}

func (s *Server) listNotifications(c *gin.Context) {
	out, err := s.store.ListNotifications(s.currentUser(c))
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, out)
}

func (s *Server) markNotificationsRead(c *gin.Context) {
	var req struct {
		IDs []int64 `json:"ids"`
		All bool    `json:"all"`
	}
	_ = c.ShouldBindJSON(&req)
	if err := s.store.MarkNotificationsRead(s.currentUser(c), req.IDs, req.All); err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{"ok": true})
}

func (s *Server) listMyDrafts(c *gin.Context) {
	out, err := s.store.ListMyDrafts(s.currentUser(c))
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, out)
}

// createSkillDraft transitions a published/yanked/deprecated skill into an
// editable draft on a fresh version. Body: { "version"?: "1.3.0" }; if empty
// the server bumps the patch component.
func (s *Server) createSkillDraft(c *gin.Context) {
	ns, name := c.Param("ns"), c.Param("name")
	user := s.currentUser(c)
	allowed, err := s.canEditSkill(user, ns, name)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	if !allowed {
		c.JSON(403, gin.H{"error": "需要作者或 namespace owner/maintainer 身份"})
		return
	}
	var req struct {
		Version string `json:"version"`
	}
	_ = c.ShouldBindJSON(&req)
	k, err := s.store.CreateDraftVersion(ns, name, req.Version, user)
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, k)
}

// downloadSkillBundle streams the current skill's file bundle as a .tar.gz
// archive named "<ns>-<name>-v<version>.tar.gz". Files are written under a
// top-level directory so unpacking is tidy.
func (s *Server) downloadSkillBundle(c *gin.Context) {
	ns, name := c.Param("ns"), c.Param("name")
	k, err := s.store.GetSkill(ns, name)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	if k == nil {
		c.JSON(404, gin.H{"error": "skill not found"})
		return
	}
	// ?tag=latest|stable|beta|<custom> resolves through skill_dist_tags;
	// ?version=x.y.z hits a specific version directly. Without either,
	// we serve whatever version is on the skill row (current behaviour).
	version := k.Version
	tagParam := strings.TrimSpace(c.Query("tag"))
	versionParam := strings.TrimSpace(c.Query("version"))
	switch {
	case tagParam != "":
		v, err := s.store.ResolveDistTag(ns, name, tagParam)
		if err != nil {
			c.JSON(404, gin.H{"error": "tag '" + tagParam + "' not found for " + ns + "/" + name})
			return
		}
		version = v
	case versionParam != "":
		version = versionParam
	}

	files, err := s.store.ListSkillFilesAtVersion(ns, name, version)
	if err != nil {
		c.JSON(404, gin.H{"error": "no bundle snapshot for v" + version + " (" + err.Error() + ")"})
		return
	}

	root := ns + "-" + name + "-v" + version
	filename := root + ".tar.gz"
	c.Header("Content-Type", "application/gzip")
	c.Header("Content-Disposition", `attachment; filename="`+filename+`"`)

	gz := gzip.NewWriter(c.Writer)
	defer gz.Close()
	tw := tar.NewWriter(gz)
	defer tw.Close()

	now := time.Now()
	for _, f := range files {
		hdr := &tar.Header{
			Name:    root + "/" + f.Path,
			Mode:    0o644,
			Size:    int64(len(f.Content)),
			ModTime: now,
		}
		if !f.UpdatedAt.IsZero() {
			hdr.ModTime = f.UpdatedAt
		}
		if err := tw.WriteHeader(hdr); err != nil {
			return
		}
		if _, err := tw.Write([]byte(f.Content)); err != nil {
			return
		}
	}
	// Best-effort audit; failure here doesn't affect the streamed bytes.
	target := ns + "/" + name
	if tagParam != "" {
		target += "@" + tagParam
	}
	_, _ = s.store.DB.Exec(`INSERT INTO audit_logs(actor,action,target,version,ip) VALUES(?,?,?,?,?)`,
		s.currentUser(c), "download_bundle", target, "v"+version, "127.0.0.1")
}
