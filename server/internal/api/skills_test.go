package api

import (
	"testing"

	"github.com/jincurry/skillhub/server/internal/model"
)

// TestListSkills returns the seeded skill in the unauthenticated-listing path
// (still requires a JWT — listing is auth-gated; just no namespace filter).
func TestListSkills(t *testing.T) {
	srv, r := newTestServer(t)
	seedAPIWorld(t, srv.store)

	w := do(t, r, "GET", "/api/v1/skills?ns="+tNs, signFor(t, uOwner), nil)
	if w.Code != 200 {
		t.Fatalf("want 200, got %d: %s", w.Code, w.Body.String())
	}
	var skills []map[string]any
	decode(t, w, &skills)
	if len(skills) == 0 {
		t.Fatal("expected at least one skill in seeded namespace")
	}
	found := false
	for _, k := range skills {
		if k["name"] == tName {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("seeded skill %q not in list response", tName)
	}
}

// TestGetSkillNotFound exercises the 404 branch.
func TestGetSkillNotFound(t *testing.T) {
	srv, r := newTestServer(t)
	seedAPIWorld(t, srv.store)

	w := do(t, r, "GET", "/api/v1/skills/"+tNs+"/no-such-skill", signFor(t, uOwner), nil)
	if w.Code != 404 {
		t.Fatalf("want 404, got %d: %s", w.Code, w.Body.String())
	}
}

// TestCreateSkillBlocksNonMember asserts the namespace-membership gate on
// POST /skills. uOutsider has no membership in tNs.
func TestCreateSkillBlocksNonMember(t *testing.T) {
	srv, r := newTestServer(t)
	seedAPIWorld(t, srv.store)

	body := model.CreateSkillRequest{
		Namespace:      tNs,
		Name:           "outsider-skill",
		Description:    "should be blocked",
		Classification: "L1",
	}
	w := do(t, r, "POST", "/api/v1/skills", signFor(t, uOutsider), body)
	if w.Code != 403 {
		t.Fatalf("want 403 for non-member, got %d: %s", w.Code, w.Body.String())
	}
}

// TestCreateSkillSucceedsForOwner round-trips a create through the API.
func TestCreateSkillSucceedsForOwner(t *testing.T) {
	srv, r := newTestServer(t)
	seedAPIWorld(t, srv.store)

	body := model.CreateSkillRequest{
		Namespace:      tNs,
		Name:           "another-skill",
		Description:    "valid description with enough characters to pass the 30 char heuristic",
		Classification: "L2",
		Tags:           []string{"a", "b"},
	}
	w := do(t, r, "POST", "/api/v1/skills", signFor(t, uOwner), body)
	if w.Code != 201 {
		t.Fatalf("want 201, got %d: %s", w.Code, w.Body.String())
	}
	var out map[string]any
	decode(t, w, &out)
	if out["name"] != "another-skill" {
		t.Errorf("created skill name = %v, want another-skill", out["name"])
	}
}

// TestCreateSkillRejectsBadClassification verifies the binding-level oneof
// check returns 400.
func TestCreateSkillRejectsBadClassification(t *testing.T) {
	srv, r := newTestServer(t)
	seedAPIWorld(t, srv.store)

	body := model.CreateSkillRequest{
		Namespace:      tNs,
		Name:           "x",
		Description:    "desc",
		Classification: "L9",
	}
	w := do(t, r, "POST", "/api/v1/skills", signFor(t, uOwner), body)
	if w.Code != 400 {
		t.Fatalf("want 400, got %d: %s", w.Code, w.Body.String())
	}
}

// TestListTemplates returns the built-in template list.
func TestListTemplates(t *testing.T) {
	srv, r := newTestServer(t)
	seedAPIWorld(t, srv.store)

	w := do(t, r, "GET", "/api/v1/templates", signFor(t, uOwner), nil)
	if w.Code != 200 {
		t.Fatalf("want 200, got %d: %s", w.Code, w.Body.String())
	}
	var list []map[string]any
	decode(t, w, &list)
	if len(list) == 0 {
		t.Error("expected built-in templates to be returned, got empty")
	}
}
