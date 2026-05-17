package api

import (
	"fmt"
	"testing"

	"github.com/jincurry/skillhub/server/internal/model"
)

// TestPatchCommentHappyPath verifies that a comment author can edit their own
// comment, and the body updates round-trip correctly.
func TestPatchCommentHappyPath(t *testing.T) {
	srv, r := newTestServer(t)
	ns, name := seedAPIWorld(t, srv.store)

	// Stand up a review with a comment from uReviewer.
	w := do(t, r, "POST", "/api/v1/skills/"+ns+"/"+name+"/submit", signFor(t, uOwner),
		model.SubmitReviewRequest{Version: "0.1.0", Reviewers: []string{uReviewer}})
	if w.Code != 201 {
		t.Fatalf("submit: %d: %s", w.Code, w.Body.String())
	}
	var rev model.Review
	decode(t, w, &rev)

	w = do(t, r, "POST", fmt.Sprintf("/api/v1/reviews/%d/comments", rev.ID),
		signFor(t, uReviewer),
		map[string]any{"body": "original thought"})
	if w.Code != 201 {
		t.Fatalf("add comment: %d: %s", w.Code, w.Body.String())
	}
	var cm model.Comment
	decode(t, w, &cm)

	// Edit as the same author.
	w = do(t, r, "PATCH", fmt.Sprintf("/api/v1/comments/%d", cm.ID),
		signFor(t, uReviewer),
		map[string]any{"body": "revised thought"})
	if w.Code != 200 {
		t.Fatalf("patch: %d: %s", w.Code, w.Body.String())
	}
	var updated model.Comment
	decode(t, w, &updated)
	if updated.Body != "revised thought" {
		t.Errorf("body = %q, want revised thought", updated.Body)
	}
	// Anchor unchanged.
	if updated.FilePath != cm.FilePath || updated.LineNo != cm.LineNo {
		t.Errorf("anchor mutated on patch: %+v vs %+v", updated, cm)
	}
}

// TestPatchCommentBlocksNonAuthor asserts that a different user (even a
// reviewer on the same review) cannot edit someone else's comment.
func TestPatchCommentBlocksNonAuthor(t *testing.T) {
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
		map[string]any{"body": "owner cannot touch this"})
	if w.Code != 201 {
		t.Fatalf("add comment: %d", w.Code)
	}
	var cm model.Comment
	decode(t, w, &cm)

	// Owner tries to edit reviewer's comment — should 403.
	w = do(t, r, "PATCH", fmt.Sprintf("/api/v1/comments/%d", cm.ID),
		signFor(t, uOwner),
		map[string]any{"body": "hacked"})
	if w.Code != 403 {
		t.Fatalf("non-author patch: want 403, got %d", w.Code)
	}
}

// TestPatchCommentAllowsAdmin verifies that admins can edit any comment.
func TestPatchCommentAllowsAdmin(t *testing.T) {
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
		map[string]any{"body": "original"})
	if w.Code != 201 {
		t.Fatalf("add comment: %d", w.Code)
	}
	var cm model.Comment
	decode(t, w, &cm)

	// Admin edits reviewer's comment.
	w = do(t, r, "PATCH", fmt.Sprintf("/api/v1/comments/%d", cm.ID),
		signFor(t, uAdmin),
		map[string]any{"body": "admin edited"})
	if w.Code != 200 {
		t.Fatalf("admin patch: %d", w.Code)
	}
	var updated model.Comment
	decode(t, w, &updated)
	if updated.Body != "admin edited" {
		t.Errorf("admin edit body = %q", updated.Body)
	}
}

// TestDeleteCommentHappyPath verifies author can delete their own comment.
func TestDeleteCommentHappyPath(t *testing.T) {
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
		map[string]any{"body": "delete me"})
	if w.Code != 201 {
		t.Fatalf("add comment: %d", w.Code)
	}
	var cm model.Comment
	decode(t, w, &cm)

	w = do(t, r, "DELETE", fmt.Sprintf("/api/v1/comments/%d", cm.ID),
		signFor(t, uReviewer), nil)
	if w.Code != 200 {
		t.Fatalf("delete: %d: %s", w.Code, w.Body.String())
	}

	// Verify it's gone by listing comments.
	w = do(t, r, "GET", fmt.Sprintf("/api/v1/reviews/%d/comments", rev.ID),
		signFor(t, uOwner), nil)
	if w.Code != 200 {
		t.Fatalf("list after delete: %d", w.Code)
	}
	var comments []model.Comment
	decode(t, w, &comments)
	for _, c := range comments {
		if c.ID == cm.ID {
			t.Errorf("comment %d still present after delete", cm.ID)
		}
	}
}

// TestDeleteCommentBlocksNonAuthor mirrors the patch test for delete.
func TestDeleteCommentBlocksNonAuthor(t *testing.T) {
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
		map[string]any{"body": "x"})
	if w.Code != 201 {
		t.Fatalf("add comment: %d", w.Code)
	}
	var cm model.Comment
	decode(t, w, &cm)

	w = do(t, r, "DELETE", fmt.Sprintf("/api/v1/comments/%d", cm.ID),
		signFor(t, uOwner), nil)
	if w.Code != 403 {
		t.Fatalf("non-author delete: want 403, got %d", w.Code)
	}
}

// TestPatchCommentNotFound exercises the 404 path.
func TestPatchCommentNotFound(t *testing.T) {
	_, r := newTestServer(t)
	w := do(t, r, "PATCH", "/api/v1/comments/99999",
		signFor(t, uOwner),
		map[string]any{"body": "x"})
	if w.Code != 404 {
		t.Fatalf("want 404, got %d", w.Code)
	}
}

// TestDeleteCommentNotFound exercises the 404 path.
func TestDeleteCommentNotFound(t *testing.T) {
	_, r := newTestServer(t)
	w := do(t, r, "DELETE", "/api/v1/comments/99999",
		signFor(t, uOwner), nil)
	if w.Code != 404 {
		t.Fatalf("want 404, got %d", w.Code)
	}
}
