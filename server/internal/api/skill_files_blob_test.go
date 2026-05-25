package api

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
)

// TestPutFileBlobRoundTrip covers the regression where the editor's "Upload
// File" button JSON-encoded large file bodies and OOM'd the browser. The fix
// makes /api/v1/skills/:ns/:name/files/*path accept a {blobHash, size} body
// pointing at a blob already uploaded through /api/v1/blobs/*. This test
// drives the end-to-end happy path:
//
//  1. PUT the bytes via /blobs/:sha256.
//  2. PUT a file pointer via /files/*path with the blobHash form.
//  3. GET the file — server streams from blob storage with the original bytes.
//  4. List files — blobHash flows back to the client.
//  5. Bundle download — tar.gz contains the blob payload byte-for-byte.
func TestPutFileBlobRoundTrip(t *testing.T) {
	srv, r := newTestServer(t)
	ns, name := seedAPIWorld(t, srv.store)
	token := signFor(t, uOwner)

	// 1. Upload a blob (a fake-binary buffer with a NUL byte so we know the
	// inline JSON path can't have round-tripped it).
	payload := append([]byte{0x00, 0xff, 0x7f}, bytes.Repeat([]byte("BLOB"), 4096)...) // ~16 KB
	sum := uploadBlob(t, r, token, payload)

	// 2. PUT skill_files row with the blob form.
	w := do(t, r, http.MethodPut, "/api/v1/skills/"+ns+"/"+name+"/files/big.bin", token, map[string]any{
		"blobHash": sum,
		"size":     len(payload),
	})
	if w.Code != http.StatusOK {
		t.Fatalf("put file blob: %d %s", w.Code, w.Body.String())
	}
	var fileResp map[string]any
	decode(t, w, &fileResp)
	if fileResp["blobHash"] != sum {
		t.Errorf("blobHash: got %v, want %v", fileResp["blobHash"], sum)
	}
	if int(fileResp["size"].(float64)) != len(payload) {
		t.Errorf("size: got %v, want %v", fileResp["size"], len(payload))
	}

	// 3. GET the file — should stream the raw bytes (Content-Type
	// application/octet-stream, not JSON).
	w = do(t, r, http.MethodGet, "/api/v1/skills/"+ns+"/"+name+"/files/big.bin", token, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("get file blob: %d %s", w.Code, w.Body.String())
	}
	if got := w.Body.Bytes(); !bytes.Equal(got, payload) {
		t.Fatalf("blob round-trip mismatch: got %d bytes, want %d", len(got), len(payload))
	}

	// 4. List files — blobHash and size should be visible.
	w = do(t, r, http.MethodGet, "/api/v1/skills/"+ns+"/"+name+"/files", token, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("list files: %d %s", w.Code, w.Body.String())
	}
	var listResp []map[string]any
	decode(t, w, &listResp)
	var found bool
	for _, f := range listResp {
		if f["path"] == "big.bin" {
			found = true
			if f["blobHash"] != sum {
				t.Errorf("listed blobHash mismatch: got %v", f["blobHash"])
			}
			break
		}
	}
	if !found {
		t.Fatal("big.bin not present in file listing")
	}

	// 5. Bundle download — tar.gz must contain big.bin with the full payload.
	skill, err := srv.store.GetSkill(ns, name)
	if err != nil || skill == nil {
		t.Fatalf("get skill: %v", err)
	}
	w = do(t, r, http.MethodGet,
		fmt.Sprintf("/api/v1/skills/%s/%s/bundle?version=%s", ns, name, skill.Version),
		token, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("bundle: %d %s", w.Code, w.Body.String())
	}
	gz, err := gzip.NewReader(w.Body)
	if err != nil {
		t.Fatalf("gzip reader: %v", err)
	}
	tr := tar.NewReader(gz)
	var bundlePayload []byte
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("tar next: %v", err)
		}
		if !strings.HasSuffix(hdr.Name, "/big.bin") {
			continue
		}
		buf, err := io.ReadAll(tr)
		if err != nil {
			t.Fatalf("read tar entry: %v", err)
		}
		bundlePayload = buf
	}
	if !bytes.Equal(bundlePayload, payload) {
		t.Errorf("bundle big.bin mismatch: got %d bytes, want %d", len(bundlePayload), len(payload))
	}
}

