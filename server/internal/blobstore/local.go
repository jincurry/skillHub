package blobstore

import (
	"context"
	cryptosha256 "crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"time"
)

// LocalBlobStore stores blobs on the local filesystem addressed by sha256.
//
// Layout:
//
//	<baseDir>/objects/<sha256[:2]>/<sha256[2:]>   — final blobs
//	<baseDir>/tmp/<random>                         — staging area for writes
//
// Writes use a tmp→rename pattern so a crash mid-write never leaves a
// partial blob at the addressed path.
type LocalBlobStore struct {
	baseDir string
}

// NewLocal creates a LocalBlobStore rooted at baseDir, creating subdirectories
// as needed.
func NewLocal(baseDir string) (*LocalBlobStore, error) {
	for _, sub := range []string{"objects", "tmp"} {
		if err := os.MkdirAll(filepath.Join(baseDir, sub), 0o755); err != nil {
			return nil, err
		}
	}
	return &LocalBlobStore{baseDir: baseDir}, nil
}

func (l *LocalBlobStore) objectPath(sum string) string {
	return filepath.Join(l.baseDir, "objects", sum[:2], sum[2:])
}

func (l *LocalBlobStore) Exists(_ context.Context, sum string) (bool, error) {
	_, err := os.Stat(l.objectPath(sum))
	if os.IsNotExist(err) {
		return false, nil
	}
	return err == nil, err
}

func (l *LocalBlobStore) Put(_ context.Context, sum string, r io.Reader, _ int64) error {
	dst := l.objectPath(sum)
	if _, err := os.Stat(dst); err == nil {
		return nil // already present, idempotent
	}

	tmp, err := os.CreateTemp(filepath.Join(l.baseDir, "tmp"), "blob-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	removeOnFail := true
	defer func() {
		tmp.Close()
		if removeOnFail {
			os.Remove(tmpName)
		}
	}()

	h := cryptosha256.New()
	if _, err := io.Copy(io.MultiWriter(tmp, h), r); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if hex.EncodeToString(h.Sum(nil)) != sum {
		return ErrHashMismatch
	}

	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	removeOnFail = false
	return os.Rename(tmpName, dst)
}

func (l *LocalBlobStore) Get(_ context.Context, sum string) (io.ReadCloser, int64, error) {
	f, err := os.Open(l.objectPath(sum))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, 0, ErrNotFound
		}
		return nil, 0, err
	}
	fi, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, 0, err
	}
	return f, fi.Size(), nil
}

func (l *LocalBlobStore) Delete(_ context.Context, sum string) error {
	err := os.Remove(l.objectPath(sum))
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

func (l *LocalBlobStore) PresignedGetURL(context.Context, string, time.Duration) (string, error) {
	return "", nil
}
