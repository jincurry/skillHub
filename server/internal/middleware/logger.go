package middleware

import (
	"encoding/json"
	"io"
	"log"
	"os"
	"time"

	"github.com/gin-gonic/gin"
)

// LogEntry is one structured JSON log line emitted per request.
type LogEntry struct {
	Timestamp  string `json:"ts"`
	Level      string `json:"level"`
	Method     string `json:"method"`
	Path       string `json:"path"`
	Status     int    `json:"status"`
	Latency    string `json:"latency"`
	LatencyMs  int64  `json:"latency_ms"`
	ClientIP   string `json:"client_ip"`
	User       string `json:"user,omitempty"`
	UserAgent  string `json:"user_agent,omitempty"`
	Error      string `json:"error,omitempty"`
}

// StructuredLogger replaces Gin's default text logger with JSON output,
// suitable for ingestion by log aggregators (ELK, Loki, Datadog, etc.).
// Writes to stdout. For a custom sink (e.g. tests want io.Discard, or
// production wants a file) use StructuredLoggerTo.
func StructuredLogger() gin.HandlerFunc {
	return StructuredLoggerTo(os.Stdout)
}

// StructuredLoggerTo is like StructuredLogger but writes to w. A nil w
// silently discards. Useful in tests so the log spam doesn't drown out
// `go test -v` output.
func StructuredLoggerTo(w io.Writer) gin.HandlerFunc {
	if w == nil {
		w = io.Discard
	}
	logger := log.New(w, "", 0)
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		latency := time.Since(start)

		entry := LogEntry{
			Timestamp: start.UTC().Format(time.RFC3339),
			Level:     levelFor(c.Writer.Status()),
			Method:    c.Request.Method,
			Path:      c.Request.URL.Path,
			Status:    c.Writer.Status(),
			Latency:   latency.String(),
			LatencyMs: latency.Milliseconds(),
			ClientIP:  c.ClientIP(),
			UserAgent: c.Request.UserAgent(),
		}

		// Attempt to read the authenticated user from context (set by authMiddleware).
		if u, exists := c.Get("user"); exists {
			if s, ok := u.(string); ok {
				entry.User = s
			}
		}

		if len(c.Errors) > 0 {
			entry.Error = c.Errors.String()
		}

		line, _ := json.Marshal(entry)
		logger.Println(string(line))
	}
}

func levelFor(status int) string {
	switch {
	case status >= 500:
		return "error"
	case status >= 400:
		return "warn"
	default:
		return "info"
	}
}
