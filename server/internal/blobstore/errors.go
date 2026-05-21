package blobstore

import "errors"

var (
	// ErrHashMismatch is returned by Put when the data's actual sha256 does
	// not match the sha256 the caller provided.
	ErrHashMismatch = errors.New("blobstore: sha256 mismatch")

	// ErrNotFound is returned by Get when no blob with that sha256 exists.
	ErrNotFound = errors.New("blobstore: blob not found")
)
