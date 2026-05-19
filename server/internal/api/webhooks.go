package api

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jincurry/skillhub/server/internal/model"
)

// ---- HTTP handlers --------------------------------------------------------

func (s *Server) listWebhooks(c *gin.Context) {
	user := s.currentUser(c)
	ns := c.Query("ns")

	// Admins see everything; others see only their namespace(s).
	isAdmin, _ := s.store.IsAdmin(user)
	if !isAdmin {
		if ns == "" {
			// Non-admins must scope to a namespace they manage.
			c.JSON(403, gin.H{"error": "non-admin must specify ?ns="})
			return
		}
		role, _ := s.store.UserRoleInNamespace(ns, user)
		if role != "owner" && role != "maintainer" {
			c.JSON(403, gin.H{"error": "only namespace owner/maintainer can list webhooks"})
			return
		}
	}
	hooks, err := s.store.ListWebhooks(ns)
	if err != nil {
		serverError(c, err)
		return
	}
	if hooks == nil {
		hooks = []model.Webhook{}
	}
	c.JSON(200, hooks)
}

func (s *Server) createWebhook(c *gin.Context) {
	var req model.CreateWebhookRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	user := s.currentUser(c)
	isAdmin, _ := s.store.IsAdmin(user)

	// Namespace-scoped webhook: caller must own/maintain that ns.
	if req.Namespace != "" && !isAdmin {
		role, _ := s.store.UserRoleInNamespace(req.Namespace, user)
		if role != "owner" && role != "maintainer" {
			c.JSON(403, gin.H{"error": "only namespace owner/maintainer can create webhooks for this ns"})
			return
		}
	}
	// Global (ns='') webhooks are admin-only.
	if req.Namespace == "" && !isAdmin {
		c.JSON(403, gin.H{"error": "global webhooks require admin"})
		return
	}
	if !strings.HasPrefix(req.URL, "http://") && !strings.HasPrefix(req.URL, "https://") {
		c.JSON(400, gin.H{"error": "url must start with http:// or https://"})
		return
	}
	hook, err := s.store.CreateWebhook(req, user)
	if err != nil {
		serverError(c, err)
		return
	}
	c.JSON(201, hook)
}

func (s *Server) getWebhook(c *gin.Context) {
	id, ok := s.parseWebhookID(c)
	if !ok {
		return
	}
	hook, err := s.store.GetWebhook(id)
	if err != nil || hook == nil {
		c.JSON(404, gin.H{"error": "webhook not found"})
		return
	}
	if !s.canManageWebhook(c, hook) {
		return
	}
	c.JSON(200, hook)
}

func (s *Server) updateWebhook(c *gin.Context) {
	id, ok := s.parseWebhookID(c)
	if !ok {
		return
	}
	hook, err := s.store.GetWebhook(id)
	if err != nil || hook == nil {
		c.JSON(404, gin.H{"error": "webhook not found"})
		return
	}
	if !s.canManageWebhook(c, hook) {
		return
	}
	var req model.UpdateWebhookRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	if req.URL != nil {
		if !strings.HasPrefix(*req.URL, "http://") && !strings.HasPrefix(*req.URL, "https://") {
			c.JSON(400, gin.H{"error": "url must start with http:// or https://"})
			return
		}
	}
	updated, err := s.store.UpdateWebhook(id, req)
	if err != nil {
		serverError(c, err)
		return
	}
	c.JSON(200, updated)
}

func (s *Server) deleteWebhook(c *gin.Context) {
	id, ok := s.parseWebhookID(c)
	if !ok {
		return
	}
	hook, err := s.store.GetWebhook(id)
	if err != nil || hook == nil {
		c.JSON(404, gin.H{"error": "webhook not found"})
		return
	}
	if !s.canManageWebhook(c, hook) {
		return
	}
	if err := s.store.DeleteWebhook(id); err != nil {
		serverError(c, err)
		return
	}
	c.JSON(204, nil)
}

