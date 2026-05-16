package store

import (
	"testing"
)

// TestAddInlineComment exercises the file/line/side anchor on AddComment:
// a fully-anchored payload round-trips intact, while partial inputs fall
// back to a general comment.
func TestAddInlineComment(t *testing.T) {
	s := newTestStore(t)
	ns, name := seedBasicWorld(t, s)

	// Need a review to attach comments to. Use the same submit path the API
	// uses so the row layout matches production.
	rev, err := s.SubmitDraftForReview(ns, name, "0.1.0", "n", tAuthor,
		[]string{tOwner}, SubmitDraftOptions{})
	if err != nil {
		t.Fatalf("SubmitDraftForReview: %v", err)
	}

	// 1. Fully-anchored inline comment round-trips.
	c1, err := s.AddComment(rev.ID, tOwner, "needs a guard clause",
		CommentAnchor{FilePath: "SKILL.md", LineNo: 7, Side: "head"})
	if err != nil {
		t.Fatalf("AddComment inline: %v", err)
	}
	if c1.FilePath != "SKILL.md" || c1.LineNo != 7 || c1.Side != "head" {
		t.Errorf("inline anchor not preserved: %+v", c1)
	}

	// 2. Missing line falls back to general.
	c2, err := s.AddComment(rev.ID, tOwner, "lgtm overall",
		CommentAnchor{FilePath: "SKILL.md", Side: "head"})
	if err != nil {
		t.Fatalf("AddComment general: %v", err)
	}
	if c2.FilePath != "" || c2.LineNo != 0 || c2.Side != "" {
		t.Errorf("expected general comment, got anchored: %+v", c2)
	}

	// 3. Invalid side is dropped (defence in depth — UI should not send this).
	c3, err := s.AddComment(rev.ID, tOwner, "?",
		CommentAnchor{FilePath: "SKILL.md", LineNo: 1, Side: "junk"})
	if err != nil {
		t.Fatalf("AddComment invalid side: %v", err)
	}
	if c3.FilePath != "" || c3.LineNo != 0 || c3.Side != "" {
		t.Errorf("invalid side should fall back to general: %+v", c3)
	}

	// 4. ListComments returns all three; ordering is by file_path, line_no.
	got, err := s.ListComments(rev.ID)
	if err != nil {
		t.Fatalf("ListComments: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("want 3 comments, got %d", len(got))
	}
	// First two have empty file_path (general); inline comes last.
	if got[len(got)-1].FilePath != "SKILL.md" || got[len(got)-1].LineNo != 7 {
		t.Errorf("inline comment should sort last by (file,line); got order %+v", got)
	}
}
