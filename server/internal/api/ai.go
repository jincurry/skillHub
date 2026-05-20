package api

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jincurry/skillhub/server/internal/audit"
	"github.com/jincurry/skillhub/server/internal/model"
)

// requireAdmin gates downstream handlers on users.is_admin. It is mounted as
// a route-group middleware (see api.go) so admin endpoints don't need to
// repeat the check inside each handler.
func (s *Server) requireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		ok, err := s.store.IsAdmin(s.currentUser(c))
		if err != nil {
			log.Printf("internal error: method=%s path=%s err=%v",
				c.Request.Method, c.Request.URL.Path, err)
			c.AbortWithStatusJSON(500, gin.H{"error": "internal server error"})
			return
		}
		if !ok {
			c.AbortWithStatusJSON(403, gin.H{"error": "admin only"})
			return
		}
		c.Next()
	}
}

// ---------- admin: AI provider CRUD --------------------------------------

func (s *Server) listAIProviders(c *gin.Context) {
	out, err := s.store.ListAIProviders()
	if err != nil {
		serverError(c, err)
		return
	}
	c.JSON(200, out)
}

func (s *Server) createAIProvider(c *gin.Context) {
	var req model.CreateAIProviderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	p, err := s.store.CreateAIProvider(req, s.cfg.JWTSecret)
	if err != nil {
		serverError(c, err)
		return
	}
	c.JSON(200, p)
}

func (s *Server) updateAIProvider(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(400, gin.H{"error": "invalid id"})
		return
	}
	var req model.UpdateAIProviderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	p, err := s.store.UpdateAIProvider(id, req, s.cfg.JWTSecret)
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, p)
}

func (s *Server) deleteAIProvider(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(400, gin.H{"error": "invalid id"})
		return
	}
	if err := s.store.DeleteAIProvider(id); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{"ok": true})
}

// testAIProvider issues a one-token, non-streaming chat completion request to
// verify the configured base_url + key + model triple. Returns 200 on success
// or the upstream error wrapped as 502.
func (s *Server) testAIProvider(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(400, gin.H{"error": "invalid id"})
		return
	}
	prov, key, err := s.store.GetAIProviderForUse(id, s.cfg.JWTSecret)
	if err != nil {
		serverError(c, err)
		return
	}
	if prov == nil {
		c.JSON(404, gin.H{"error": "provider not found or disabled"})
		return
	}
	body, _ := json.Marshal(map[string]any{
		"model":      prov.Model,
		"max_tokens": 4,
		"messages": []map[string]string{
			{"role": "user", "content": "ping"},
		},
	})
	url := strings.TrimRight(prov.BaseURL, "/") + "/chat/completions"
	req, _ := http.NewRequestWithContext(c.Request.Context(), "POST", url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)

	cli := &http.Client{Timeout: 20 * time.Second}
	resp, err := cli.Do(req)
	if err != nil {
		c.JSON(502, gin.H{"error": "upstream: " + err.Error()})
		return
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		c.JSON(502, gin.H{
			"error":  fmt.Sprintf("upstream returned %d", resp.StatusCode),
			"detail": string(truncate(raw, 400)),
		})
		return
	}
	c.JSON(200, gin.H{"ok": true, "status": resp.StatusCode})
}

// ---------- non-admin: pick a model + run an assist call ------------------

// listAIProviderRefs is what the editor calls to populate its "model" dropdown.
// Available to any authenticated user.
func (s *Server) listAIProviderRefs(c *gin.Context) {
	out, err := s.store.ListAIProviderRefs()
	if err != nil {
		serverError(c, err)
		return
	}
	c.JSON(200, out)
}

