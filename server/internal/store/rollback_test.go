package store

import (
	"strings"
	"testing"
)

// Tests for the "rollback" code paths. In skillHub there are two flavors of
// rollback that operators reach for:
//
//   1. Lifecycle rollback — yank/deprecate a published skill, then open a
//      fresh draft to ship a fix. Implemented by SetSkillLifecycleStatus +
//      CreateDraftVersion.
//   2. Pointer rollback — leave the published skill alone but flip the
//      "latest" dist-tag back to an older approved version so consumers
//      pinning latest fall back to a known-good build. Implemented by
//      SetDistTag.
//
// CreateDraftVersion in particular had no direct coverage before; everything
// below exercises the guards and audit side effects on those paths.

// promoteToPublished mutates the skill row directly so the rollback paths
// have a realistic starting point. Uses raw SQL because the test world's
// CreateSkill always seeds at status='draft', and walking the full
// submit→approve flow just to set one column would drown the assertions.
func promoteToPublished(t *testing.T, s *Store, ns, name, version string) {
	t.Helper()
	if _, err := s.DB.Exec(
		`UPDATE skills SET status='published', version=?, updated_at=CURRENT_TIMESTAMP
		   WHERE ns=? AND name=?`,
		version, ns, name,
	); err != nil {
		t.Fatalf("promote to published: %v", err)
	}
	// Mirror the version row so anything downstream (dist-tag set, history
	// listings) can find it.
	if _, err := s.DB.Exec(
		`INSERT INTO skill_versions(ns,name,version,status,author,note)
		 VALUES(?,?,?,?,?,?)`,
		ns, name, version, "approved", tAuthor, "",
	); err != nil {
		t.Fatalf("seed skill_versions: %v", err)
	}
}

func setSkillStatus(t *testing.T, s *Store, ns, name, status string) {
	t.Helper()
	if _, err := s.DB.Exec(
		`UPDATE skills SET status=?, updated_at=CURRENT_TIMESTAMP WHERE ns=? AND name=?`,
		status, ns, name,
	); err != nil {
		t.Fatalf("set status %s: %v", status, err)
	}
}

// ---------------------------------------------------------------------------
// bumpedVersion — pure helper, exercised here so the rollback callers can
// rely on its semantics without integration overhead.
// ---------------------------------------------------------------------------

