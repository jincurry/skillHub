package store

import (
	"strings"
	"time"

	"github.com/jincurry/skillhub/server/internal/model"
)

// CreateWebhook inserts a new webhook registration.
func (s *Store) CreateWebhook(req model.CreateWebhookRequest, createdBy string) (*model.Webhook, error) {
	events := req.Events
	if len(events) == 0 {
		events = []string{"skill.published"}
	}
	enabled := 1
	if req.Enabled != nil && !*req.Enabled {
		enabled = 0
	}
	res, err := s.DB.Exec(
		`INSERT INTO webhooks(ns,url,secret,events,enabled,created_by) VALUES(?,?,?,?,?,?)`,
		req.Namespace, req.URL, req.Secret, strings.Join(events, ","), enabled, createdBy,
	)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return s.GetWebhook(id)
}

// GetWebhook fetches a single webhook by primary key.
func (s *Store) GetWebhook(id int64) (*model.Webhook, error) {
	row := s.DB.QueryRow(
		`SELECT id,ns,url,secret,events,enabled,created_by,created_at FROM webhooks WHERE id=?`, id,
	)
	return scanWebhook(row.Scan)
}

// ListWebhooks returns webhooks visible to the caller.
// Admins see all; namespace owners/maintainers see global + their ns hooks.
// `ns` filter: if non-empty, return only that ns + global hooks.
func (s *Store) ListWebhooks(ns string) ([]model.Webhook, error) {
	var rows interface {
		Close() error
		Next() bool
		Scan(...any) error
		Err() error
	}
	var err error
	if ns == "" {
		rows, err = s.DB.Query(
			`SELECT id,ns,url,secret,events,enabled,created_by,created_at FROM webhooks ORDER BY created_at DESC`,
		)
	} else {
		rows, err = s.DB.Query(
			`SELECT id,ns,url,secret,events,enabled,created_by,created_at FROM webhooks WHERE ns='' OR ns=? ORDER BY created_at DESC`,
			ns,
		)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.Webhook
	for rows.Next() {
		w, err := scanWebhook(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, *w)
	}
	return out, rows.Err()
}

// UpdateWebhook applies partial updates. Only the webhook owner or an admin may call this.
func (s *Store) UpdateWebhook(id int64, req model.UpdateWebhookRequest) (*model.Webhook, error) {
	sets := []string{"created_at=created_at"} // no-op anchor so JOIN always works
	args := []any{}
	if req.URL != nil {
		sets = append(sets, "url=?")
		args = append(args, *req.URL)
	}
	if req.Secret != nil {
		sets = append(sets, "secret=?")
		args = append(args, *req.Secret)
	}
	if len(req.Events) > 0 {
		sets = append(sets, "events=?")
		args = append(args, strings.Join(req.Events, ","))
	}
	if req.Enabled != nil {
		enabled := 0
		if *req.Enabled {
			enabled = 1
		}
		sets = append(sets, "enabled=?")
		args = append(args, enabled)
	}
	args = append(args, id)
	if _, err := s.DB.Exec(`UPDATE webhooks SET `+strings.Join(sets, ",")+` WHERE id=?`, args...); err != nil {
		return nil, err
	}
	return s.GetWebhook(id)
}

// DeleteWebhook removes a webhook by ID.
func (s *Store) DeleteWebhook(id int64) error {
	_, err := s.DB.Exec(`DELETE FROM webhooks WHERE id=?`, id)
	return err
}

// MatchedWebhook is one enabled webhook matching an event.
type MatchedWebhook struct {
	ID     int64
	URL    string
	Secret string
}

// MatchingWebhooks returns enabled webhooks that should fire for the given
// (ns, event) pair: global hooks (ns='') + namespace-specific hooks.
func (s *Store) MatchingWebhooks(ns, event string) ([]MatchedWebhook, error) {
	rows, err := s.DB.Query(
		`SELECT id,url,secret FROM webhooks WHERE enabled=1 AND (ns='' OR ns=?) AND (',' || events || ',') LIKE ?`,
		ns, "%,"+event+",%",
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MatchedWebhook
	for rows.Next() {
		var h MatchedWebhook
		if err := rows.Scan(&h.ID, &h.URL, &h.Secret); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

// RecordDelivery persists one webhook delivery attempt for auditing.
func (s *Store) RecordDelivery(webhookID int64, event, payload string, statusCode int, errMsg string, durationMs int) {
	_, _ = s.DB.Exec(
		`INSERT INTO webhook_deliveries(webhook_id,event,payload,status_code,error,duration_ms) VALUES(?,?,?,?,?,?)`,
		webhookID, event, payload, statusCode, errMsg, durationMs,
	)
}

// ListDeliveries returns recent delivery records for one webhook.
func (s *Store) ListDeliveries(webhookID int64, limit int) ([]model.WebhookDelivery, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.DB.Query(
		`SELECT id,webhook_id,event,status_code,error,duration_ms,delivered_at FROM webhook_deliveries WHERE webhook_id=? ORDER BY delivered_at DESC LIMIT ?`,
		webhookID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.WebhookDelivery
	for rows.Next() {
		var d model.WebhookDelivery
		if err := rows.Scan(&d.ID, &d.WebhookID, &d.Event, &d.StatusCode, &d.Error, &d.DurationMs, &d.DeliveredAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func scanWebhook(scan func(...any) error) (*model.Webhook, error) {
	var w model.Webhook
	var secret, eventsCSV string
	var enabled int
	var createdAt time.Time
	if err := scan(&w.ID, &w.Namespace, &w.URL, &secret, &eventsCSV, &enabled, &w.CreatedBy, &createdAt); err != nil {
		return nil, err
	}
	w.HasSecret = secret != ""
	w.Events = strings.Split(eventsCSV, ",")
	w.Enabled = enabled != 0
	w.CreatedAt = createdAt
	return &w, nil
}