// TestPutFileBlobRejectsMissingBlob asserts the server refuses a file pointer
// at a blob it has never seen — that's a client bug (forgot to upload first)
// and the resulting orphan row would surface as a 500 on the next read.
func TestPutFileBlobRejectsMissingBlob(t *testing.T) {
	srv, r := newTestServer(t)
	ns, name := seedAPIWorld(t, srv.store)
	token := signFor(t, uOwner)

	// Valid-length but unused sha256.
	fakeSum := strings.Repeat("a", 64)
	w := do(t, r, http.MethodPut, "/api/v1/skills/"+ns+"/"+name+"/files/missing.bin", token, map[string]any{
		"blobHash": fakeSum,
		"size":     42,
	})
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for missing blob, got %d %s", w.Code, w.Body.String())
	}
	_ = srv
}

// TestPutFileRejectsBothContentAndBlob asserts the API refuses an ambiguous
// request body. Older clients send {content}, the new path sends {blobHash}.
// Sending both is a programming error that should surface explicitly rather
// than picking one branch silently.
func TestPutFileRejectsBothContentAndBlob(t *testing.T) {
	srv, r := newTestServer(t)
	ns, name := seedAPIWorld(t, srv.store)
	token := signFor(t, uOwner)

	payload := []byte("hello")
	sum := uploadBlob(t, r, token, payload)
	w := do(t, r, http.MethodPut, "/api/v1/skills/"+ns+"/"+name+"/files/conflicted.txt", token, map[string]any{
		"content":  "inline body",
		"blobHash": sum,
		"size":     len(payload),
	})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for ambiguous body, got %d %s", w.Code, w.Body.String())
	}
	_ = srv
}

// TestPutFileBlobOverwritesInline asserts that flipping a previously inline
// file to blob storage clears the content column — otherwise a stale text
// body would be served alongside the new blob.
func TestPutFileBlobOverwritesInline(t *testing.T) {
	srv, r := newTestServer(t)
	ns, name := seedAPIWorld(t, srv.store)
	token := signFor(t, uOwner)

	// Step 1: write inline body.
	w := do(t, r, http.MethodPut, "/api/v1/skills/"+ns+"/"+name+"/files/swap.txt", token, map[string]any{
		"content": "inline-version",
	})
	if w.Code != http.StatusOK {
		t.Fatalf("put inline: %d %s", w.Code, w.Body.String())
	}

	// Step 2: replace via blob form.
	binary := bytes.Repeat([]byte{0xfe}, 8192)
	sum := uploadBlob(t, r, token, binary)
	w = do(t, r, http.MethodPut, "/api/v1/skills/"+ns+"/"+name+"/files/swap.txt", token, map[string]any{
		"blobHash": sum,
		"size":     len(binary),
	})
	if w.Code != http.StatusOK {
		t.Fatalf("put blob: %d %s", w.Code, w.Body.String())
	}

	// Step 3: GET should stream the binary now, not the inline text.
	w = do(t, r, http.MethodGet, "/api/v1/skills/"+ns+"/"+name+"/files/swap.txt", token, nil)
	if !bytes.Equal(w.Body.Bytes(), binary) {
		// Sanity check for the wrong-branch failure mode: did we get the
		// inline text instead?
		var inlineEcho map[string]any
		if json.Unmarshal(w.Body.Bytes(), &inlineEcho) == nil && inlineEcho["content"] == "inline-version" {
			t.Fatalf("blob put didn't clear inline content; GET returned the old text")
		}
		t.Fatalf("blob round-trip mismatch: got %d bytes, want %d", w.Body.Len(), len(binary))
	}

	// Step 4: confirm in store directly that content is empty and blob_hash matches.
	var content, hash string
	if err := srv.store.DB.QueryRow(
		`SELECT content, blob_hash FROM skill_files WHERE ns=? AND skill_name=? AND path=?`,
		ns, name, "swap.txt",
	).Scan(&content, &hash); err != nil {
		t.Fatalf("query swap.txt row: %v", err)
	}
	if content != "" {
		t.Errorf("expected content cleared, got %q", content)
	}
	if hash != sum {
		t.Errorf("expected blob_hash %s, got %s", sum, hash)
	}
}
