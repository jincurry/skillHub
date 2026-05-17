package api

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestReadyzOK(t *testing.T) {
	_, r := newTestServer(t)
	w := do(t, r, "GET", "/readyz", "", nil)
	if w.Code != 200 {
		t.Fatalf("readyz: want 200, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), `"status":"ready"`) {
		t.Errorf("unexpected body: %s", w.Body.String())
	}
}

func TestReadyzFailsWhenDBClosed(t *testing.T) {
	srv, r := newTestServer(t)
	// Force the DB connection closed to simulate an unavailable backend.
	_ = srv.store.DB.Close()

	w := do(t, r, "GET", "/readyz", "", nil)
	if w.Code != 503 {
		t.Fatalf("readyz with closed DB: want 503, got %d: %s", w.Code, w.Body.String())
	}
}

func TestMetricsEndpoint(t *testing.T) {
	_, r := newTestServer(t)
	// Drive a couple of requests so /metrics has data.
	_ = do(t, r, "GET", "/healthz", "", nil)
	_ = do(t, r, "GET", "/healthz", "", nil)

	w := do(t, r, "GET", "/metrics", "", nil)
	if w.Code != 200 {
		t.Fatalf("metrics: %d", w.Code)
	}
	body := w.Body.String()
	if !strings.Contains(body, "http_requests_total") {
		t.Errorf("missing http_requests_total in metrics body:\n%s", body)
	}
	if !strings.Contains(body, "http_request_duration_seconds") {
		t.Errorf("missing histogram metrics:\n%s", body)
	}
	if !strings.Contains(body, "http_requests_in_flight") {
		t.Errorf("missing in-flight gauge:\n%s", body)
	}
}

func TestOpenAPISpecServed(t *testing.T) {
	_, r := newTestServer(t)
	w := do(t, r, "GET", "/api/v1/openapi.json", "", nil)
	if w.Code != 200 {
		t.Fatalf("openapi: %d", w.Code)
	}
	// Must be valid JSON.
	var doc map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &doc); err != nil {
		t.Fatalf("openapi body is not JSON: %v\n%s", err, w.Body.String())
	}
	if doc["openapi"] != "3.0.3" {
		t.Errorf("openapi version = %v, want 3.0.3", doc["openapi"])
	}
	// Spot-check a known path.
	paths, ok := doc["paths"].(map[string]any)
	if !ok {
		t.Fatal("paths missing from openapi doc")
	}
	if _, ok := paths["/auth/login"]; !ok {
		t.Error("expected /auth/login in openapi paths")
	}
	if _, ok := paths["/reviews/{id}/decision"]; !ok {
		t.Error("expected /reviews/{id}/decision in openapi paths")
	}
}