// aiAssist streams an OpenAI-compatible chat completion back to the editor as
// SSE. The caller must have edit rights on the target skill — same rule the
// file PUT endpoint applies.
func (s *Server) aiAssist(c *gin.Context) {
	ns, name := c.Param("ns"), c.Param("name")
	user := s.currentUser(c)

	allowed, err := s.canEditSkill(user, ns, name)
	if err != nil {
		serverError(c, err)
		return
	}
	if !allowed {
		c.JSON(403, gin.H{"error": "you cannot edit this skill"})
		return
	}

	var req model.AIAssistRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	prov, key, err := s.store.GetAIProviderForUse(req.ProviderID, s.cfg.JWTSecret)
	if err != nil {
		serverError(c, err)
		return
	}
	if prov == nil {
		c.JSON(404, gin.H{"error": "provider not found or disabled"})
		return
	}

	skill, err := s.store.GetSkill(ns, name)
	if err != nil {
		serverError(c, err)
		return
	}

	msgs := buildAssistMessages(skill, &req)

	// Switch the response into SSE mode. X-Accel-Buffering: no defeats the
	// nginx default buffer so chunks reach the browser immediately.
	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no")
	c.Writer.WriteHeader(200)

	streamErr := streamOpenAICompat(c, prov.BaseURL, key, prov.Model, msgs)

	// Audit log fires regardless of success, so we keep an evidence trail
	// (e.g. cost spikes can be traced back to a user/skill).
	target := ns + "/" + name
	if streamErr != nil {
		audit.Log(s.store.DB, user, "ai_assist_error", target, "", c.ClientIP())
		return
	}
	audit.Log(s.store.DB, user, "ai_assist", target, "", c.ClientIP())
}

// ---------- prompt + streaming helpers -----------------------------------

// actionTemplate maps the editor's preset action to a one-liner instruction
// the LLM sees. `freeform` collapses to just the user's instruction.
func actionTemplate(action string) string {
	switch action {
	case "outline":
		return "为这个 skill 生成一份完整的 SKILL.md 大纲，覆盖：用途与适用场景、入参 / 出参、调用示例、注意事项、可观测性建议。覆写当前内容。"
	case "expand":
		return "在保持现有结构的前提下，把内容扩充得更详细，补充具体示例和边界情况说明。"
	case "polish":
		return "改进文档的表达，让它更清晰、专业，但不要增删核心信息。"
	case "examples":
		return "在合适的位置补充使用示例代码块（含输入和预期输出），其余内容保持不变。"
	case "summary":
		return "在文档顶部加一段 3 行以内的 TL;DR 摘要。"
	case "translate":
		return "将文档翻译为英文，保留所有代码块、链接和标题层级。"
	case "review":
		return "不要修改文档。请阅读后给出改进清单（可读性、完整性、可运行性、安全性等维度），用 markdown 列表形式输出。"
	case "fix-validation":
		return "下方附带了 SkillHub 自动验证工具发现的错误或警告。请修复文档中对应的问题，直接输出修正后的完整文档。不要解释你做了什么改动。"
	case "commit-summary":
		return "根据文档当前内容，生成一段简洁（3-5 行）的版本发布说明，概括本次改动要点。格式为 markdown 列表，语言与文档一致。只输出发布说明本身，不需要文档全文。"
	default:
		return ""
	}
}

type chatMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func buildAssistMessages(skill *model.Skill, req *model.AIAssistRequest) []chatMsg {
	var skillCtx string
	if skill != nil {
		skillCtx = fmt.Sprintf("Skill 命名: %s/%s\n描述: %s\n密级: %s\n",
			skill.Namespace, skill.Name, skill.Description, skill.Classification)
	}
	system := "你是 SkillHub 平台的内部技术文档助手。你的目标读者是工程师和 AI Agent。\n" +
		"要求：\n" +
		"- 直接输出 markdown 正文本身，不要把回复整体包裹在三反引号 markdown 代码块里\n" +
		"- 中文文档保持中文，英文文档保持英文（除非用户要求翻译）\n" +
		"- 保留代码块、链接、标题层级\n" +
		"- 不要添加除 markdown 正文外的解说性前缀（如 \"好的，这是改写后的文档\"）"
	if skillCtx != "" {
		system += "\n\n" + skillCtx
	}

	tmpl := actionTemplate(req.Action)
	userParts := []string{}

	filePath := req.FilePath
	if filePath == "" {
		filePath = "SKILL.md"
	}

	if req.CurrentContent != "" {
		userParts = append(userParts,
			fmt.Sprintf("当前 %s 全文：\n```markdown\n%s\n```", filePath, req.CurrentContent))
	} else {
		userParts = append(userParts, fmt.Sprintf("当前 %s 为空，请从零开始写。", filePath))
	}
	if req.Selection != "" {
		userParts = append(userParts,
			fmt.Sprintf("用户特别想改这一段：\n```\n%s\n```", req.Selection))
	}
	// Cross-file context: let the LLM see the rest of the skill bundle.
	if len(req.AdditionalFiles) > 0 {
		var parts []string
		for p, c := range req.AdditionalFiles {
			parts = append(parts, fmt.Sprintf("--- %s ---\n%s", p, c))
		}
		userParts = append(userParts,
			"以下是同 skill 包中其他文件的内容，供参考：\n"+strings.Join(parts, "\n\n"))
	}
	// Validation errors for the fix-validation action.
	if len(req.ValidationErrors) > 0 {
		userParts = append(userParts,
			"验证工具发现的问题：\n- "+strings.Join(req.ValidationErrors, "\n- "))
	}
	if tmpl != "" {
		userParts = append(userParts, "任务："+tmpl)
	}
	if instr := strings.TrimSpace(req.Instruction); instr != "" {
		userParts = append(userParts, "用户附加指令："+instr)
	}
	userParts = append(userParts, "请直接输出新的文档内容（或 review 清单）。")

	// Assemble: system → prior turns (if any) → fresh user message containing
	// the current document state + new instruction. The LLM gets both the
	// conversation memory and the latest file body.
	out := make([]chatMsg, 0, 2+len(req.History))
	out = append(out, chatMsg{Role: "system", Content: system})
	for _, t := range req.History {
		// Defensive: discard turns the binding tag missed (empty content).
		if t.Content == "" || (t.Role != "user" && t.Role != "assistant") {
			continue
		}
		out = append(out, chatMsg{Role: t.Role, Content: t.Content})
	}
	out = append(out, chatMsg{Role: "user", Content: strings.Join(userParts, "\n\n")})
	return out
}

