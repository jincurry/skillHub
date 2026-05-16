package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func TestRateLimitAllowsBurst(t *testing.T) {
	cfg := RateLimitConfig{RPS: 10, Burst: 5, CleanupInterval: 60_000_000_000}
	r := gin.New()
	r.Use(RateLimit(cfg))
	r.GET("/ping", func(c *gin.Context) { c.String(200, "ok") })

	// First 5 should succeed (burst).
	for i := 0; i < 5; i++ {
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("GET", "/ping", nil)
		req.RemoteAddr = "1.2.3.4:1234"
		r.ServeHTTP(w, req)
		if w.Code != 200 {
			t.Fatalf("request %d: expected 200, got %d", i, w.Code)
		}
	}

	// 6th should be rate-limited.
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/ping", nil)
	req.RemoteAddr = "1.2.3.4:1234"
	r.ServeHTTP(w, req)
	if w.Code != 429 {
		t.Fatalf("expected 429 after burst, got %d", w.Code)
	}
}

func TestRateLimitDifferentIPs(t *testing.T) {
	cfg := RateLimitConfig{RPS: 1, Burst: 1, CleanupInterval: 60_000_000_000}
	r := gin.New()
	r.Use(RateLimit(cfg))
	r.GET("/ping", func(c *gin.Context) { c.String(200, "ok") })

	// Two different IPs each get their own bucket.
	for _, ip := range []string{"10.0.0.1:1", "10.0.0.2:1"} {
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("GET", "/ping", nil)
		req.RemoteAddr = ip
		r.ServeHTTP(w, req)
		if w.Code != 200 {
			t.Fatalf("ip %s: expected 200, got %d", ip, w.Code)
		}
	}
}
