package store

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// BlobUpload holds an in-progress chunked upload session retrieved from DB.
type BlobUpload struct {
	UploadID  string
	SHA256    string
	ExpiresAt time.Time
	Chunks    []ChunkRecord
}

// ChunkRecord is one chunk within a BlobUpload.
type ChunkRecord struct {
	Index       int
	ChunkSHA256 string
}

// UpsertBlobObject inserts a blob metadata row or increments ref_count if it
// already exists. isChunked signals whether the content was assembled from
// multiple chunk blobs.
func (s *Store) UpsertBlobObject(sha256 string, size int64, isChunked bool) error {
	chunked := 0
	if isChunked {
		chunked = 1
	}
	_, err := s.DB.Exec(`
		INSERT INTO blob_objects(sha256, size, is_chunked, ref_count)
		VALUES(?, ?, ?, 1)
		ON CONFLICT(sha256) DO UPDATE SET ref_count = ref_count + 1`,
		sha256, size, chunked,
	)
	return err
}

// CreateBlobUpload creates an upload session for a chunked upload and returns
// the upload_id. The session expires after ttl.
func (s *Store) CreateBlobUpload(sha256 string, ttl time.Duration) (string, error) {
	uploadID := uuid.New().String()
	expiresAt := time.Now().Add(ttl).UTC().Format("2006-01-02 15:04:05")
	_, err := s.DB.Exec(`
		INSERT INTO blob_uploads(upload_id, sha256, expires_at)
		VALUES(?, ?, ?)`,
		uploadID, sha256, expiresAt,
	)
	return uploadID, err
}

// RecordUploadChunk records that chunk index has been stored as chunkSHA256.
func (s *Store) RecordUploadChunk(uploadID string, index int, chunkSHA256 string) error {
	_, err := s.DB.Exec(`
		INSERT OR REPLACE INTO blob_upload_chunks(upload_id, chunk_index, chunk_sha256)
		VALUES(?, ?, ?)`,
		uploadID, index, chunkSHA256,
	)
	return err
}

// GetBlobUpload returns the upload session and its chunks, or nil if the
// session does not exist or has expired.
func (s *Store) GetBlobUpload(uploadID string) (*BlobUpload, error) {
	var u BlobUpload
	var expiresStr string
	err := s.DB.QueryRow(`
		SELECT upload_id, sha256, expires_at FROM blob_uploads
		WHERE upload_id=? AND expires_at > CURRENT_TIMESTAMP`,
		uploadID,
	).Scan(&u.UploadID, &u.SHA256, &expiresStr)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	rows, err := s.DB.Query(`
		SELECT chunk_index, chunk_sha256 FROM blob_upload_chunks
		WHERE upload_id=? ORDER BY chunk_index`,
		uploadID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var c ChunkRecord
		if err := rows.Scan(&c.Index, &c.ChunkSHA256); err != nil {
			return nil, err
		}
		u.Chunks = append(u.Chunks, c)
	}
	return &u, rows.Err()
}

// DeleteBlobUpload removes the upload session and its chunk records.
func (s *Store) DeleteBlobUpload(uploadID string) error {
	_, err := s.DB.Exec(`DELETE FROM blob_uploads WHERE upload_id=?`, uploadID)
	return err
}

// GetDraftTreeHash returns the current draft_tree_hash for a skill, used by
// callers that need the base before constructing a push request.
func (s *Store) GetDraftTreeHash(ns, name string) (string, error) {
	var h string
	err := s.DB.QueryRow(
		`SELECT COALESCE(draft_tree_hash,'') FROM skills WHERE ns=? AND name=?`,
		ns, name,
	).Scan(&h)
	if err == sql.ErrNoRows {
		return "", fmt.Errorf("skill not found")
	}
	return h, err
}
