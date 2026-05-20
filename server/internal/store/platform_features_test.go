package store

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"sync"
	"testing"

	"github.com/jincurry/skillhub/server/internal/model"
)

// newTestStore opens a fresh on-disk SQLite under t.TempDir so each test
// gets a clean schema. We can't use ":memory:" because Open() relies on
// pragmas + WAL that don't compose cleanly with that mode.
func newTestStore(t *testing.T) *Store {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "test.db")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = s.DB.Close() })
	return s
}

// seedBasicWorld inserts the minimum rows needed to drive a submit/decide
// loop: one namespace, an owner, a maintainer, an author, and a draft skill
// at L1 classification. Returns the (ns, name) of the seeded skill.
// We prefix the seeded test users so they don't collide with the rows
// seedIfEmpty inserts at Open() time. Tests reference them as constants to
// keep assertions readable.
const (
	tOwner      = "test-owner"
	tMaintainer = "test-maint"
	tReviewer   = "test-reviewer"
	tAuthor     = "test-author"
)

func seedBasicWorld(t *testing.T, s *Store) (ns, name string) {
	t.Helper()
	ns, name = "test-team-x", "test-skill"
	for _, u := range []string{tOwner, tMaintainer, tReviewer, tAuthor} {
		if _, err := s.DB.Exec(
			`INSERT INTO users(username,display,role,team,password_hash,email,bio,location,is_admin)
			 VALUES(?,?,?,?,?,?,?,?,?)`,
			u, u, "engineer", "platform", "", u+"@example.com", "", "", 0,
		); err != nil {
			t.Fatalf("insert user %s: %v", u, err)
		}
	}
	if _, err := s.CreateNamespace(ns, tOwner); err != nil {
		t.Fatalf("create ns: %v", err)
	}
	if err := s.AddNamespaceMember(ns, tMaintainer, "maintainer", tOwner); err != nil {
		t.Fatalf("add maintainer: %v", err)
	}
	if err := s.AddNamespaceMember(ns, tReviewer, "reviewer", tOwner); err != nil {
		t.Fatalf("add reviewer: %v", err)
	}
	// Author is *not* a ns member on purpose — exercises cross-ns picks.
	if _, err := s.CreateSkill(model.CreateSkillRequest{
		Namespace:      ns,
		Name:           name,
		Description:    "demo",
		Classification: "L1",
		Tags:           []string{"demo"},
	}, tAuthor); err != nil {
		t.Fatalf("create skill: %v", err)
	}
	return ns, name
}

// TestSubmitDraftFreezesPolicySnapshot verifies that submitting a draft
// writes a non-empty JSON snapshot of the policy onto the review row, so
// later admin edits can't retroactively change in-flight reviews.
func TestSubmitDraftFreezesPolicySnapshot(t *testing.T) {
	s := newTestStore(t)
	ns, name := seedBasicWorld(t, s)

	rev, err := s.SubmitDraftForReview(ns, name, "0.1.0", "first", tAuthor,
		[]string{tOwner}, SubmitDraftOptions{})
	if err != nil {
		t.Fatalf("submit: %v", err)
	}

	// Hit the row directly — the public model exposes PolicySnapshot but
	// we want to be sure the column actually has JSON, not "".
	var raw string
	if err := s.DB.QueryRow(`SELECT policy_snapshot FROM reviews WHERE id=?`, rev.ID).Scan(&raw); err != nil {
		t.Fatalf("read snapshot: %v", err)
	}
	if raw == "" {
		t.Fatal("policy_snapshot should be populated, got empty string")
	}
	var snap model.PolicySnapshot
	if err := json.Unmarshal([]byte(raw), &snap); err != nil {
		t.Fatalf("snapshot is not valid json: %v\nraw=%s", err, raw)
	}
	if snap.Classification != "L1" {
		t.Errorf("snapshot.Classification = %q, want L1", snap.Classification)
	}
	if snap.SLAHours <= 0 {
		t.Errorf("snapshot.SLAHours = %d, want > 0", snap.SLAHours)
	}
	if len(snap.Slots) == 0 {
		t.Error("snapshot.Slots should not be empty")
	}
	if snap.Hotfix {
		t.Error("regular submit should not be marked hotfix")
	}
}