func (s *Server) listWebhookDeliveries(c *gin.Context) {
	id, ok := s.parseWebhookID(c)
	if !ok {
		return
	}
	hook, err := s.store.GetWebhook(id)
	if err != nil || hook == nil {
		c.JSON(404, gin.H{"error": "webhook not found"})
		return
	}
	if !s.canManageWebhook(c, hook) {
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	deliveries, err := s.store.ListDeliveries(id, limit)
	if err != nil {
		serverError(c, err)
		return
	}
	if deliveries == nil {
		deliveries = []model.WebhookDelivery{}
	}
	c.JSON(200, deliveries)
}

// pingWebhook sends a test "skill.ping" event to verify the endpoint is reachable.
func (s *Server) pingWebhook(c *gin.Context) {
	id, ok := s.parseWebhookID(c)
	if !ok {
		return
	}
	hook, err := s.store.GetWebhook(id)
	if err != nil || hook == nil {
		c.JSON(404, gin.H{"error": "webhook not found"})
		return
	}
	if !s.canManageWebhook(c, hook) {
		return
	}
	payload := model.WebhookPayload{
		ID:        fmt.Sprintf("ping_%s", uuid.NewString()),
		Event:     "skill.ping",
		Timestamp: time.Now().UTC(),
		Data: model.WebhookSkillData{
			Skill: model.WebhookSkill{
				Namespace:      "ping",
				Name:           "ping",
				Version:        "0.0.0",
				Classification: "L1",
				Description:    "Webhook connectivity test",
			},
			Review: model.WebhookReview{
				DecidedBy: s.currentUser(c),
				Decision:  "ping",
				DecidedAt: time.Now().UTC(),
			},
		},
	}
	code, errMsg, dur := fireOne(hook.URL, "", payload)
	c.JSON(200, gin.H{
		"statusCode": code,
		"error":      errMsg,
		"durationMs": dur,
	})
}

// ---- PAT handlers ---------------------------------------------------------

func (s *Server) listAPITokens(c *gin.Context) {
	user := s.currentUser(c)
	tokens, err := s.store.ListAPITokens(user)
	if err != nil {
		serverError(c, err)
		return
	}
	if tokens == nil {
		tokens = []model.APIToken{}
	}
	c.JSON(200, tokens)
}

func (s *Server) createAPIToken(c *gin.Context) {
	var req model.CreateAPITokenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	raw, tok, err := s.store.CreateAPIToken(s.currentUser(c), req)
	if err != nil {
		serverError(c, err)
		return
	}
	c.JSON(201, model.CreateAPITokenResponse{Token: raw, APIToken: *tok})
}

func (s *Server) deleteAPIToken(c *gin.Context) {
	id, ok := s.parseID(c)
	if !ok {
		return
	}
	if err := s.store.DeleteAPIToken(id, s.currentUser(c)); err != nil {
		c.JSON(404, gin.H{"error": err.Error()})
		return
	}
	c.JSON(204, nil)
}

// ---- helpers --------------------------------------------------------------

func (s *Server) parseWebhookID(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(400, gin.H{"error": "invalid webhook id"})
		return 0, false
	}
	return id, true
}

func (s *Server) canManageWebhook(c *gin.Context, hook *model.Webhook) bool {
	user := s.currentUser(c)
	isAdmin, _ := s.store.IsAdmin(user)
	if isAdmin {
		return true
	}
	if hook.Namespace == "" {
		c.JSON(403, gin.H{"error": "global webhook management requires admin"})
		return false
	}
	role, _ := s.store.UserRoleInNamespace(hook.Namespace, user)
	if role == "owner" || role == "maintainer" {
		return true
	}
	c.JSON(403, gin.H{"error": "only namespace owner/maintainer can manage this webhook"})
	return false
}

// ---- Webhook firing -------------------------------------------------------

