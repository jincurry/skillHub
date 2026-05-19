package i18n

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// LangFromHeader is the centerpiece — every request goes through it. We
// cover the three cases that actually happen in production: a single tag,
// a quality-weighted list, and an empty/garbage header that should fall
// back to the default locale.

func TestLangFromHeader(t *testing.T) {
	cases := []struct {
		header string
		want   Lang
	}{
		{"", Default},
		{"zh-CN", ZhCN},
		{"zh", ZhCN},
		{"en", En},
		{"en-US", En},
		{"en, zh-CN;q=0.8", En},
		{"zh-CN, en;q=0.8", ZhCN},
		{"fr-FR, de;q=0.9", Default}, // unsupported → default
		{"  ", Default},
	}
	for _, tc := range cases {
		if got := LangFromHeader(tc.header); got != tc.want {
			t.Errorf("LangFromHeader(%q) = %q, want %q", tc.header, got, tc.want)
		}
	}
}

// T must never panic on a missing key — we'd rather show the literal key in
// the UI than 500 the request. Verify both the key-fallback and the
// language-fallback paths.

func TestT_FallsBackOnMissingKey(t *testing.T) {
	got := T(En, "this.does.not.exist")
	if got != "this.does.not.exist" {
		t.Errorf("missing key should return key, got %q", got)
	}
}

func TestT_DefaultLocaleFallback(t *testing.T) {
	// Suppose we have a key only in zh-CN; asking En for it should fall
	// back to the zh-CN translation rather than returning the key. We
	// simulate by inserting a zh-CN-only key into the local table.
	tables[ZhCN]["test.zh_only"] = "仅中文"
	t.Cleanup(func() { delete(tables[ZhCN], "test.zh_only") })

	if got := T(En, "test.zh_only"); got != "仅中文" {
		t.Errorf("En should fall back to zh-CN, got %q", got)
	}
}

func TestT_FormatsArgs(t *testing.T) {
	// notif.review_approved is a real translatable; we use it to check
	// that %s args interpolate without us re-parsing the format string.
	got := T(ZhCN, "notif.review_approved", "platform-team/deploy-helper", "1.2.3")
	if !strings.Contains(got, "platform-team/deploy-helper") {
		t.Errorf("zh-CN translation should contain ns/name, got %q", got)
	}
	if !strings.Contains(got, "1.2.3") {
		t.Errorf("zh-CN translation should contain version, got %q", got)
	}

	got = T(En, "notif.review_approved", "platform-team/deploy-helper", "1.2.3")
	if !strings.Contains(got, "Your") {
		t.Errorf("En translation should start with 'Your', got %q", got)
	}
}

// LangFromGin is a thin wrapper but the nil-context path is easy to break
// when refactoring; cover it explicitly.

func TestLangFromGin_NilSafe(t *testing.T) {
	if got := LangFromGin(nil); got != Default {
		t.Errorf("nil context should yield default, got %q", got)
	}
}

func TestLangFromGin_ReadsHeader(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Accept-Language", "en, zh-CN;q=0.8")
	c.Request = req

	if got := LangFromGin(c); got != En {
		t.Errorf("expected En from Accept-Language header, got %q", got)
	}
}

// IsSupported is a sanity check used by other packages that want to gate
// behaviour on whether a locale exists at all.

func TestIsSupported(t *testing.T) {
	if !IsSupported(ZhCN) {
		t.Error("ZhCN must be supported")
	}
	if !IsSupported(En) {
		t.Error("En must be supported")
	}
	if IsSupported(Lang("fr-FR")) {
		t.Error("Lang(fr-FR) must not be reported as supported")
	}
}

// Every key defined in zh-CN must also exist in en (and vice versa) —
// otherwise English users will silently see Chinese fallbacks. This
// guards against drift when adding new keys.

func TestTables_ParityBetweenLocales(t *testing.T) {
	zh := tables[ZhCN]
	en := tables[En]
	for k := range zh {
		if _, ok := en[k]; !ok {
			t.Errorf("key %q exists in zh-CN but missing in en", k)
		}
	}
	for k := range en {
		if _, ok := zh[k]; !ok {
			t.Errorf("key %q exists in en but missing in zh-CN", k)
		}
	}
}