// TestHotfixSubmitUsesRelaxedPolicy ensures that an isHotfix submit produces
// a 1-slot, 4h-SLA snapshot regardless of the namespace's L2/L3 policy
// (we use L1 here for simplicity; relaxation is orthogonal to classification).
func TestHotfixSubmitUsesRelaxedPolicy(t *testing.T) {
	s := newTestStore(t)
	ns, name := seedBasicWorld(t, s)

	rev, err := s.SubmitDraftForReview(ns, name, "0.1.0", "urgent fix", tAuthor,
		[]string{tOwner}, SubmitDraftOptions{
			IsHotfix:     true,
			HotfixReason: "prod outage SEV-2",
		})
	if err != nil {
		t.Fatalf("submit hotfix: %v", err)
	}
	if !rev.IsHotfix {
		t.Error("review.IsHotfix should be true")
	}
	if rev.HotfixReason != "prod outage SEV-2" {
		t.Errorf("HotfixReason = %q", rev.HotfixReason)
	}
	if rev.Urgency != "hot" {
		t.Errorf("Urgency = %q, want 'hot'", rev.Urgency)
	}

	var snapJSON string
	if err := s.DB.QueryRow(`SELECT policy_snapshot FROM reviews WHERE id=?`, rev.ID).Scan(&snapJSON); err != nil {
		t.Fatalf("read snapshot: %v", err)
	}
	var snap model.PolicySnapshot
	if err := json.Unmarshal([]byte(snapJSON), &snap); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !snap.Hotfix {
		t.Error("snapshot.Hotfix should be true")
	}
	if snap.SLAHours != 4 {
		t.Errorf("Hotfix SLA = %d, want 4", snap.SLAHours)
	}
	if len(snap.Slots) != 1 || snap.Slots[0].Count != 1 {
		t.Errorf("Hotfix slots = %+v, want [{Count:1}]", snap.Slots)
	}

	// audit_logs should carry both submit_review and hotfix_submit entries.
	var n int
	if err := s.DB.QueryRow(
		`SELECT COUNT(*) FROM audit_logs WHERE action='hotfix_submit' AND actor=?`, tAuthor,
	).Scan(&n); err != nil {
		t.Fatalf("audit count: %v", err)
	}
	if n != 1 {
		t.Errorf("hotfix_submit audit rows = %d, want 1", n)
	}
}

// TestPickHotfixReviewers_UsesHotfixSlot verifies that the hotfix picker
// runs against HotfixPolicy slots (owner/maintainer/reviewer) rather than
// the namespace's regular L1/L2/L3 policy. The picker also must skip the
// author and return exactly one name when the namespace has eligible
// members.
func TestPickHotfixReviewers_UsesHotfixSlot(t *testing.T) {
	s := newTestStore(t)
	ns, _ := seedBasicWorld(t, s)

	picked, err := s.PickHotfixReviewers(ns, tAuthor, "L1")
	if err != nil {
		t.Fatalf("pick hotfix: %v", err)
	}
	if len(picked) != 1 {
		t.Fatalf("hotfix picks = %v, want 1 reviewer", picked)
	}
	if picked[0] == tAuthor {
		t.Errorf("hotfix picker must not pick the author")
	}
	// Should land on the owner first because HotfixPolicy slot lists
	// roles=["owner","maintainer"] and ListNamespaceMembers sorts by ns_role.
	if picked[0] != tOwner {
		t.Errorf("hotfix pick = %q, want %q (owner has highest priority)", picked[0], tOwner)
	}
}

// TestSubscribeAndCounts exercises the basic Subscribe / IsSubscribed /
// CountSubscribers / Unsubscribe lifecycle plus idempotency.
func TestSubscribeAndCounts(t *testing.T) {
	s := newTestStore(t)
	ns, name := seedBasicWorld(t, s)

	// maintainer and reviewer follow the skill.
	for i := 0; i < 2; i++ {
		if err := s.Subscribe(tMaintainer, ns, name); err != nil {
			t.Fatalf("subscribe maintainer #%d: %v", i, err)
		}
	}
	if err := s.Subscribe(tReviewer, ns, name); err != nil {
		t.Fatalf("subscribe reviewer: %v", err)
	}

	n, err := s.CountSubscribers(ns, name)
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 2 {
		t.Errorf("subscribers = %d, want 2", n)
	}

	on, err := s.IsSubscribed(tMaintainer, ns, name)
	if err != nil || !on {
		t.Errorf("IsSubscribed(maintainer)=%v err=%v", on, err)
	}
	if err := s.Unsubscribe(tMaintainer, ns, name); err != nil {
		t.Fatalf("unsubscribe: %v", err)
	}
	on, _ = s.IsSubscribed(tMaintainer, ns, name)
	if on {
		t.Errorf("maintainer should no longer be subscribed")
	}
}

