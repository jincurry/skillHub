package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestMetricsCounterAndHistogram(t *testing.T) {
	reg := NewRegistry()
	r := gin.New()
	r.Use(reg.Instrument())
	r.GET("/skills/:ns/:name", func(c *gin.Context) { c.String(200, "ok") })
	r.GET("/metrics", reg.Handler())

	// Drive a few requests through the instrumented route.
	for _, ns := range []string{"a", "b", "c"} {
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("GET", "/skills/"+ns+"/x", nil)
		r.ServeHTTP(w, req)
		if w.Code != 200 {
			t.Fatalf("inst req %s -> %d", ns, w.Code)
		}
	}

	// Hit /metrics and assert it contains the rolled-up tuple.
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/metrics", nil)
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("/metrics -> %d", w.Code)
	}
	body := w.Body.String()

	// Route template (not raw URLs) should appear, and the counter should be 3.
	wantSubstr := `http_requests_total{method="GET",route="/skills/:ns/:name",status="200"} 3`
	if !strings.Contains(body, wantSubstr) {
		t.Errorf("missing counter line in metrics output:\n%s", body)
	}
	// Histogram lines should be present.
	if !strings.Contains(body, `http_request_duration_seconds_bucket{method="GET",route="/skills/:ns/:name",le=`) {
		t.Errorf("missing histogram buckets:\n%s", body)
	}
	if !strings.Contains(body, `http_request_duration_seconds_count{method="GET",route="/skills/:ns/:name"} 3`) {
		t.Errorf("missing histogram count:\n%s", body)
	}
	// Content type per Prometheus convention.
	if !strings.HasPrefix(w.Header().Get("Content-Type"), "text/plain") {
		t.Errorf("content-type = %q, want text/plain prefix", w.Header().Get("Content-Type"))
	}
}

func TestMetricsUnmatchedRoute(t *testing.T) {
	reg := NewRegistry()
	r := gin.New()
	r.Use(reg.Instrument())
	r.GET("/metrics", reg.Handler())

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/no-such-route", nil)
	r.ServeHTTP(w, req)
	if w.Code != 404 {
		t.Fatalf("unmatched -> %d, want 404", w.Code)
	}

	w = httptest.NewRecorder()
	req, _ = http.NewRequest("GET", "/metrics", nil)
	r.ServeHTTP(w, req)
	if !strings.Contains(w.Body.String(), `route="<unmatched>"`) {
		t.Errorf("expected <unmatched> bucket:\n%s", w.Body.String())
	}
}
