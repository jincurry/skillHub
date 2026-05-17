package api

import (
	"testing"
)

// TestLoginSuccess verifies that POST /auth/login returns a token + user
// payload for valid credentials.
func TestLoginSuccess(t *testing.T) {
	srv, r := newTestServer(t)
	seedAPIWorld(t, srv.store)

	w := do(t, r, "POST", "/api/v1/auth/login", "", map[string]string{
		"username": uOwner, "password": "pw",
	})
	if w.Code != 200 {
		t.Fatalf("want 200, got %d: %s", w.Code, w.Body.String())
	}
	var out struct {
		Token string         `json:"token"`
		User  map[string]any `json:"user"`
	}
	decode(t, w, &out)
	if out.Token == "" {
		t.Fatal("login response missing token")
	}
	if out.User["username"] != uOwner {
		t.Errorf("user.username = %v, want %s", out.User["username"], uOwner)
	}
}

func TestLoginBadCredentials(t *testing.T) {
	srv, r := newTestServer(t)
	seedAPIWorld(t, srv.store)

	w := do(t, r, "POST", "/api/v1/auth/login", "", map[string]string{
		"username": uOwner, "password": "nope",
	})
	if w.Code != 401 {
		t.Fatalf("want 401, got %d", w.Code)
	}
}

func TestLoginMissingFields(t *testing.T) {
	_, r := newTestServer(t)
	w := do(t, r, "POST", "/api/v1/auth/login", "", map[string]string{})
	if w.Code != 400 {
		t.Fatalf("want 400, got %d", w.Code)
	}
}

// TestAuthMiddlewareRejectsMissingToken hits an authenticated route with no
// Authorization header.
func TestAuthMiddlewareRejectsMissingToken(t *testing.T) {
	_, r := newTestServer(t)
	w := do(t, r, "GET", "/api/v1/me", "", nil)
	if w.Code != 401 {
		t.Fatalf("want 401 without token, got %d", w.Code)
	}
}

// TestAuthMiddlewareRejectsInvalidJWT covers the signature check branch.
func TestAuthMiddlewareRejectsInvalidJWT(t *testing.T) {
	_, r := newTestServer(t)
	w := do(t, r, "GET", "/api/v1/me", "Bearer not.a.jwt", nil)
	if w.Code != 401 {
		t.Fatalf("want 401 for invalid jwt, got %d", w.Code)
	}
}

// TestAuthMiddlewareAcceptsValidJWT verifies the happy path: a signed token
// resolves to the matching user via GET /me.
func TestAuthMiddlewareAcceptsValidJWT(t *testing.T) {
	srv, r := newTestServer(t)
	seedAPIWorld(t, srv.store)

	w := do(t, r, "GET", "/api/v1/me", signFor(t, uOwner), nil)
	if w.Code != 200 {
		t.Fatalf("want 200, got %d: %s", w.Code, w.Body.String())
	}
	var u map[string]any
	decode(t, w, &u)
	if u["username"] != uOwner {
		t.Errorf("got user %v, want %s", u["username"], uOwner)
	}
}

// TestRequireAdminBlocksNonAdmin asserts that hitting an /admin route as a
// non-admin user returns 403.
func TestRequireAdminBlocksNonAdmin(t *testing.T) {
	srv, r := newTestServer(t)
	seedAPIWorld(t, srv.store)

	w := do(t, r, "GET", "/api/v1/admin/users", signFor(t, uOwner), nil)
	if w.Code != 403 {
		t.Fatalf("want 403 for non-admin, got %d", w.Code)
	}
}

// TestRequireAdminAllowsAdmin asserts that the admin user can reach an
// /admin route.
func TestRequireAdminAllowsAdmin(t *testing.T) {
	srv, r := newTestServer(t)
	seedAPIWorld(t, srv.store)

	w := do(t, r, "GET", "/api/v1/admin/users", signFor(t, uAdmin), nil)
	if w.Code != 200 {
		t.Fatalf("want 200 for admin, got %d: %s", w.Code, w.Body.String())
	}
}

// TestHealthz hits the unauthenticated healthcheck.
func TestHealthz(t *testing.T) {
	_, r := newTestServer(t)
	w := do(t, r, "GET", "/healthz", "", nil)
	if w.Code != 200 {
		t.Fatalf("healthz want 200, got %d", w.Code)
	}
}