func TestBumpedVersion(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"1.2.3", "1.2.4"},
		{"0.0.0", "0.0.1"},
		{"10.20.30", "10.20.31"},
		{"  1.0.0  ", "1.0.1"}, // whitespace tolerated
		{"", "0.1.0"},           // empty becomes the seed version
		{"abc", "abc.1"},        // non-semver falls back to suffix
		{"1.2", "1.2.1"},        // missing patch component → suffix
	}
	for _, c := range cases {
		got := bumpedVersion(c.in)
		if got != c.want {
			t.Errorf("bumpedVersion(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// ---------------------------------------------------------------------------
// CreateDraftVersion — happy paths and guard rails.
// ---------------------------------------------------------------------------

func TestCreateDraftVersion_FromPublished(t *testing.T) {
	s := newTestStore(t)
	ns, name := seedBasicWorld(t, s)
	promoteToPublished(t, s, ns, name, "1.0.0")

	got, err := s.CreateDraftVersion(ns, name, "1.0.1", tAuthor)
	if err != nil {
		t.Fatalf("CreateDraftVersion: %v", err)
	}
	if got.Status != "draft" {
		t.Errorf("status = %q, want draft", got.Status)
	}
	if got.Version != "1.0.1" {
		t.Errorf("version = %q, want 1.0.1", got.Version)
	}

	// audit_logs should record one create_draft for the bump (plus the one
	// CreateSkill emits at seed time — we filter by version to isolate ours).
	var n int
	if err := s.DB.QueryRow(
		`SELECT COUNT(*) FROM audit_logs
		   WHERE actor=? AND action='create_draft' AND target=? AND version='v1.0.1'`,
		tAuthor, ns+"/"+name,
	).Scan(&n); err != nil {
		t.Fatalf("audit count: %v", err)
	}
	if n != 1 {
		t.Errorf("create_draft audit rows for v1.0.1 = %d, want 1", n)
	}
}

func TestCreateDraftVersion_FromYanked(t *testing.T) {
	// The canonical rollback flow: yank the bad version, then open a draft to
	// ship a fix. CreateDraftVersion must accept the 'yanked' status.
	s := newTestStore(t)
	ns, name := seedBasicWorld(t, s)
	promoteToPublished(t, s, ns, name, "1.2.3")
	setSkillStatus(t, s, ns, name, "yanked")

	got, err := s.CreateDraftVersion(ns, name, "1.2.4", tAuthor)
	if err != nil {
		t.Fatalf("CreateDraftVersion from yanked: %v", err)
	}
	if got.Status != "draft" {
		t.Errorf("status = %q, want draft", got.Status)
	}
	if got.Version != "1.2.4" {
		t.Errorf("version = %q, want 1.2.4", got.Version)
	}
}

func TestCreateDraftVersion_FromDeprecated(t *testing.T) {
	s := newTestStore(t)
	ns, name := seedBasicWorld(t, s)
	promoteToPublished(t, s, ns, name, "2.0.0")
	setSkillStatus(t, s, ns, name, "deprecated")

	got, err := s.CreateDraftVersion(ns, name, "2.1.0", tAuthor)
	if err != nil {
		t.Fatalf("CreateDraftVersion from deprecated: %v", err)
	}
	if got.Status != "draft" {
		t.Errorf("status = %q, want draft", got.Status)
	}
	if got.Version != "2.1.0" {
		t.Errorf("version = %q, want 2.1.0", got.Version)
	}
}

func TestCreateDraftVersion_AutoBumpsWhenVersionEmpty(t *testing.T) {
	s := newTestStore(t)
	ns, name := seedBasicWorld(t, s)
	promoteToPublished(t, s, ns, name, "1.0.0")

	got, err := s.CreateDraftVersion(ns, name, "", tAuthor)
	if err != nil {
		t.Fatalf("CreateDraftVersion: %v", err)
	}
	if got.Version != "1.0.1" {
		t.Errorf("auto-bumped version = %q, want 1.0.1", got.Version)
	}
}

func TestCreateDraftVersion_RejectsFromDraft(t *testing.T) {
	// seedBasicWorld leaves the skill at status='draft'; trying to stack a
	// new draft on top should be refused.
	s := newTestStore(t)
	ns, name := seedBasicWorld(t, s)

	_, err := s.CreateDraftVersion(ns, name, "0.2.0", tAuthor)
	if err == nil {
		t.Fatal("expected error when drafting from draft, got nil")
	}
	if !strings.Contains(err.Error(), "draft") {
		t.Errorf("error = %q, want it to mention current status", err)
	}
}

func TestCreateDraftVersion_RejectsFromReview(t *testing.T) {
	s := newTestStore(t)
	ns, name := seedBasicWorld(t, s)
	setSkillStatus(t, s, ns, name, "review")

	_, err := s.CreateDraftVersion(ns, name, "0.2.0", tAuthor)
	if err == nil {
		t.Fatal("expected error when drafting from review, got nil")
	}
	if !strings.Contains(err.Error(), "review") {
		t.Errorf("error = %q, want mention of review status", err)
	}
}

func TestCreateDraftVersion_RejectsSameVersion(t *testing.T) {
	// Explicitly handing in the current version is a no-op and should fail
	// loudly; otherwise audit logs would show a "create_draft" for nothing.
	s := newTestStore(t)
	ns, name := seedBasicWorld(t, s)
	promoteToPublished(t, s, ns, name, "1.0.0")

	_, err := s.CreateDraftVersion(ns, name, "1.0.0", tAuthor)
	if err == nil {
		t.Fatal("expected error for same version, got nil")
	}
	if !strings.Contains(err.Error(), "differ") {
		t.Errorf("error = %q, want mention of version difference", err)
	}
}

func TestCreateDraftVersion_NotFound(t *testing.T) {
	s := newTestStore(t)

	_, err := s.CreateDraftVersion("ghost-ns", "ghost-skill", "1.0.0", tAuthor)
	if err == nil {
		t.Fatal("expected error for unknown skill, got nil")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("error = %q, want 'not found'", err)
	}
}

func TestCreateDraftVersion_PreservesHistory(t *testing.T) {
	// Opening a new draft must not erase the previous published version row;
	// reviewers and consumers still need the old bundle for diffs / rollback.
	s := newTestStore(t)
	ns, name := seedBasicWorld(t, s)
	promoteToPublished(t, s, ns, name, "1.0.0")

	if _, err := s.CreateDraftVersion(ns, name, "1.0.1", tAuthor); err != nil {
		t.Fatalf("CreateDraftVersion: %v", err)
	}

	var n int
	if err := s.DB.QueryRow(
		`SELECT COUNT(*) FROM skill_versions WHERE ns=? AND name=? AND version='1.0.0'`,
		ns, name,
	).Scan(&n); err != nil {
		t.Fatalf("read history: %v", err)
	}
	if n != 1 {
		t.Errorf("skill_versions for 1.0.0 = %d, want 1 (history must be preserved)", n)
	}
}

// ---------------------------------------------------------------------------
// Pointer rollback — manually flipping `latest` back to an older version.
// ---------------------------------------------------------------------------

// TestRollbackLatestDistTagToOlderVersion mirrors the operator runbook: an
// approved publish auto-points latest at the new version; if it turns out
// to be broken, an admin can flip latest back to a known-good build without
// yanking the bad one. Verifies that ResolveDistTag picks up the manual
// override and the audit row reflects it.
func TestRollbackLatestDistTagToOlderVersion(t *testing.T) {
	s := newTestStore(t)
	ns, name := seedBasicWorld(t, s)

	// Two approved versions in history; the most recent one is "latest".
	for _, v := range []string{"1.0.0", "1.1.0"} {
		if _, err := s.DB.Exec(
			`INSERT INTO skill_versions(ns,name,version,status,author,note)
			 VALUES(?,?,?,?,?,?)`,
			ns, name, v, "approved", tAuthor, "",
		); err != nil {
			t.Fatalf("seed version %s: %v", v, err)
		}
	}
	if err := s.SetDistTag(ns, name, "latest", "1.1.0", "system"); err != nil {
		t.Fatalf("seed latest=1.1.0: %v", err)
	}

	// Operator decides 1.1.0 is bad: roll latest back to 1.0.0.
	if err := s.SetDistTag(ns, name, "latest", "1.0.0", tOwner); err != nil {
		t.Fatalf("rollback latest: %v", err)
	}

	v, err := s.ResolveDistTag(ns, name, "latest")
	if err != nil {
		t.Fatalf("resolve latest: %v", err)
	}
	if v != "1.0.0" {
		t.Errorf("latest after rollback = %q, want 1.0.0", v)
	}

	// updated_by should reflect the human operator, not "system" — that's
	// what makes the manual rollback distinguishable in audit views.
	var updatedBy string
	if err := s.DB.QueryRow(
		`SELECT updated_by FROM skill_dist_tags WHERE ns=? AND skill_name=? AND tag='latest'`,
		ns, name,
	).Scan(&updatedBy); err != nil {
		t.Fatalf("read updated_by: %v", err)
	}
	if updatedBy != tOwner {
		t.Errorf("updated_by = %q, want %q", updatedBy, tOwner)
	}
}

// TestRollbackLatestRejectsUnknownVersion asserts the safety net: trying to
// roll latest at a version that was never published is rejected with a
// helpful error rather than silently writing a dangling tag.
func TestRollbackLatestRejectsUnknownVersion(t *testing.T) {
	s := newTestStore(t)
	ns, name := seedBasicWorld(t, s)

	err := s.SetDistTag(ns, name, "latest", "9.9.9", tOwner)
	if err == nil {
		t.Fatal("expected error for unknown version, got nil")
	}
	if !strings.Contains(err.Error(), "9.9.9") {
		t.Errorf("error = %q, want mention of bad version", err)
	}
}

// ---------------------------------------------------------------------------
// Yank → draft → resubmit (the full rollback flow stitched together).
// ---------------------------------------------------------------------------

// TestYankThenDraftFromYanked walks the operator runbook end to end: a
// published skill gets yanked, then the author opens a fresh draft from the
// yanked state. Both lifecycle hops should leave matching audit_logs rows so
// admins can reconstruct the timeline.
func TestYankThenDraftFromYanked(t *testing.T) {
	s := newTestStore(t)
	ns, name := seedBasicWorld(t, s)
	promoteToPublished(t, s, ns, name, "1.0.0")

	if err := s.SetSkillLifecycleStatus(ns, name, "yanked", tOwner, "broke prod"); err != nil {
		t.Fatalf("yank: %v", err)
	}
	got, err := s.GetSkill(ns, name)
	if err != nil || got == nil {
		t.Fatalf("get yanked skill: %v", err)
	}
	if got.Status != "yanked" {
		t.Fatalf("status after yank = %q, want yanked", got.Status)
	}

	drafted, err := s.CreateDraftVersion(ns, name, "1.0.1", tAuthor)
	if err != nil {
		t.Fatalf("draft from yanked: %v", err)
	}
	if drafted.Status != "draft" {
		t.Errorf("status after draft = %q, want draft", drafted.Status)
	}
	if drafted.Version != "1.0.1" {
		t.Errorf("version after draft = %q, want 1.0.1", drafted.Version)
	}

	// Audit log should carry both the yank and the create_draft. This is the
	// trail an incident review reads to confirm the rollback was deliberate.
	var yankCount, draftCount int
	if err := s.DB.QueryRow(
		`SELECT COUNT(*) FROM audit_logs WHERE action='yanked' AND actor=? AND target=?`,
		tOwner, ns+"/"+name,
	).Scan(&yankCount); err != nil {
		t.Fatalf("count yank audits: %v", err)
	}
	if yankCount != 1 {
		t.Errorf("yank audit rows = %d, want 1", yankCount)
	}
	if err := s.DB.QueryRow(
		`SELECT COUNT(*) FROM audit_logs WHERE action='create_draft' AND actor=? AND version='v1.0.1'`,
		tAuthor,
	).Scan(&draftCount); err != nil {
		t.Fatalf("count draft audits: %v", err)
	}
	if draftCount != 1 {
		t.Errorf("create_draft audit rows for v1.0.1 = %d, want 1", draftCount)
	}
}
