// Package i18n is a minimal Accept-Language negotiator for skillHub's user-
// visible strings. We deliberately don't pull in golang.org/x/text/message
// or go-i18n: skillHub has ~30 translatable strings on the server, all of
// which are short error messages or notification bodies. A flat
// map[lang]map[key]string is plenty.
//
// Usage:
//
//	lang := i18n.LangFrom(c)              // gin.Context, falls back to default
//	msg := i18n.T(lang, "skill.not_found") // translated string, or the key on miss
//	body := i18n.T(lang, "review.approved", "ns/name", "v1.2.3")  // sprintf args
//
// Keys are dotted, lowercase, snake_case. Adding a new locale: drop a new
// entry in `tables` and translate every key. Missing keys fall back to the
// default locale (zh-CN) and finally to the literal key — never panic.
package i18n

import (
	"net/http"
	"strings"
)

// Lang is the canonical short tag we use internally. Externally we accept
// anything Accept-Language throws at us and normalize.
type Lang string

const (
	ZhCN    Lang = "zh-CN"
	En      Lang = "en"
	Default      = ZhCN
)

var supported = []Lang{ZhCN, En}

// LangFromHeader picks the best supported language out of an Accept-Language
// header value. We don't bother with full RFC 7231 q-value parsing — the
// header is almost always either a single tag or a tiny list, and the worst
// case (we pick the wrong one out of two equally-weighted entries) just
// shows the default locale.
func LangFromHeader(h string) Lang {
	if h == "" {
		return Default
	}
	for _, part := range strings.Split(h, ",") {
		// "zh-CN;q=0.9" → "zh-CN"
		tag := strings.TrimSpace(strings.SplitN(part, ";", 2)[0])
		if tag == "" {
			continue
		}
		l := strings.ToLower(tag)
		switch {
		case strings.HasPrefix(l, "zh"):
			return ZhCN
		case strings.HasPrefix(l, "en"):
			return En
		}
	}
	return Default
}

// LangFromRequest extracts the language from an HTTP request. The frontend
// sets Accept-Language to the user's UI locale; this is the only signal we
// look at server-side (we don't read cookies or query params).
func LangFromRequest(r *http.Request) Lang {
	return LangFromHeader(r.Header.Get("Accept-Language"))
}

// T looks up `key` in the given language's table and substitutes %s/%d
// placeholders the same way fmt.Sprintf would. We deliberately keep the
// formatter as a thin shim over fmt because mixing positional args with
// named %{name}s placeholders adds complexity for ~no benefit at this
// scale.
func T(lang Lang, key string, args ...any) string {
	tbl, ok := tables[lang]
	if !ok {
		tbl = tables[Default]
	}
	msg, ok := tbl[key]
	if !ok {
		// Fall back to default locale, then to the key itself. Never panic
		// — a missing translation should never break a response.
		if def, ok2 := tables[Default][key]; ok2 {
			msg = def
		} else {
			return key
		}
	}
	if len(args) == 0 {
		return msg
	}
	return sprintf(msg, args...)
}

// IsSupported reports whether `lang` is one we have a translation table for.
// Used by tests; callers should usually just call T and let the fallback
// handle unknown tags.
func IsSupported(lang Lang) bool {
	for _, s := range supported {
		if s == lang {
			return true
		}
	}
	return false
}
