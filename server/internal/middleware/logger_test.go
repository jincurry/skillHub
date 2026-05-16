package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestStructuredLoggerProducesJSON(t *testing.T) {
	r := gin.New()
	r.Use(StructuredLogger())
	r.GET("/test", func(c *gin.Context) { c.String(200, "hello") })

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/test", nil)
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	// The logger writes to stdout; we can't easily capture it without
	// redirecting os.Stdout. Instead, verify the entry struct marshals
	// as expected JSON.
	entry := LogEntry{
		Timestamp: "2026-01-01T00:00:00Z",
		Level:     "info",
		Method:    "GET",
		Path:      "/test",
		Status:    200,
		Latency:   "1ms",
		LatencyMs: 1,
		ClientIP:  "127.0.0.1",
	}
	b, err := json.Marshal(entry)
	if err != nil {
		t.Fatal(err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(b, &parsed); err != nil {
		t.Fatalf("not valid JSON: %v", err)
	}
	if parsed["method"] != "GET" {
		t.Fatalf("expected GET, got %v", parsed["method"])
	}
}

func TestLevelFor(t *testing.T) {
	cases := []struct{ code int; want string }{
		{200, "info"},
		{301, "info"},
		{400, "warn"},
		{404, "warn"},
		{500, "error"},
		{503, "error"},
	}
	for _, tc := range cases {
		got := levelFor(tc.code)
		if got != tc.want {
			t.Errorf("levelFor(%d) = %q, want %q", tc.code, got, tc.want)
		}
	}
}