// TestApprovePublishFanOutAndLatestTag drives the full submit→approve loop
// and asserts the side effects we layered on top of DecideReview: every
// subscriber except author + actor gets a notification, and the "latest"
// dist tag is upserted in the same transaction.
func TestApprovePublishFanOutAndLatestTag(t *testing.T) {
	s := newTestStore(t)
	ns, name := seedBasicWorld(t, s)

	// maintainer and reviewer follow the skill; reviewer will be the actor on
	// approve and must NOT receive the notification.
	if err := s.Subscribe(tMaintainer, ns, name); err != nil {
		t.Fatalf("sub maintainer: %v", err)
	}
	if err := s.Subscribe(tReviewer, ns, name); err != nil {
		t.Fatalf("sub reviewer: %v", err)
	}
	if err := s.Subscribe(tAuthor, ns, name); err != nil { // author — must also be skipped
		t.Fatalf("sub author: %v", err)
	}

	rev, err := s.SubmitDraftForReview(ns, name, "0.2.0", "rev", tAuthor,
		[]string{tReviewer}, SubmitDraftOptions{})
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	if err := s.DecideReview(rev.ID, "approve", "lgtm", tReviewer); err != nil {
		t.Fatalf("approve: %v", err)
	}

	// latest tag should now point at 0.2.0.
	v, err := s.ResolveDistTag(ns, name, "latest")
	if err != nil {
		t.Fatalf("resolve latest: %v", err)
	}
	if v != "0.2.0" {
		t.Errorf("latest = %q, want 0.2.0", v)
	}

	// Notifications: fan-out writes a row whose body starts with "你关注的".
	// The author also gets a "publish"-kind row from the separate "your
	// review was approved" code path (body "你的 ..."), which we must NOT
	// count here — otherwise we can't tell the two code paths apart.
	if c := countFanOut(s, tMaintainer); c != 1 {
		t.Errorf("maintainer fan-out notifications = %d, want 1", c)
	}
	if c := countFanOut(s, tReviewer); c != 0 {
		t.Errorf("reviewer (actor) fan-out notifications = %d, want 0", c)
	}
	if c := countFanOut(s, tAuthor); c != 0 {
		t.Errorf("author fan-out notifications = %d, want 0 (author-notify path is a different code path)", c)
	}
}

// countFanOut counts rows in `notifications` that look like the body
// fanOutPublishNotifTx writes (starts with "你关注的"). This lets us assert
// fan-out separately from the author-notify code path which also writes
// kind="publish" but with a different body prefix.
func countFanOut(s *Store, user string) int {
	var n int
	_ = s.DB.QueryRow(
		`SELECT COUNT(*) FROM notifications WHERE user=? AND kind='publish' AND body LIKE '你关注的%'`,
		user,
	).Scan(&n)
	return n
}

// TestSetAndResolveDistTag covers manual tag management: SetDistTag inserts,
// updates, and DeleteDistTag removes; latest is special-cased and refuses
// manual deletion.
func TestSetAndResolveDistTag(t *testing.T) {
	s := newTestStore(t)
	ns, name := seedBasicWorld(t, s)

	// SetDistTag requires a row in skill_versions for the target version.
	// CreateSkill alone doesn't populate that; manually seed two versions
	// so we can also test the overwrite path.
	for _, v := range []string{"0.1.0", "0.2.0"} {
		if _, err := s.DB.Exec(
			`INSERT INTO skill_versions(ns,name,version,status,author,note) VALUES(?,?,?,?,?,?)`,
			ns, name, v, "approved", tAuthor, "",
		); err != nil {
			t.Fatalf("seed skill_versions %s: %v", v, err)
		}
	}

	if err := s.SetDistTag(ns, name, "stable", "0.1.0", tOwner); err != nil {
		t.Fatalf("set stable: %v", err)
	}
	v, err := s.ResolveDistTag(ns, name, "stable")
	if err != nil {
		t.Fatalf("resolve stable: %v", err)
	}
	if v != "0.1.0" {
		t.Errorf("stable = %q, want 0.1.0", v)
	}

	// Overwrite same tag with a new version.
	if err := s.SetDistTag(ns, name, "stable", "0.2.0", tOwner); err != nil {
		t.Fatalf("rewrite stable: %v", err)
	}
	v, _ = s.ResolveDistTag(ns, name, "stable")
	if v != "0.2.0" {
		t.Errorf("stable after rewrite = %q, want 0.2.0", v)
	}

	// Delete non-latest tag should succeed.
	if err := s.DeleteDistTag(ns, name, "stable"); err != nil {
		t.Fatalf("delete stable: %v", err)
	}
	if _, err := s.ResolveDistTag(ns, name, "stable"); err == nil {
		t.Error("stable should be gone after delete")
	}

	// Deleting "latest" should be rejected (auto-managed by publish).
	if err := s.DeleteDistTag(ns, name, "latest"); err == nil {
		t.Error("DeleteDistTag(latest) should reject")
	}
}

