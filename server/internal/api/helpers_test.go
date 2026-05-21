package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jincurry/skillhub/server/internal/auth"
	"github.com/jincurry/skillhub/server/internal/blobstore"
	"github.com/jincurry/skillhub/server/internal/config"
	"github.com/jincurry/skillhub/server/internal/model"
	"github.com/jincurry/skillhub/server/internal/store"
)

// Shared usernames for tests. Suffixed with "api-" so they can't collide
// with the demo rows seedIfEmpty inserts at Open() time.
const (
	uOwner    = "api-owner"
	uAuthor   = "api-author"
	uReviewer = "api-reviewer"
	uOutsider = "api-outsider"
	uAdmin    = "api-admin"

	tNs   = "api-test-ns"
	tName = "api-test-skill"
)

var testSecret = []byte("test-secret-do-not-use-in-prod")

func init() {
	gin.SetMode(gin.TestMode)
}

// newTestServer spins up an isolated Server with a fresh on-disk SQLite under
// t.TempDir, returns the *Server and a gin.Engine ready to receive requests.
// JWTSecret is fixed so tokens can be minted directly with signFor().
func newTestServer(t *testing.T) (*Server, *gin.Engine) {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "api.db")
	st, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = st.DB.Close() })

	blobs, err := blobstore.NewLocal(filepath.Join(t.TempDir(), "blobs"))
	if err != nil {
		t.Fatalf("open blobstore: %v", err)
	}

	cfg := config.Config{
		Addr:      ":0",
		DBPath:    dbPath,
		DataDir:   t.TempDir(),
		User:      uOwner,
		JWTSecret: testSecret,
		JWTTTL:    1 * time.Hour,
		LogWriter: io.Discard,
	}
	srv := New(cfg, st, blobs)
	return srv, srv.Routes()
}

// signFor returns a Bearer-style "Authorization" header value carrying a JWT
// for the given username, signed with the test secret. Suitable for any
// handler that goes through s.authMiddleware().
func signFor(t *testing.T, user string) string {
	t.Helper()
	tok, err := auth.SignJWT(user, testSecret, time.Hour)
	if err != nil {
		t.Fatalf("sign jwt: %v", err)
	}
	return "Bearer " + tok
}

// do fires a request through the gin engine and returns the recorder.
// body may be nil, a string, []byte, or any JSON-marshalable value.
func do(t *testing.T, r *gin.Engine, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		switch v := body.(type) {
		case string:
			rdr = bytes.NewReader([]byte(v))
		case []byte:
			rdr = bytes.NewReader(v)
		default:
			b, err := json.Marshal(v)
			if err != nil {
				t.Fatalf("marshal body: %v", err)
			}
			rdr = bytes.NewReader(b)
		}
	}
	req := httptest.NewRequest(method, path, rdr)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", token)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// decode unmarshals the recorder body into out, failing the test on error.
func decode(t *testing.T, w *httptest.ResponseRecorder, out any) {
	t.Helper()
	if err := json.Unmarshal(w.Body.Bytes(), out); err != nil {
		t.Fatalf("decode body (%s): %v", w.Body.String(), err)
	}
}

// seedAPIWorld inserts the minimum rows needed for the review pipeline:
// owner / author / reviewer / outsider / admin users, the test namespace
// owned by uOwner with uReviewer added, and one draft skill authored by
// uAuthor. Returns (ns, name). Mirrors store.seedBasicWorld but exists
// in the api package so we can reuse it across tests here.
func seedAPIWorld(t *testing.T, st *store.Store) (ns, name string) {
	t.Helper()
	users := []struct {
		Name    string
		IsAdmin int
	}{
		{uOwner, 0}, {uAuthor, 0}, {uReviewer, 0}, {uOutsider, 0}, {uAdmin, 1},
	}
	// bcrypt-hashed "pw" so login flow can authenticate without bcrypt cost on every test.
	pwHash, err := auth.HashPassword("pw")
	if err != nil {
		t.Fatalf("hash pw: %v", err)
	}
	for _, u := range users {
		if _, err := st.DB.Exec(
			`INSERT INTO users(username,display,role,team,password_hash,email,bio,location,is_admin)
			 VALUES(?,?,?,?,?,?,?,?,?)`,
			u.Name, u.Name, "engineer", "platform", pwHash, u.Name+"@example.com", "", "", u.IsAdmin,
		); err != nil {
			t.Fatalf("insert user %s: %v", u.Name, err)
		}
	}
	ns, name = tNs, tName
	if _, err := st.CreateNamespace(ns, uOwner); err != nil {
		t.Fatalf("create ns: %v", err)
	}
	if err := st.AddNamespaceMember(ns, uReviewer, "reviewer", uOwner); err != nil {
		t.Fatalf("add reviewer: %v", err)
	}
	// Author is outside the namespace by design — gives RBAC tests something
	// to assert (createSkill should reject).
	if _, err := st.CreateSkill(model.CreateSkillRequest{
		Namespace:      ns,
		Name:           name,
		Description:    "demo skill for api tests with enough description text to pass validate",
		Classification: "L1",
		Tags:           []string{"demo", "api-test"},
	}, uOwner); err != nil {
		t.Fatalf("create skill: %v", err)
	}
	return ns, name
}
