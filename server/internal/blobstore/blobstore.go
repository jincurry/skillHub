package blobstore

import (
	"context"
	"io"
	"time"
)

// BlobStore is the content-addressed storage interface.
// The database (blob_objects table) holds metadata; implementations own raw
// byte I/O only. Switching from local disk to S3/OSS requires implementing
// this interface — no other code changes.
type BlobStore interface {
	// Exists reports whether a blob addressed by sha256 is present.
	Exists(ctx context.Context, sha256 string) (bool, error)

	// Put stores content. sha256 is pre-computed by the caller and verified
	// inside the implementation. Idempotent: same sha256 is a no-op.
	Put(ctx context.Context, sha256 string, r io.Reader, size int64) error

	// Get retrieves the blob. Caller must close the returned ReadCloser.
	Get(ctx context.Context, sha256 string) (io.ReadCloser, int64, error)

	// Delete removes the blob from storage. Called by GC when ref_count
	// reaches zero.
	Delete(ctx context.Context, sha256 string) error

	// PresignedGetURL returns a time-limited direct-download URL.
	// Returns ("", nil) for implementations that stream through the API
	// server (e.g. local disk). S3/OSS implementations return a presigned
	// URL so the API layer can issue a 302 redirect, bypassing the server
	// for large downloads.
	PresignedGetURL(ctx context.Context, sha256 string, ttl time.Duration) (string, error)
}