// FireWebhooks is called by decideReview after a successful approve commit.
// It runs in a goroutine so the HTTP response is never delayed.
func (s *Server) FireWebhooks(skill model.Skill, reviewID int64, decidedBy, decision, note string) {
	event := "skill.published"
	switch decision {
	case "reject":
		return // no webhook for rejection
	}

	hooks, err := s.store.MatchingWebhooks(skill.Namespace, event)
	if err != nil || len(hooks) == 0 {
		return
	}

	deliveryID := uuid.NewString()
	downloadURL := fmt.Sprintf("/api/v1/skills/%s/%s/bundle?tag=latest", skill.Namespace, skill.Name)
	payload := model.WebhookPayload{
		ID:        deliveryID,
		Event:     event,
		Timestamp: time.Now().UTC(),
		Data: model.WebhookSkillData{
			Skill: model.WebhookSkill{
				Namespace:      skill.Namespace,
				Name:           skill.Name,
				Version:        skill.Version,
				Classification: skill.Classification,
				Description:    skill.Description,
				Tags:           skill.Tags,
				DownloadURL:    downloadURL,
			},
			Review: model.WebhookReview{
				ID:        reviewID,
				DecidedBy: decidedBy,
				Decision:  decision,
				Note:      note,
				DecidedAt: time.Now().UTC(),
			},
		},
	}

	for _, h := range hooks {
		hookID, hookURL, hookSecret := h.ID, h.URL, h.Secret
		go func() {
			code, errMsg, durMs := fireOne(hookURL, hookSecret, payload)
			raw, _ := json.Marshal(payload)
			s.store.RecordDelivery(hookID, event, string(raw), code, errMsg, durMs)
		}()
	}
}

// FireLifecycleWebhook fires skill.yanked or skill.deprecated events.
func (s *Server) FireLifecycleWebhook(skill model.Skill, actor, event, reason string) {
	hooks, err := s.store.MatchingWebhooks(skill.Namespace, event)
	if err != nil || len(hooks) == 0 {
		return
	}
	payload := model.WebhookPayload{
		ID:        uuid.NewString(),
		Event:     event,
		Timestamp: time.Now().UTC(),
		Data: model.WebhookSkillData{
			Skill: model.WebhookSkill{
				Namespace:      skill.Namespace,
				Name:           skill.Name,
				Version:        skill.Version,
				Classification: skill.Classification,
				Description:    skill.Description,
				Tags:           skill.Tags,
			},
			Review: model.WebhookReview{
				DecidedBy: actor,
				Decision:  event,
				Note:      reason,
				DecidedAt: time.Now().UTC(),
			},
		},
	}
	for _, h := range hooks {
		hookID, hookURL, hookSecret := h.ID, h.URL, h.Secret
		go func() {
			code, errMsg, durMs := fireOne(hookURL, hookSecret, payload)
			raw, _ := json.Marshal(payload)
			s.store.RecordDelivery(hookID, event, string(raw), code, errMsg, durMs)
		}()
	}
}

// fireOne performs one HTTP POST and returns (statusCode, errMsg, durationMs).
func fireOne(url, secret string, payload model.WebhookPayload) (int, string, int) {
	body, err := json.Marshal(payload)
	if err != nil {
		return 0, "marshal: " + err.Error(), 0
	}

	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return 0, "build request: " + err.Error(), 0
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-SkillHub-Event", payload.Event)
	req.Header.Set("X-SkillHub-Delivery", payload.ID)
	if secret != "" {
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write(body)
		req.Header.Set("X-SkillHub-Signature-256", "sha256="+hex.EncodeToString(mac.Sum(nil)))
	}

	client := &http.Client{Timeout: 10 * time.Second}
	start := time.Now()
	resp, err := client.Do(req)
	durMs := int(time.Since(start).Milliseconds())
	if err != nil {
		return 0, err.Error(), durMs
	}
	defer resp.Body.Close()
	return resp.StatusCode, "", durMs
}
