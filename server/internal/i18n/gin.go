package i18n

import "github.com/gin-gonic/gin"

// LangFromGin reads the Accept-Language header from a gin.Context. Wrapper
// over LangFromRequest so handlers don't have to reach into c.Request.
func LangFromGin(c *gin.Context) Lang {
	if c == nil || c.Request == nil {
		return Default
	}
	return LangFromRequest(c.Request)
}

// Error is a small convenience for handler-side `gin.H{"error": T(...)}`.
// Saves a couple of lines per call site.
//
//	i18n.Error(c, 403, "api.need_author_or_maintainer")
//
// Equivalent to:
//
//	c.JSON(403, gin.H{"error": i18n.T(i18n.LangFromGin(c), "api.need_author_or_maintainer")})
func Error(c *gin.Context, status int, key string, args ...any) {
	c.JSON(status, gin.H{"error": T(LangFromGin(c), key, args...)})
}
