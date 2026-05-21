package api

import (
	"bytes"
	cryptosha256 "crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jincurry/skillhub/server/internal/audit"
	"github.com/jincurry/skillhub/server/internal/store"
)

const (
	// maxSmallBlobSize is the upper bound for a single-PUT blob upload.
	// Files at or above this size must use the chunked upload protocol.
	maxSmallBlobSize = 4 * 1024 * 1024 // 4 MB

	// maxBlobTotalSize caps the assembled size of a chunked blob.
	maxBlobTotalSize = 500 * 1024 * 1024 // 500 MB
)

// POST /api/v1/blobs/exists
// Batch-checks which sha256s the server does not have. Clients call this
// before uploading to skip blobs the server already stores (dedup).
func (s *Server) blobsExists(c *gin.Context) {
	var req struct {
		SHA256s []string `json:"sha256s" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(req.SHA256s) > 500 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "max 500 entries per request"})
		return
	}
	missing := make([]string, 0)
	for _, sum := range req.SHA256s {
		if len(sum) != 64 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid sha256: " + sum})
			return
		}
		ok, err := s.blobs.Exists(c.Request.Context(), sum)
		if err != nil {
			serverError(c, err)
			return
		}
		if !ok {
			missing = append(missing, sum)
		}
	}
	c.JSON(http.StatusOK, gin.H{"missing": missing})
}

// PUT /api/v1/blobs/:sha256
// Uploads a single small blob (< 4 MB). Idempotent: if the server already
// has this sha256 it drains the body and returns 200.
func (s *Server) putBlob(c *gin.Context) {
	sum := c.Param("sha256")
	if len(sum) != 64 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid sha256"})
		return
	}
	size, _ := strconv.ParseInt(c.GetHeader("Content-Length"), 10, 64)
	if size > maxSmallBlobSize {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "file >= 4 MB: use chunked upload"})
		return
	}

	if ok, _ := s.blobs.Exists(c.Request.Context(), sum); ok {
		io.Copy(io.Discard, c.Request.Body) // drain body so the connection is reusable
		c.Status(http.StatusOK)
		return
	}

	if err := s.blobs.Put(c.Request.Context(), sum, c.Request.Body, size); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}
	if err := s.store.UpsertBlobObject(sum, size, false); err != nil {
		serverError(c, err)
		return
	}
	c.Status(http.StatusCreated)
}

// POST /api/v1/blobs/:sha256/uploads
// Starts a chunked upload session for a large file. Returns an upload_id to
// use in subsequent chunk PUT requests. The session expires after 24 h.
func (s *Server) startChunkedUpload(c *gin.Context) {
	sum := c.Param("sha256")
	if len(sum) != 64 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid sha256"})
		return
	}
	uploadID, err := s.store.CreateBlobUpload(sum, 24*time.Hour)
	if err != nil {
		serverError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"upload_id": uploadID})
}

// PUT /api/v1/blobs/:sha256/uploads/:upload_id/chunks/:index
// Uploads one chunk (max 4 MB). Chunks are stored as individual blobs and
// assembled when the complete endpoint is called.
func (s *Server) putChunk(c *gin.Context) {
	uploadID := c.Param("upload_id")
	idx, err := strconv.Atoi(c.Param("index"))
	if err != nil || idx < 0 || idx > 9999 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid chunk index"})
		return
	}

	// Read into memory — chunks are bounded at 4 MB.
	data, err := io.ReadAll(io.LimitReader(c.Request.Body, maxSmallBlobSize+1))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if int64(len(data)) > maxSmallBlobSize {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "chunk exceeds 4 MB"})
		return
	}

	chunkSum := sha256Hex(data)
	if ok, _ := s.blobs.Exists(c.Request.Context(), chunkSum); !ok {
		if err := s.blobs.Put(c.Request.Context(), chunkSum, bytes.NewReader(data), int64(len(data))); err != nil {
			serverError(c, err)
			return
		}
		s.store.UpsertBlobObject(chunkSum, int64(len(data)), false)
	}

	if err := s.store.RecordUploadChunk(uploadID, idx, chunkSum); err != nil {
		serverError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// POST /api/v1/blobs/:sha256/uploads/:upload_id/complete
// Assembles all uploaded chunks into the final blob, verifies the sha256,
// writes the result to blob storage, and closes the upload session.
func (s *Server) completeChunkedUpload(c *gin.Context) {
	ctx := c.Request.Context()
	sum := c.Param("sha256")
	uploadID := c.Param("upload_id")

	upload, err := s.store.GetBlobUpload(uploadID)
	if err != nil {
		serverError(c, err)
		return
	}
	if upload == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "upload session not found or expired"})
		return
	}
	if upload.SHA256 != sum {
		c.JSON(http.StatusBadRequest, gin.H{"error": "sha256 mismatch between path and session"})
		return
	}
	if len(upload.Chunks) == 0 {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "no chunks uploaded"})
		return
	}

	sort.Slice(upload.Chunks, func(i, j int) bool {
		return upload.Chunks[i].Index < upload.Chunks[j].Index
	})
	// Validate consecutive indices starting from 0.
	for i, ch := range upload.Chunks {
		if ch.Index != i {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": fmt.Sprintf("missing chunk %d", i)})
			return
		}
	}

	// Open all chunk readers; defer close so we don't leak handles on error.
	readers := make([]io.Reader, len(upload.Chunks))
	closers := make([]io.Closer, 0, len(upload.Chunks))
	var totalSize int64
	for i, ch := range upload.Chunks {
		rc, sz, err := s.blobs.Get(ctx, ch.ChunkSHA256)
		if err != nil {
			serverError(c, err)
			return
		}
		closers = append(closers, rc)
		readers[i] = rc
		totalSize += sz
	}
	defer func() {
		for _, cl := range closers {
			cl.Close()
		}
	}()

	if totalSize > maxBlobTotalSize {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "assembled blob exceeds 500 MB"})
		return
	}

	if ok, _ := s.blobs.Exists(ctx, sum); !ok {
		if err := s.blobs.Put(ctx, sum, io.MultiReader(readers...), totalSize); err != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "assembly failed: " + err.Error()})
			return
		}
	}

	if err := s.store.UpsertBlobObject(sum, totalSize, true); err != nil {
		serverError(c, err)
		return
	}
	s.store.DeleteBlobUpload(uploadID)

	c.JSON(http.StatusCreated, gin.H{"sha256": sum, "size": totalSize})
}

// POST /api/v1/skills/:ns/:name/push
// Two-phase commit entry point. All blobs referenced by the tree must already
// be uploaded before calling this endpoint. The operation runs inside a single
// DB transaction so concurrent pushes are serialised.
func (s *Server) pushSkill(c *gin.Context) {
	ns   := c.Param("ns")
	name := c.Param("name")
	user := s.currentUser(c)

	ok, err := s.canPushSkill(user, ns, name)
	if err != nil {
		serverError(c, err)
		return
	}
	if !ok {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden: not a namespace member"})
		return
	}

	var req struct {
		BaseTreeHash   *string          `json:"base_tree_hash"`
		Files          []store.PushFile `json:"files"`
		Message        string           `json:"message"`
		Description    string           `json:"description"`
		Classification string           `json:"classification"`
		Tags           string           `json:"tags"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Verify every referenced blob is already present before touching the DB.
	for _, f := range req.Files {
		if f.Deleted {
			continue
		}
		if len(f.SHA256) != 64 {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "invalid sha256", "path": f.Path})
			return
		}
		ok, _ := s.blobs.Exists(c.Request.Context(), f.SHA256)
		if !ok {
			c.JSON(http.StatusUnprocessableEntity, gin.H{
				"error":  "blob not uploaded",
				"path":   f.Path,
				"sha256": f.SHA256,
			})
			return
		}
	}

	result, err := s.store.PushSkillTree(store.PushSkillParams{
		NS:             ns,
		Name:           name,
		PushedBy:       user,
		BaseTreeHash:   req.BaseTreeHash,
		Files:          req.Files,
		Message:        req.Message,
		Description:    req.Description,
		Classification: req.Classification,
		Tags:           req.Tags,
	})
	if err != nil {
		switch {
		case errors.Is(err, store.ErrSkillAlreadyExists):
			c.JSON(http.StatusConflict, gin.H{"error": "skill already exists"})
		case errors.Is(err, store.ErrSkillNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "skill not found"})
		case errors.Is(err, store.ErrUnderReview):
			c.JSON(http.StatusConflict, gin.H{"error": "skill is under review, push blocked"})
		default:
			var ce *store.ConflictError
			if errors.As(err, &ce) {
				c.JSON(http.StatusConflict, gin.H{"error": "push conflict", "conflicts": ce.Conflicts})
				return
			}
			serverError(c, err)
		}
		return
	}

	action := "push_update"
	if req.BaseTreeHash == nil {
		action = "push_create"
	}
	audit.Log(s.store.DB, user, action, ns+"/"+name, result.TreeHash, c.ClientIP())

	c.JSON(http.StatusOK, gin.H{
		"tree_hash": result.TreeHash,
		"merged":    result.Merged,
		"summary":   result.MergeSummary,
	})
}

// GET /api/v1/skills/:ns/:name/draft-tree
// Returns the current draft_tree_hash so the client can set base_tree_hash
// before constructing a push request.
func (s *Server) getDraftTree(c *gin.Context) {
	ns, name := c.Param("ns"), c.Param("name")
	h, err := s.store.GetDraftTreeHash(ns, name)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"draft_tree_hash": h})
}

// canPushSkill permits any namespace member (owner, maintainer, or member) to
// push. This is broader than canEditSkill which excludes plain members.
func (s *Server) canPushSkill(user, ns, name string) (bool, error) {
	k, err := s.store.GetSkill(ns, name)
	if err != nil {
		return false, err
	}
	if k != nil && k.Author == user {
		return true, nil
	}
	role, err := s.store.UserRoleInNamespace(ns, user)
	if err != nil {
		return false, err
	}
	return role != "", nil // any namespace role grants push access
}

// sha256Hex returns the hex-encoded SHA-256 digest of b.
func sha256Hex(b []byte) string {
	h := cryptosha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