// TestDecideReviewIsExclusive verifies that two reviewers racing to approve
// the same review produce exactly one published version: the second caller
// must see ErrReviewNotPending. Without the WHERE status='pending' guard
// inside the UPDATE, the second decision would silently overwrite the first
// and fan out a duplicate "latest" upsert + duplicate notifications.
func TestDecideReviewIsExclusive(t *testing.T) {
	s := newTestStore(t)
	ns, name := seedBasicWorld(t, s)

	// Two reviewers assigned to the same review. Either one is allowed to
	// decide; whichever wins the race should be the one whose decision sticks.
	rev, err := s.SubmitDraftForReview(ns, name, "0.2.0", "rev", tAuthor,
		[]string{tOwner, tReviewer}, SubmitDraftOptions{})
	if err != nil {
		t.Fatalf("submit: %v", err)
	}

	var (
		wg      sync.WaitGroup
		mu      sync.Mutex
		errs    []error
		results []string
	)
	wg.Add(2)
	for _, decision := range []struct {
		actor    string
		decision string
	}{
		{tOwner, "approve"},
		{tReviewer, "reject"},
	} {
		decision := decision
		go func() {
			defer wg.Done()
			err := s.DecideReview(rev.ID, decision.decision, "", decision.actor)
			mu.Lock()
			defer mu.Unlock()
			errs = append(errs, err)
			results = append(results, decision.decision)
		}()
	}
	wg.Wait()

	// Exactly one call must succeed; the other must report ErrReviewNotPending.
	var ok, conflicts int
	for _, e := range errs {
		switch {
		case e == nil:
			ok++
		case errors.Is(e, ErrReviewNotPending):
			conflicts++
		default:
			t.Errorf("unexpected error: %v", e)
		}
	}
	if ok != 1 || conflicts != 1 {
		t.Fatalf("want 1 success + 1 conflict, got %d success / %d conflicts (errs=%v)", ok, conflicts, errs)
	}

	// The persisted review status must reflect a terminal decision (not still
	// "pending"), proving the winning UPDATE landed.
	var status string
	if err := s.DB.QueryRow(`SELECT status FROM reviews WHERE id=?`, rev.ID).Scan(&status); err != nil {
		t.Fatalf("read status: %v", err)
	}
	if status == "pending" {
		t.Fatal("review still pending after both decide calls returned")
	}
}

// TestDecideReviewSecondCallConflicts is the deterministic, non-concurrent
// version of the above: once a review is approved, a follow-up DecideReview
// (e.g. from a stale UI tab) must return ErrReviewNotPending instead of
// silently re-running the publish path and emitting duplicate notifications.
func TestDecideReviewSecondCallConflicts(t *testing.T) {
	s := newTestStore(t)
	ns, name := seedBasicWorld(t, s)

	rev, err := s.SubmitDraftForReview(ns, name, "0.2.0", "rev", tAuthor,
		[]string{tReviewer}, SubmitDraftOptions{})
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	if err := s.DecideReview(rev.ID, "approve", "lgtm", tReviewer); err != nil {
		t.Fatalf("first approve: %v", err)
	}
	err = s.DecideReview(rev.ID, "approve", "lgtm again", tReviewer)
	if !errors.Is(err, ErrReviewNotPending) {
		t.Fatalf("second approve err = %v, want ErrReviewNotPending", err)
	}
}