// streamOpenAICompat speaks the OpenAI streaming chat completions protocol
// against `baseURL`. It re-emits each non-empty content delta as a clean SSE
// event so the editor doesn't have to parse OpenAI's wire format.
func streamOpenAICompat(c *gin.Context, baseURL, apiKey, modelID string, msgs []chatMsg) error {
	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		return fmt.Errorf("streaming unsupported by writer")
	}

	body, _ := json.Marshal(map[string]any{
		"model":       modelID,
		"messages":    msgs,
		"stream":      true,
		"temperature": 0.6,
	})
	url := strings.TrimRight(baseURL, "/") + "/chat/completions"
	req, err := http.NewRequestWithContext(c.Request.Context(), "POST", url, bytes.NewReader(body))
	if err != nil {
		writeSSEError(c, flusher, "build request: "+err.Error())
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Accept", "text/event-stream")

	cli := &http.Client{Timeout: 5 * time.Minute}
	resp, err := cli.Do(req)
	if err != nil {
		writeSSEError(c, flusher, "upstream: "+err.Error())
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		raw, _ := io.ReadAll(resp.Body)
		writeSSEError(c, flusher,
			fmt.Sprintf("upstream %d: %s", resp.StatusCode, string(truncate(raw, 400))))
		return fmt.Errorf("upstream %d", resp.StatusCode)
	}

	sc := bufio.NewScanner(resp.Body)
	// 1MiB lines should be more than enough — OpenAI deltas are tiny.
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for sc.Scan() {
		line := sc.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "" {
			continue
		}
		if payload == "[DONE]" {
			break
		}
		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
				FinishReason *string `json:"finish_reason"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(payload), &chunk); err != nil {
			// Some upstreams sprinkle keepalives or comments; just ignore.
			continue
		}
		if len(chunk.Choices) == 0 {
			continue
		}
		delta := chunk.Choices[0].Delta.Content
		if delta == "" {
			continue
		}
		out, _ := json.Marshal(map[string]string{"delta": delta})
		fmt.Fprintf(c.Writer, "data: %s\n\n", out)
		flusher.Flush()
	}
	if err := sc.Err(); err != nil {
		writeSSEError(c, flusher, "stream read: "+err.Error())
		return err
	}
	fmt.Fprint(c.Writer, "data: {\"done\":true}\n\n")
	flusher.Flush()
	return nil
}

func writeSSEError(c *gin.Context, flusher http.Flusher, msg string) {
	out, _ := json.Marshal(map[string]string{"error": msg})
	fmt.Fprintf(c.Writer, "event: error\ndata: %s\n\n", out)
	if flusher != nil {
		flusher.Flush()
	}
}

func truncate(b []byte, n int) []byte {
	if len(b) <= n {
		return b
	}
	return b[:n]
}
