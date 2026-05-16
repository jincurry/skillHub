package notifier

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Slack sends notifications to a Slack Incoming Webhook.
type Slack struct {
	WebhookURL string
	client     *http.Client
}

// NewSlack creates a Slack sender. Returns nil if webhookURL is empty.
func NewSlack(webhookURL string) *Slack {
	if webhookURL == "" {
		return nil
	}
	return &Slack{
		WebhookURL: webhookURL,
		client:     &http.Client{Timeout: 10 * time.Second},
	}
}

func (s *Slack) Name() string { return "slack" }

func (s *Slack) Send(evt Event) error {
	// Slack Block Kit: section with markdown text.
	text := fmt.Sprintf("*[%s]* %s\n%s\n_%s_ → `%s`",
		evt.Kind, evt.Title, evt.Body, evt.Actor, evt.Target)
	if evt.URL != "" {
		text += fmt.Sprintf("\n<%s|查看详情>", evt.URL)
	}

	payload := map[string]any{
		"text": text,
		"blocks": []map[string]any{
			{
				"type": "section",
				"text": map[string]string{
					"type": "mrkdwn",
					"text": text,
				},
			},
		},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}

	resp, err := s.client.Post(s.WebhookURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("post: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return fmt.Errorf("slack returned %d", resp.StatusCode)
	}
	return nil
}
