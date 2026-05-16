package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type Config struct {
	Server string `json:"server"`
	Token  string `json:"token"`
}

func configPath() string {
	if p := os.Getenv("SKILLHUB_CONFIG"); p != "" {
		return p
	}
	dir, _ := os.UserConfigDir()
	return filepath.Join(dir, "skillhub", "config.json")
}

func loadConfig() (*Config, error) {
	data, err := os.ReadFile(configPath())
	if err != nil {
		if os.IsNotExist(err) {
			return &Config{Server: "http://localhost:8080"}, nil
		}
		return nil, err
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

func saveConfig(cfg *Config) error {
	p := configPath()
	if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, data, 0600)
}
