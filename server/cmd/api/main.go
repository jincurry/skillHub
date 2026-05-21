package main

import (
	"log"
	"path/filepath"

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

	srv := api.New(cfg, st, blobs)
	log.Printf("skillhub api listening on %s (db=%s, data=%s, user=%s)",
		cfg.Addr, cfg.DBPath, cfg.DataDir, cfg.User)
	if err := srv.Routes().Run(cfg.Addr); err != nil {
		log.Fatalf("server: %v", err)
	}
}
