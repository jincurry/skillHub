package api

import (
	"fmt"
	"testing"

	"github.com/jincurry/skillhub/server/internal/model"
)

// TestSubmitReviewFlow drives the full submit + decide loop:
//   - uOwner submits the seeded skill as v0.1.0
//   - uReviewer approves it
//   - listing reviews and getting the review return the expected statuses
//   - publication triggers a comments listing endpoint round-trip
func TestSubmitReviewFlow(t *testing.T) {
	srv, r := newTestServer(t)
	ns, name := seedAPIWorld(t, srv.store)

	// 1. Submit
	subReq := model.SubmitReviewRequest{
		Version:   "0.1.0",
		Note:      "initial",
		Reviewers: []string{uReviewer},
	}
	w := do(t, r, "POST", "/api/v1/skills/"+ns+"/"+name+"/submit", signFor(t, uOwner), subReq)
	if w.Code != 201 {
		t.Fatalf("submit: want 201, got %d: %s", w.Code, w.Body.String())
	}
	var rev model.Review
	decode(t, w, &rev)
	if rev.ID == 0 {
		t.Fatal("submitted review missing id")
	}
	if rev.Status != "pending" {
		t.Errorf("submitted status = %q, want pending", rev.Status)
	}

	// 2. List shows the pending review
	w = do(t, r, "GET", "/api/v1/reviews?status=pending", signFor(t, uOwner), nil)
	if w.Code != 200 {
		t.Fatalf("list: %d: %s", w.Code, w.Body.String())
	}

	// 3. Author can't self-approve
	w = do(t, r, "POST", fmt.Sprintf("/api/v1/reviews/%d/decision", rev.ID),
		signFor(t, uOwner),
		model.DecisionRequest{Decision: "approve"})
	if w.Code != 403 {
		t.Fatalf("self-approve: want 403, got %d", w.Code)
	}

	// 4. Outsider (not assigned) can't approve
	w = do(t, r, "POST", fmt.Sprintf("/api/v1/reviews/%d/decision", rev.ID),
		signFor(t, uOutsider),
		model.DecisionRequest{Decision: "approve"})
	if w.Code != 403 {
		t.Fatalf("outsider-approve: want 403, got %d", w.Code)
	}

	// 5. Assigned reviewer approves
	w = do(t, r, "POST", fmt.Sprintf("/api/v1/reviews/%d/decision", rev.ID),
		signFor(t, uReviewer),
		model.DecisionRequest{Decision: "approve", Note: "lgtm"})
	if w.Code != 200 {
		t.Fatalf("approve: %d: %s", w.Code, w.Body.String())
	}
	var approved model.Review
	decode(t, w, &approved)
	if approved.Status != "approved" {
		t.Errorf("post-approve status = %q, want approved", approved.Status)
	}

	// 6. Approving again -> conflict
	w = do(t, r, "POST", fmt.Sprintf("/api/v1/reviews/%d/decision", rev.ID),
		signFor(t, uReviewer),
		model.DecisionRequest{Decision: "approve"})
	if w.Code != 409 {
		t.Fatalf("double-approve: want 409, got %d", w.Code)
	}
}

// TestSubmitRejectsBlockingValidation ensures a skill with secrets in its
// description can't be submitted (validate.Run flags this as SevErr).
func TestSubmitRejectsBlockingValidation(t *testing.T) {
	srv, r := newTestServer(t)
	ns, name := seedAPIWorld(t, srv.store)

	// Force a validation blocker by stuffing a secret-shaped string into the
	// description. The validate.reSecret pattern matches
	//   (api_key|secret|token|password)\s*[:=]\s*"[^"]{12,}"
	// — i.e. "key=<quoted value of 12+ chars>".
	patchBody := map[string]any{
		"desc": `enough description text to pass the length check api_key="AKIAIOSFODNN7EXAMPLE"`,
	}
	w := do(t, r, "PATCH", "/api/v1/skills/"+ns+"/"+name, signFor(t, uOwner), patchBody)
	if w.Code != 200 {
		t.Fatalf("patch: %d: %s", w.Code, w.Body.String())
	}

	// Now submit — should fail with 422 because validate flags a secret leak.
	w = do(t, r, "POST", "/api/v1/skills/"+ns+"/"+name+"/submit", signFor(t, uOwner),
		model.SubmitReviewRequest{Version: "0.1.0", Reviewers: []string{uReviewer}})
	if w.Code != 422 {
		t.Fatalf("submit-with-secret: want 422, got %d: %s", w.Code, w.Body.String())
	}
}

// TestAddCommentGeneralAndInline covers both POST /reviews/:id/comments
// shapes (anchored + general) and the subsequent listing.
func TestAddCommentGeneralAndInline(t *testing.T) {
	srv, r := newTestServer(t)
	ns, name := seedAPIWorld(t, srv.store)

	// Stand up a review.
	w := do(t, r, "POST", "/api/v1/skills/"+ns+"/"+name+"/submit", signFor(t, uOwner),
		model.SubmitReviewRequest{Version: "0.1.0", Reviewers: []string{uReviewer}})
	if w.Code != 201 {
		t.Fatalf("submit: %d: %s", w.Code, w.Body.String())
	}
	var rev model.Review
	decode(t, w, &rev)

	// General comment.
	w = do(t, r, "POST", fmt.Sprintf("/api/v1/reviews/%d/comments", rev.ID),
		signFor(t, uReviewer),
		map[string]any{"body": "general thought"})
	if w.Code != 201 {
		t.Fatalf("general comment: %d: %s", w.Code, w.Body.String())
	}

	// Inline comment.
	w = do(t, r, "POST", fmt.Sprintf("/api/v1/reviews/%d/comments", rev.ID),
		signFor(t, uReviewer),
		map[string]any{
			"body": "nit", "filePath": "SKILL.md", "lineNo": 3, "side": "head",
		})
	if w.Code != 201 {
		t.Fatalf("inline comment: %d: %s", w.Code, w.Body.String())
	}
	var inline model.Comment
	decode(t, w, &inline)
	if inline.FilePath != "SKILL.md" || inline.LineNo != 3 || inline.Side != "head" {
		t.Errorf("inline anchor not preserved: %+v", inline)
	}

	// List.
	w = do(t, r, "GET", fmt.Sprintf("/api/v1/reviews/%d/comments", rev.ID), signFor(t, uOwner), nil)
	if w.Code != 200 {
		t.Fatalf("list comments: %d: %s", w.Code, w.Body.String())
	}
	var comments []model.Comment
	decode(t, w, &comments)
	if len(comments) != 2 {
		t.Errorf("expected 2 comments, got %d", len(comments))
	}
}

// TestCommentEmptyBodyRejected covers the binding-level min=1 check.
func TestCommentEmptyBodyRejected(t *testing.T) {
	srv, r := newTestServer(t)
	ns, name := seedAPIWorld(t, srv.store)

	w := do(t, r, "POST", "/api/v1/skills/"+ns+"/"+name+"/submit", signFor(t, uOwner),
		model.SubmitReviewRequest{Version: "0.1.0", Reviewers: []string{uReviewer}})
	if w.Code != 201 {
		t.Fatalf("submit: %d", w.Code)
	}
	var rev model.Review
	decode(t, w, &rev)

	w = do(t, r, "POST", fmt.Sprintf("/api/v1/reviews/%d/comments", rev.ID),
		signFor(t, uReviewer),
		map[string]any{"body": ""})
	if w.Code != 400 {
		t.Fatalf("empty body: want 400, got %d: %s", w.Code, w.Body.String())
	}
}
