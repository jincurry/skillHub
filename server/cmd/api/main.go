package main

import (
	"log"

	"github.com/jincurry/skillhub/server/internal/api"
	"github.com/jincurry/skillhub/server/internal/config"
	"github.com/jincurry/skillhub/server/internal/store"
)

func main() {
	cfg := config.Load()
	st, err := store.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	defer st.Close()

	srv := api.New(cfg, st)
	log.Printf("skillhub api listening on %s (db=%s, user=%s)", cfg.Addr, cfg.DBPath, cfg.User)
	if err := srv.Routes().Run(cfg.Addr); err != nil {
		log.Fatalf("server: %v", err)
	}
}
