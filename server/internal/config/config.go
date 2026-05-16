package config

import (
	"os"
	"time"
)

type Config struct {
	Addr      string
	DBPath    string
	User      string
	JWTSecret []byte
	JWTTTL    time.Duration

	// External notification webhooks (empty = disabled).
	SlackWebhookURL  string
	FeishuWebhookURL string
}

func Load() Config {
	return Config{
		Addr:             env("SKILLHUB_ADDR", ":8080"),
		DBPath:           env("SKILLHUB_DB", "./skillhub.db"),
		User:             env("SKILLHUB_USER", "alice"),
		JWTSecret:        []byte(env("SKILLHUB_JWT_SECRET", "skillhub-dev-secret-change-me")),
		JWTTTL:           24 * time.Hour,
		SlackWebhookURL:  env("SKILLHUB_SLACK_WEBHOOK", ""),
		FeishuWebhookURL: env("SKILLHUB_FEISHU_WEBHOOK", ""),
	}
}

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
