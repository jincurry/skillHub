package store

import (
	"context"
	"encoding/json"
)

// blobDeleter is the minimal BlobStore surface needed for GC deletion.
type blobDeleter interface {
	Delete(ctx context.Context, sha256 string) error
}

// GCBlobs performs a mark-and-sweep garbage collection over blob_objects.
// It collects all sha256 hashes referenced by live skill files, tree manifests,
// chunk records, and active upload sessions, then deletes every blob_objects
// row (and its backing file) that is not in the live set.
// Returns the count of blobs deleted.
func (s *Store) GCBlobs(ctx context.Context, d blobDeleter) (int, error) {
	live := make(map[string]struct{})

	// 1. Blobs directly referenced by current skill_files rows.
	rows, err := s.DB.QueryContext(ctx,
		`SELECT DISTINCT blob_hash FROM skill_files WHERE blob_hash IS NOT NULL AND blob_hash != ''`)
	if err != nil {
		return 0, err
	}
	for rows.Next() {
		var h string
		if err := rows.Scan(&h); err != nil {
			rows.Close()
			return 0, err
		}
		live[h] = struct{}{}
	}
	rows.Close()

	// 2. Blobs referenced by any skill_trees manifest (all historical tree snapshots).
	rows, err = s.DB.QueryContext(ctx, `SELECT manifest FROM skill_trees`)
	if err != nil {
		return 0, err
	}
	for rows.Next() {
		var manifest string
		if err := rows.Scan(&manifest); err != nil {
			rows.Close()
			return 0, err
		}
		var files []struct {
			SHA256 string `json:"sha256"`
		}
		if json.Unmarshal([]byte(manifest), &files) == nil {
			for _, f := range files {
				if f.SHA256 != "" {
					live[f.SHA256] = struct{}{}
				}
			}
		}
	}
	rows.Close()

	// 3. Chunk blobs that belong to an assembled blob.
	rows, err = s.DB.QueryContext(ctx, `SELECT DISTINCT chunk_sha256 FROM blob_chunks`)
	if err != nil {
		return 0, err
	}
	for rows.Next() {
		var h string
		if err := rows.Scan(&h); err != nil {
			rows.Close()
			return 0, err
		}
		live[h] = struct{}{}
	}
	rows.Close()

	// 4. Chunk blobs belonging to in-progress (non-expired) upload sessions.
	rows, err = s.DB.QueryContext(ctx, `
		SELECT buc.chunk_sha256
		FROM blob_upload_chunks buc
		JOIN blob_uploads bu ON buc.upload_id = bu.upload_id
		WHERE bu.expires_at > CURRENT_TIMESTAMP`)
	if err != nil {
		return 0, err
	}
	for rows.Next() {
		var h string
		if err := rows.Scan(&h); err != nil {
			rows.Close()
			return 0, err
		}
		live[h] = struct{}{}
	}
	rows.Close()

	// Collect all blob_objects sha256s, identify dead ones.
	rows, err = s.DB.QueryContext(ctx, `SELECT sha256 FROM blob_objects`)
	if err != nil {
		return 0, err
	}
	var dead []string
	for rows.Next() {
		var h string
		if err := rows.Scan(&h); err != nil {
			rows.Close()
			return 0, err
		}
		if _, ok := live[h]; !ok {
			dead = append(dead, h)
		}
	}
	rows.Close()

	// Sweep: delete from blobstore then from blob_objects.
	deleted := 0
	for _, h := range dead {
		if err := d.Delete(ctx, h); err != nil {
			// Partial GC is better than aborting: log via caller if needed.
			continue
		}
		s.DB.ExecContext(ctx, `DELETE FROM blob_objects WHERE sha256=?`, h)
		deleted++
	}
	return deleted, nil
}
