package api

import (
	"fmt"
	"testing"

	"github.com/jincurry/skillhub/server/internal/model"
)

// TestNotificationsAfterComment verifies that adding a comment on a review
// creates an in-app notification for the review author, which the author can
// then list and mark read via the /me/notifications endpoints.
func TestNotificationsAfterComment(t *testing.T) {
	srv, r := newTestServer(t)
	ns, name := seedAPIWorld(t, srv.store)

	// uOwner submits, uReviewer comments — owner should get a notification.
	w := do(t, r, "POST", "/api/v1/skills/"+ns+"/"+name+"/submit", signFor(t, uOwner),
		model.SubmitReviewRequest{Version: "0.1.0", Reviewers: []string{uReviewer}})
	if w.Code != 201 {
		t.Fatalf("submit: %d: %s", w.Code, w.Body.String())
	}
	var rev model.Review
	decode(t, w, &rev)

	w = do(t, r, "POST", fmt.Sprintf("/api/v1/reviews/%d/comments", rev.ID),
		signFor(t, uReviewer),
		map[string]any{"body": "nudging the author"})
	if w.Code != 201 {
		t.Fatalf("add comment: %d: %s", w.Code, w.Body.String())
	}

	// List notifications for the author.
	w = do(t, r, "GET", "/api/v1/me/notifications", signFor(t, uOwner), nil)
	if w.Code != 200 {
		t.Fatalf("list notifs: %d: %s", w.Code, w.Body.String())
	}
	var notifs []model.Notification
	decode(t, w, &notifs)
	hasComment := false
	for _, n := range notifs {
		if n.Kind == "comment" && n.Unread {
			hasComment = true
			break
		}
	}
	if !hasComment {
		t.Fatalf("expected an unread comment notification for %s, got %+v", uOwner, notifs)
	}

	// Mark all read.
	w = do(t, r, "POST", "/api/v1/me/notifications/read", signFor(t, uOwner),
		map[string]any{"all": true})
	if w.Code != 200 {
		t.Fatalf("mark read: %d: %s", w.Code, w.Body.String())
	}

	// Verify they are now read.
	w = do(t, r, "GET", "/api/v1/me/notifications", signFor(t, uOwner), nil)
	if w.Code != 200 {
		t.Fatalf("list after read: %d", w.Code)
	}
	decode(t, w, &notifs)
	for _, n := range notifs {
		if n.Unread {
			t.Errorf("expected all notifications read, found unread: %+v", n)
		}
	}
}
