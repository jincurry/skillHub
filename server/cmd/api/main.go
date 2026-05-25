package main

import (
	"context"
	"log"
	"path/filepath"
	"time"

	"github.com/jincurry/skillhub/server/internal/api"
	"github.com/jincurry/skillhub/server/internal/blobstore"
	"github.com/jincurry/skillhub/server/internal/config"
	"github.com/jincurry/skillhub/server/internal/store"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		// Misconfiguration (missing or weak JWT secret in production-like
		// envs) is unrecoverable; surface a single line and exit.
		log.Fatalf("config: %v", err)
	}
	if cfg.EphemeralJWTSecret {
		log.Printf("warning: SKILLHUB_JWT_SECRET unset — using an ephemeral random secret (sessions reset on restart)")
	}
	st, err := store.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	defer st.Close()

	blobs, err := blobstore.NewLocal(filepath.Join(cfg.DataDir, "blobs"))
	if err != nil {
		log.Fatalf("blobstore: %v", err)
	}

	// Background blob GC: runs every 24 hours to remove unreferenced blobs.
	go func() {
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			n, err := st.GCBlobs(context.Background(), blobs)
			if err != nil {
				log.Printf("gc blobs: %v", err)
			} else if n > 0 {
				log.Printf("gc blobs: deleted %d unreferenced blobs", n)
			}
		}
	}()

	srv := api.New(cfg, st, blobs)
	log.Printf("skillhub api listening on %s (db=%s, data=%s, user=%s)",
		cfg.Addr, cfg.DBPath, cfg.DataDir, cfg.User)
	if err := srv.Routes().Run(cfg.Addr); err != nil {
		log.Fatalf("server: %v", err)
	}
}
