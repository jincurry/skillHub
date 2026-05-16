package notifier

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Feishu sends notifications to a Feishu/Lark Incoming Webhook (custom bot).
type Feishu struct {
	WebhookURL string
	client     *http.Client
}

// NewFeishu creates a Feishu sender. Returns nil if webhookURL is empty.
func NewFeishu(webhookURL string) *Feishu {
	if webhookURL == "" {
		return nil
	}
	return &Feishu{
		WebhookURL: webhookURL,
		client:     &http.Client{Timeout: 10 * time.Second},
	}
}

func (f *Feishu) Name() string { return "feishu" }

func (f *Feishu) Send(evt Event) error {
	// Feishu interactive card message (msg_type = interactive).
	title := fmt.Sprintf("[%s] %s", evt.Kind, evt.Title)
	content := evt.Body
	if content == "" {
		content = fmt.Sprintf("由 %s 触发 → %s", evt.Actor, evt.Target)
	}

	elements := []map[string]any{
		{
			"tag": "div",
			"text": map[string]string{
				"tag":     "plain_text",
				"content": content,
			},
		},
	}

	if evt.URL != "" {
		elements = append(elements, map[string]any{
			"tag": "action",
			"actions": []map[string]any{
				{
					"tag":  "button",
					"text": map[string]string{"tag": "plain_text", "content": "查看详情"},
					"url":  evt.URL,
					"type": "primary",
				},
			},
		})
	}

	payload := map[string]any{
		"msg_type": "interactive",
		"card": map[string]any{
			"header": map[string]any{
				"title": map[string]string{
					"tag":     "plain_text",
					"content": title,
				},
			},
			"elements": elements,
		},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}

	resp, err := f.client.Post(f.WebhookURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("post: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return fmt.Errorf("feishu returned %d", resp.StatusCode)
	}
	return nil
}
