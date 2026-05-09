package api

import (
	"net/http"
	"strconv"
	"strings"

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
	}

	auth := v1.Group("")
	auth.Use(s.authMiddleware())
	{
		auth.GET("/me", s.getMe)
		auth.GET("/me/notifications", s.listNotifications)
		auth.POST("/me/notifications/read", s.markNotificationsRead)
		auth.GET("/me/drafts", s.listMyDrafts)

		auth.GET("/namespaces", s.listNamespaces)
		auth.GET("/namespaces/:ns/members", s.listNamespaceMembers)
		auth.GET("/namespaces/:ns/policy", s.getNamespacePolicy)

		auth.GET("/skills", s.listSkills)
		auth.POST("/skills", s.createSkill)
		auth.GET("/skills/:ns/:name", s.getSkill)
		auth.GET("/skills/:ns/:name/validate", s.validateSkill)
		auth.POST("/skills/:ns/:name/submit", s.submitForReview)
		auth.GET("/skills/:ns/:name/versions", s.listVersions)
		auth.GET("/skills/:ns/:name/ratings", s.listRatings)
		auth.POST("/skills/:ns/:name/ratings", s.rateSkill)
		auth.POST("/skills/:ns/:name/yank", s.yankSkill)
		auth.POST("/skills/:ns/:name/deprecate", s.deprecateSkill)

		auth.GET("/reviews", s.listReviews)
		auth.GET("/reviews/:id", s.getReview)
		auth.POST("/reviews/:id/decision", s.decideReview)
		auth.GET("/reviews/:id/comments", s.listComments)
		auth.POST("/reviews/:id/comments", s.addComment)

		auth.GET("/audit-logs", s.listAuditLogs)
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
	// Auto-pick reviewers if none provided.
	if len(req.Reviewers) == 0 {
		picked, _, err := s.store.PickReviewersByPolicy(ns, user, k.Classification)
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		req.Reviewers = picked
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
	r, err := s.store.SubmitDraftForReview(ns, name, req.Version, req.Note, user, req.Reviewers)
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

func (s *Server) listAuditLogs(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	out, err := s.store.ListAuditLogs(limit)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, out)
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
