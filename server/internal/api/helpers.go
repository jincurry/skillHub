package api

import (
	"log"
	"strconv"

	"github.com/gin-gonic/gin"
)

// Pagination bounds keep clients from triggering unbounded scans by sending
// limit=1000000 or huge offsets.
const (
	defaultListLimit = 100
	maxListLimit     = 500
	maxListOffset    = 100000
)

// serverError logs the underlying error with request context and returns a
// generic message to the client. Internal error strings can leak schema
// details (e.g. "UNIQUE constraint failed: skills(ns,name)"), so they should
// not be echoed back over the wire.
func serverError(c *gin.Context, err error) {
	log.Printf("internal error: method=%s path=%s err=%v",
		c.Request.Method, c.Request.URL.Path, err)
	c.JSON(500, gin.H{"error": "internal server error"})
}

// parsePagination reads limit/offset query params with safe defaults and caps.
// A missing or non-numeric value falls back to the default; negatives clamp to
// zero / default; very large values clamp to the hard cap.
func parsePagination(c *gin.Context) (limit, offset int) {
	limit, _ = strconv.Atoi(c.Query("limit"))
	offset, _ = strconv.Atoi(c.Query("offset"))
	if limit <= 0 {
		limit = defaultListLimit
	}
	if limit > maxListLimit {
		limit = maxListLimit
	}
	if offset < 0 {
		offset = 0
	}
	if offset > maxListOffset {
		offset = maxListOffset
	}
	return
}
