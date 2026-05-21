package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
)

// sha256Of returns the hex sha256 of data.
func sha256Of(data []byte) string {
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}

// uploadBlob uploads a blob via PUT /api/v1/blobs/:sha256 and returns the status code.
func uploadBlob(t *testing.T, r interface{ ServeHTTP(http.ResponseWriter, *http.Request) }, token string, data []byte) string {
	t.Helper()
	sum := sha256Of(data)
	req, _ := http.NewRequest(http.MethodPut, "/api/v1/blobs/"+sum, bytes.NewReader(data))
	req.Header.Set("Authorization", token)
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("Content-Length", fmt.Sprintf("%d", len(data)))
	w := &responseRecorder{code: 200, body: &bytes.Buffer{}}
	r.ServeHTTP(w, req)
	return sum
}

type responseRecorder struct {
	code    int
	body    *bytes.Buffer
	headers http.Header
}

func (rr *responseRecorder) Header() http.Header {
	if rr.headers == nil {
		rr.headers = make(http.Header)
	}
	return rr.headers
}
func (rr *responseRecorder) Write(b []byte) (int, error) { return rr.body.Write(b) }
func (rr *responseRecorder) WriteHeader(code int)        { rr.code = code }

// TestPushCreate verifies creating a new skill via the push protocol.
func TestPushCreate(t *testing.T) {
	srv, r := newTestServer(t)
	ns, _ := seedAPIWorld(t, srv.store)
	token := signFor(t, uOwner)

	skillMD := []byte("---\nname: push-skill\ndescription: created via push\n---\n")
	sum := uploadBlob(t, r, token, skillMD)

	body := map[string]any{
		"base_tree_hash": nil,
		"files": []map[string]any{
			{"path": "SKILL.md", "sha256": sum, "size": len(skillMD)},
		},
		"message":        "initial",
		"description":    "created via push",
		"classification": "L1",
		"tags":           "test",
	}
	w := do(t, r, http.MethodPost, "/api/v1/skills/"+ns+"/push-skill/push", token, body)
	if w.Code != http.StatusOK {
		t.Fatalf("push create: got %d, body: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	decode(t, w, &resp)
	if resp["tree_hash"] == "" || resp["tree_hash"] == nil {
		t.Fatalf("expected tree_hash in response, got %v", resp)
	}
	if resp["merged"] != false {
		t.Errorf("expected merged=false for fresh create")
	}
}

// TestPushCreateDuplicate verifies that pushing to an already-existing skill
// with base_tree_hash=null returns 409.
func TestPushCreateDuplicate(t *testing.T) {
	srv, r := newTestServer(t)
	ns, name := seedAPIWorld(t, srv.store)
	token := signFor(t, uOwner)

	skillMD := []byte("---\nname: dup\ndescription: dup\n---\n")
	sum := uploadBlob(t, r, token, skillMD)

	body := map[string]any{
		"base_tree_hash": nil,
		"files":          []map[string]any{{"path": "SKILL.md", "sha256": sum, "size": len(skillMD)}},
		"description":    "dup",
	}
	// name already exists (seeded by seedAPIWorld)
	w := do(t, r, http.MethodPost, "/api/v1/skills/"+ns+"/"+name+"/push", token, body)
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 for duplicate create, got %d", w.Code)
	}
}

// TestPushFastForward verifies a clean fast-forward push.
func TestPushFastForward(t *testing.T) {
	srv, r := newTestServer(t)
	ns, _ := seedAPIWorld(t, srv.store)
	token := signFor(t, uOwner)

	// Create skill via push
	skillMD := []byte("---\nname: ff-skill\ndescription: fast forward test\n---\n")
	sum1 := uploadBlob(t, r, token, skillMD)
	createBody := map[string]any{
		"base_tree_hash": nil,
		"files":          []map[string]any{{"path": "SKILL.md", "sha256": sum1, "size": len(skillMD)}},
		"description":    "fast forward test",
	}
	w := do(t, r, http.MethodPost, "/api/v1/skills/"+ns+"/ff-skill/push", token, createBody)
	if w.Code != http.StatusOK {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	var createResp map[string]any
	decode(t, w, &createResp)
	treeHash := createResp["tree_hash"].(string)

	// Fast-forward push: update SKILL.md
	updated := []byte("---\nname: ff-skill\ndescription: updated\n---\n")
	sum2 := uploadBlob(t, r, token, updated)
	updateBody := map[string]any{
		"base_tree_hash": treeHash,
		"files":          []map[string]any{{"path": "SKILL.md", "sha256": sum2, "size": len(updated)}},
		"message":        "update description",
	}
	w = do(t, r, http.MethodPost, "/api/v1/skills/"+ns+"/ff-skill/push", token, updateBody)
	if w.Code != http.StatusOK {
		t.Fatalf("fast-forward push: %d %s", w.Code, w.Body.String())
	}
	var updateResp map[string]any
	decode(t, w, &updateResp)
	if updateResp["merged"] != false {
		t.Errorf("expected merged=false for fast-forward, got %v", updateResp["merged"])
	}
	if updateResp["tree_hash"] == treeHash {
		t.Errorf("tree_hash should change after update")
	}
}

// TestPushConflict verifies that two pushes from the same base diverge and
// the second one is either merged or returns 409.
func TestPushConflict(t *testing.T) {
	srv, r := newTestServer(t)
	ns, _ := seedAPIWorld(t, srv.store)
	token := signFor(t, uOwner)

	// Create skill
	skillMD := []byte("---\nname: conflict-skill\ndescription: conflict test\n---\n")
	s1 := uploadBlob(t, r, token, skillMD)
	w := do(t, r, http.MethodPost, "/api/v1/skills/"+ns+"/conflict-skill/push", token, map[string]any{
		"base_tree_hash": nil,
		"files":          []map[string]any{{"path": "SKILL.md", "sha256": s1, "size": len(skillMD)}},
		"description":    "conflict test",
	})
	if w.Code != http.StatusOK {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	var cr map[string]any
	decode(t, w, &cr)
	base := cr["tree_hash"].(string)

	// Push A: adds a binary file
	binA := []byte{0x7f, 0x45, 0x4c, 0x46, 0x01} // fake ELF
	sA := uploadBlob(t, r, token, binA)
	wA := do(t, r, http.MethodPost, "/api/v1/skills/"+ns+"/conflict-skill/push", token, map[string]any{
		"base_tree_hash": base,
		"files": []map[string]any{
			{"path": "SKILL.md", "sha256": s1, "size": len(skillMD)},
			{"path": "bin/tool", "sha256": sA, "size": len(binA), "executable": true},
		},
	})
	if wA.Code != http.StatusOK {
		t.Fatalf("push A: %d %s", wA.Code, wA.Body.String())
	}
	var rA map[string]any
	decode(t, wA, &rA)
	afterA := rA["tree_hash"].(string)

	// Push B from same base: adds a different binary at the same path → conflict
	binB := []byte{0x7f, 0x45, 0x4c, 0x46, 0x02}
	sB := uploadBlob(t, r, token, binB)
	wB := do(t, r, http.MethodPost, "/api/v1/skills/"+ns+"/conflict-skill/push", token, map[string]any{
		"base_tree_hash": base, // still the original base → diverged from afterA
		"files": []map[string]any{
			{"path": "SKILL.md", "sha256": s1, "size": len(skillMD)},
			{"path": "bin/tool", "sha256": sB, "size": len(binB), "executable": true},
		},
	})
	// Both sides added a different bin/tool — this is a conflict.
	if wB.Code != http.StatusConflict {
		t.Fatalf("expected 409 for binary conflict, got %d %s", wB.Code, wB.Body.String())
	}
	_ = afterA

	var conflictResp map[string]any
	decode(t, wB, &conflictResp)
	conflicts, _ := conflictResp["conflicts"].([]any)
	if len(conflicts) == 0 {
		t.Errorf("expected conflict details in response")
	}
}

// TestPushUnderReview verifies that pushing to a skill in review state is blocked.
func TestPushUnderReview(t *testing.T) {
	srv, r := newTestServer(t)
	ns, name := seedAPIWorld(t, srv.store)
	token := signFor(t, uOwner)

	// Put the seeded skill into review state directly
	if _, err := srv.store.DB.Exec(
		`UPDATE skills SET status='review' WHERE ns=? AND name=?`, ns, name,
	); err != nil {
		t.Fatalf("force review state: %v", err)
	}

	skillMD := []byte("---\nname: test\ndescription: test\n---\n")
	sum := uploadBlob(t, r, token, skillMD)
	w := do(t, r, http.MethodPost, "/api/v1/skills/"+ns+"/"+name+"/push", token, map[string]any{
		"base_tree_hash": strPtr("somehash"),
		"files":          []map[string]any{{"path": "SKILL.md", "sha256": sum, "size": len(skillMD)}},
	})
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 under review, got %d", w.Code)
	}
}

// TestPushBlobNotUploaded verifies that push fails when a referenced blob
// was never uploaded.
func TestPushBlobNotUploaded(t *testing.T) {
	srv, r := newTestServer(t)
	ns, _ := seedAPIWorld(t, srv.store)
	token := signFor(t, uOwner)

	fakeSum := "a" + fmt.Sprintf("%063d", 0) // valid-length but non-existent sha256
	w := do(t, r, http.MethodPost, "/api/v1/skills/"+ns+"/missing-blob/push", token, map[string]any{
		"base_tree_hash": nil,
		"files":          []map[string]any{{"path": "SKILL.md", "sha256": fakeSum, "size": 10}},
		"description":    "missing blob",
	})
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for missing blob, got %d %s", w.Code, w.Body.String())
	}
}

// TestBlobsExists verifies the batch exists check.
func TestBlobsExists(t *testing.T) {
	srv, r := newTestServer(t)
	_, _ = seedAPIWorld(t, srv.store)
	token := signFor(t, uOwner)

	data := []byte("hello world")
	sum := sha256Of(data)

	// Before upload: should be missing
	w := do(t, r, http.MethodPost, "/api/v1/blobs/exists", token, map[string]any{
		"sha256s": []string{sum},
	})
	if w.Code != http.StatusOK {
		t.Fatalf("exists check: %d", w.Code)
	}
	var resp map[string]any
	decode(t, w, &resp)
	missing, _ := resp["missing"].([]any)
	if len(missing) != 1 {
		t.Errorf("expected 1 missing, got %v", missing)
	}

	// Upload
	uploadBlob(t, r, token, data)

	// After upload: should not be missing
	w = do(t, r, http.MethodPost, "/api/v1/blobs/exists", token, map[string]any{
		"sha256s": []string{sum},
	})
	decode(t, w, &resp)
	missing, _ = resp["missing"].([]any)
	if len(missing) != 0 {
		t.Errorf("expected 0 missing after upload, got %v", missing)
	}
}

// TestGetDraftTree verifies the draft-tree endpoint returns the current hash.
func TestGetDraftTree(t *testing.T) {
	srv, r := newTestServer(t)
	ns, _ := seedAPIWorld(t, srv.store)
	token := signFor(t, uOwner)

	// Create skill via push
	skillMD := []byte("---\nname: tree-skill\ndescription: tree test\n---\n")
	sum := uploadBlob(t, r, token, skillMD)
	w := do(t, r, http.MethodPost, "/api/v1/skills/"+ns+"/tree-skill/push", token, map[string]any{
		"base_tree_hash": nil,
		"files":          []map[string]any{{"path": "SKILL.md", "sha256": sum, "size": len(skillMD)}},
		"description":    "tree test",
	})
	if w.Code != http.StatusOK {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	var cr map[string]any
	decode(t, w, &cr)
	expectedHash := cr["tree_hash"].(string)

	// Fetch draft-tree
	w = do(t, r, http.MethodGet, "/api/v1/skills/"+ns+"/tree-skill/draft-tree", token, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("draft-tree: %d %s", w.Code, w.Body.String())
	}
	var tr map[string]any
	decode(t, w, &tr)
	if tr["draft_tree_hash"] != expectedHash {
		t.Errorf("draft_tree_hash: got %v, want %v", tr["draft_tree_hash"], expectedHash)
	}
}

// TestPushMemberAllowed verifies that a plain namespace member can push.
func TestPushMemberAllowed(t *testing.T) {
	srv, r := newTestServer(t)
	ns, _ := seedAPIWorld(t, srv.store)

	// Add uOutsider as a plain member of the namespace
	if err := srv.store.AddNamespaceMember(ns, uOutsider, "member", uOwner); err != nil {
		t.Fatalf("add member: %v", err)
	}
	token := signFor(t, uOutsider)

	skillMD := []byte("---\nname: member-skill\ndescription: pushed by member\n---\n")
	sum := uploadBlob(t, r, token, skillMD)
	w := do(t, r, http.MethodPost, "/api/v1/skills/"+ns+"/member-skill/push", token, map[string]any{
		"base_tree_hash": nil,
		"files":          []map[string]any{{"path": "SKILL.md", "sha256": sum, "size": len(skillMD)}},
		"description":    "pushed by member",
	})
	if w.Code != http.StatusOK {
		t.Fatalf("member push: %d %s", w.Code, w.Body.String())
	}
}

// TestPushNonMemberForbidden verifies that a user with no namespace role is rejected.
func TestPushNonMemberForbidden(t *testing.T) {
	srv, r := newTestServer(t)
	ns, _ := seedAPIWorld(t, srv.store)
	// uOutsider is NOT added as a member here
	token := signFor(t, uOutsider)

	skillMD := []byte("---\nname: forbidden-skill\ndescription: should fail\n---\n")
	sum := uploadBlob(t, r, token, skillMD)
	w := do(t, r, http.MethodPost, "/api/v1/skills/"+ns+"/forbidden-skill/push", token, map[string]any{
		"base_tree_hash": nil,
		"files":          []map[string]any{{"path": "SKILL.md", "sha256": sum, "size": len(skillMD)}},
	})
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d %s", w.Code, w.Body.String())
	}
}

// TestChunkedUpload verifies the three-step chunked upload protocol.
func TestChunkedUpload(t *testing.T) {
	srv, r := newTestServer(t)
	_, _ = seedAPIWorld(t, srv.store)
	token := signFor(t, uOwner)

	// Build a "large" payload from two chunks
	chunk0 := bytes.Repeat([]byte("A"), 1024)
	chunk1 := bytes.Repeat([]byte("B"), 1024)
	full := append(append([]byte{}, chunk0...), chunk1...)
	finalSum := sha256Of(full)

	// Step 1: start upload session
	w := do(t, r, http.MethodPost, "/api/v1/blobs/"+finalSum+"/uploads", token, nil)
	if w.Code != http.StatusCreated {
		t.Fatalf("start upload: %d %s", w.Code, w.Body.String())
	}
	var startResp map[string]any
	decode(t, w, &startResp)
	uploadID := startResp["upload_id"].(string)

	// Step 2: upload chunks
	for i, chunk := range [][]byte{chunk0, chunk1} {
		req, _ := http.NewRequest(
			http.MethodPut,
			fmt.Sprintf("/api/v1/blobs/%s/uploads/%s/chunks/%d", finalSum, uploadID, i),
			bytes.NewReader(chunk),
		)
		req.Header.Set("Authorization", token)
		req.Header.Set("Content-Type", "application/octet-stream")
		wc := &responseRecorder{code: 200, body: &bytes.Buffer{}}
		r.ServeHTTP(wc, req)
		if wc.code != http.StatusNoContent {
			t.Fatalf("put chunk %d: %d %s", i, wc.code, wc.body.String())
		}
	}

	// Step 3: complete
	w = do(t, r, http.MethodPost, fmt.Sprintf("/api/v1/blobs/%s/uploads/%s/complete", finalSum, uploadID), token, nil)
	if w.Code != http.StatusCreated {
		t.Fatalf("complete: %d %s", w.Code, w.Body.String())
	}
	var completeResp map[string]any
	decode(t, w, &completeResp)
	if completeResp["sha256"] != finalSum {
		t.Errorf("sha256: got %v, want %v", completeResp["sha256"], finalSum)
	}
	if int(completeResp["size"].(float64)) != len(full) {
		t.Errorf("size: got %v, want %v", completeResp["size"], len(full))
	}

	// Blob should now be reported as present
	w = do(t, r, http.MethodPost, "/api/v1/blobs/exists", token, map[string]any{
		"sha256s": []string{finalSum},
	})
	var existsResp map[string]any
	decode(t, w, &existsResp)
	missing, _ := existsResp["missing"].([]any)
	if len(missing) != 0 {
		t.Errorf("expected blob to exist after complete, missing=%v", missing)
	}
}

// TestTextMergeAutoResolves verifies that two non-overlapping edits to the
// same text file are automatically merged without a 409.
func TestTextMergeAutoResolves(t *testing.T) {
	srv, r := newTestServer(t)
	ns, _ := seedAPIWorld(t, srv.store)
	token := signFor(t, uOwner)

	// Create skill with a two-section SKILL.md.
	original := []byte("# Header\n\nSection A content.\n\nSection B content.\n")
	s0 := uploadBlob(t, r, token, original)
	w := do(t, r, http.MethodPost, "/api/v1/skills/"+ns+"/merge-skill/push", token, map[string]any{
		"base_tree_hash": nil,
		"files":          []map[string]any{{"path": "SKILL.md", "sha256": s0, "size": len(original)}},
		"description":    "merge test",
	})
	if w.Code != http.StatusOK {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	var cr map[string]any
	decode(t, w, &cr)
	base := cr["tree_hash"].(string)

	// Push A: changes only Section A.
	editA := []byte("# Header\n\nSection A EDITED.\n\nSection B content.\n")
	sA := uploadBlob(t, r, token, editA)
	wA := do(t, r, http.MethodPost, "/api/v1/skills/"+ns+"/merge-skill/push", token, map[string]any{
		"base_tree_hash": base,
		"files":          []map[string]any{{"path": "SKILL.md", "sha256": sA, "size": len(editA)}},
	})
	if wA.Code != http.StatusOK {
		t.Fatalf("push A: %d %s", wA.Code, wA.Body.String())
	}

	// Push B from same base: changes only Section B.
	editB := []byte("# Header\n\nSection A content.\n\nSection B EDITED.\n")
	sB := uploadBlob(t, r, token, editB)
	wB := do(t, r, http.MethodPost, "/api/v1/skills/"+ns+"/merge-skill/push", token, map[string]any{
		"base_tree_hash": base, // same base → diverged from A
		"files":          []map[string]any{{"path": "SKILL.md", "sha256": sB, "size": len(editB)}},
	})
	if wB.Code != http.StatusOK {
		t.Fatalf("push B (text merge): %d %s", wB.Code, wB.Body.String())
	}
	var rb map[string]any
	decode(t, wB, &rb)
	if rb["merged"] != true {
		t.Errorf("expected merged=true for auto-resolved text edit, got %v", rb["merged"])
	}
}

// TestTextMergeConflictReturns409 verifies that overlapping edits to the same
// line of a text file produce a 409 conflict.
func TestTextMergeConflictReturns409(t *testing.T) {
	srv, r := newTestServer(t)
	ns, _ := seedAPIWorld(t, srv.store)
	token := signFor(t, uOwner)

	original := []byte("line one\nline two\nline three\n")
	s0 := uploadBlob(t, r, token, original)
	w := do(t, r, http.MethodPost, "/api/v1/skills/"+ns+"/conflict-text/push", token, map[string]any{
		"base_tree_hash": nil,
		"files":          []map[string]any{{"path": "SKILL.md", "sha256": s0, "size": len(original)}},
		"description":    "conflict text test",
	})
	if w.Code != http.StatusOK {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	var cr map[string]any
	decode(t, w, &cr)
	base := cr["tree_hash"].(string)

	// Push A: changes line two one way.
	editA := []byte("line one\nLINE TWO FROM A\nline three\n")
	sA := uploadBlob(t, r, token, editA)
	wA := do(t, r, http.MethodPost, "/api/v1/skills/"+ns+"/conflict-text/push", token, map[string]any{
		"base_tree_hash": base,
		"files":          []map[string]any{{"path": "SKILL.md", "sha256": sA, "size": len(editA)}},
	})
	if wA.Code != http.StatusOK {
		t.Fatalf("push A: %d %s", wA.Code, wA.Body.String())
	}

	// Push B from same base: changes line two a different way.
	editB := []byte("line one\nLINE TWO FROM B\nline three\n")
	sB := uploadBlob(t, r, token, editB)
	wB := do(t, r, http.MethodPost, "/api/v1/skills/"+ns+"/conflict-text/push", token, map[string]any{
		"base_tree_hash": base,
		"files":          []map[string]any{{"path": "SKILL.md", "sha256": sB, "size": len(editB)}},
	})
	if wB.Code != http.StatusConflict {
		t.Fatalf("expected 409 for overlapping text edit, got %d %s", wB.Code, wB.Body.String())
	}
}

// TestGCBlobsDeletesUnreferenced verifies that GC removes blobs not referenced
// by any skill file or tree.
func TestGCBlobsDeletesUnreferenced(t *testing.T) {
	srv, r := newTestServer(t)
	_, _ = seedAPIWorld(t, srv.store)
	token := signFor(t, uOwner)

	// Upload a blob but never reference it in a skill.
	orphan := []byte("orphaned blob content - never used in a push")
	orphanSum := uploadBlob(t, r, token, orphan)

	// Verify it exists before GC.
	wBefore := do(t, r, http.MethodPost, "/api/v1/blobs/exists", token, map[string]any{
		"sha256s": []string{orphanSum},
	})
	var beforeResp map[string]any
	decode(t, wBefore, &beforeResp)
	if missing, _ := beforeResp["missing"].([]any); len(missing) != 0 {
		t.Fatalf("blob should exist before GC, missing=%v", missing)
	}

	// Run GC as admin.
	adminToken := signFor(t, uAdmin)
	wGC := do(t, r, http.MethodPost, "/api/v1/admin/blobs/gc", adminToken, nil)
	if wGC.Code != http.StatusOK {
		t.Fatalf("gc: %d %s", wGC.Code, wGC.Body.String())
	}
	var gcResp map[string]any
	decode(t, wGC, &gcResp)
	deleted := int(gcResp["deleted"].(float64))
	if deleted == 0 {
		t.Errorf("expected at least 1 blob deleted by GC, got 0")
	}

	// Verify the orphan blob is gone from blobstore.
	wAfter := do(t, r, http.MethodPost, "/api/v1/blobs/exists", token, map[string]any{
		"sha256s": []string{orphanSum},
	})
	var afterResp map[string]any
	decode(t, wAfter, &afterResp)
	if missing, _ := afterResp["missing"].([]any); len(missing) == 0 {
		t.Errorf("orphan blob should be missing after GC")
	}
}

// strPtr is a helper for constructing *string literals inline.
func strPtr(s string) *string { return &s }

// Compile-time check that json.Marshal can handle the response types we decode.
var _ = json.Marshal
