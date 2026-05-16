// Package middleware provides HTTP middleware for the SkillHub API server.
package middleware

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// RateLimitConfig configures the token-bucket rate limiter.
type RateLimitConfig struct {
	// Requests per second allowed per key (IP by default).
	RPS float64
	// Burst is the maximum tokens available at any time.
	Burst int
	// CleanupInterval controls how often stale buckets are evicted.
	CleanupInterval time.Duration
}

// DefaultRateLimitConfig returns sensible defaults for an internal tool:
// 20 req/s sustained with burst of 40.
func DefaultRateLimitConfig() RateLimitConfig {
	return RateLimitConfig{
		RPS:             20,
		Burst:           40,
		CleanupInterval: 5 * time.Minute,
	}
}

type bucket struct {
	tokens    float64
	lastCheck time.Time
}

type limiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	cfg     RateLimitConfig
}

func newLimiter(cfg RateLimitConfig) *limiter {
	l := &limiter{buckets: make(map[string]*bucket), cfg: cfg}
	go l.cleanup()
	return l
}

func (l *limiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	b, ok := l.buckets[key]
	if !ok {
		b = &bucket{tokens: float64(l.cfg.Burst), lastCheck: now}
		l.buckets[key] = b
	}

	// Refill tokens since last check.
	elapsed := now.Sub(b.lastCheck).Seconds()
	b.tokens += elapsed * l.cfg.RPS
	if b.tokens > float64(l.cfg.Burst) {
		b.tokens = float64(l.cfg.Burst)
	}
	b.lastCheck = now

	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// cleanup evicts stale entries periodically to prevent unbounded memory growth.
func (l *limiter) cleanup() {
	for {
		time.Sleep(l.cfg.CleanupInterval)
		l.mu.Lock()
		cutoff := time.Now().Add(-l.cfg.CleanupInterval)
		for k, b := range l.buckets {
			if b.lastCheck.Before(cutoff) {
				delete(l.buckets, k)
			}
		}
		l.mu.Unlock()
	}
}

// RateLimit returns a Gin middleware that rate-limits requests by client IP.
// Returns 429 Too Many Requests when the bucket is exhausted.
func RateLimit(cfg RateLimitConfig) gin.HandlerFunc {
	lim := newLimiter(cfg)
	return func(c *gin.Context) {
		key := c.ClientIP()
		if !lim.allow(key) {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "rate limit exceeded, please slow down",
			})
			return
		}
		c.Next()
	}
}
