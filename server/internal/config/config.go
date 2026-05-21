package config

import (
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"time"
)

type Config struct {
	Addr      string
	DBPath  string
	DataDir string
	User    string
	JWTSecret []byte
	JWTTTL    time.Duration

	// EphemeralJWTSecret is true when SKILLHUB_JWT_SECRET was unset and
	// Load() generated a random secret in-memory. Sessions don't survive a
	// restart in that case; the API logs a warning at startup.
	EphemeralJWTSecret bool

	// External notification webhooks (empty = disabled).
	SlackWebhookURL  string
	FeishuWebhookURL string

	// LogWriter is where the structured request logger sends JSON lines.
	// Defaults to os.Stdout when nil. Tests typically set this to io.Discard.
	LogWriter io.Writer
}

// LegacyDefaultJWTSecret is the literal that earlier builds shipped with as
// a fallback. It's now rejected at startup so a missed env var can't ship a
// known signing key to production.
const LegacyDefaultJWTSecret = "skillhub-dev-secret-change-me"

// MinJWTSecretBytes is the lower bound we accept for an explicit secret.
// HMAC-SHA256 doesn't strictly need 32 bytes, but anything shorter is almost
// certainly a placeholder rather than a real secret.
const MinJWTSecretBytes = 32

// ErrWeakJWTSecret is returned by Load when SKILLHUB_JWT_SECRET is set but
// either matches the legacy default literal or is shorter than
// MinJWTSecretBytes. Refusing to start beats silently signing tokens with a
// known/weak key.
var ErrWeakJWTSecret = errors.New("SKILLHUB_JWT_SECRET is missing, too short, or matches the known dev default")

// Load reads the runtime configuration from the environment. It returns an
// error rather than a Config when the JWT secret is set but is too short or
// matches the legacy dev default — that combination almost always means a
// production deploy missed setting a real secret.
//
// When the env var is unset entirely, Load generates a random ephemeral
// secret in memory and marks the config as such. The caller is expected to
// log this so operators know sessions won't persist across restarts.
func Load() (Config, error) {
	cfg := Config{
		Addr:             env("SKILLHUB_ADDR", ":8080"),
		DBPath:           env("SKILLHUB_DB", "./skillhub.db"),
		DataDir:          env("SKILLHUB_DATA_DIR", "./data"),
		User:             env("SKILLHUB_USER", "alice"),
		JWTTTL:           24 * time.Hour,
		SlackWebhookURL:  env("SKILLHUB_SLACK_WEBHOOK", ""),
		FeishuWebhookURL: env("SKILLHUB_FEISHU_WEBHOOK", ""),
	}

	raw, set := os.LookupEnv("SKILLHUB_JWT_SECRET")
	switch {
	case !set || raw == "":
		// Dev fallback: generate a fresh random secret per process. Tokens
		// minted with it become invalid on restart, which is fine for local
		// `go run ./cmd/api` but visible in the logs.
		secret := make([]byte, MinJWTSecretBytes)
		if _, err := rand.Read(secret); err != nil {
			return Config{}, fmt.Errorf("generate ephemeral jwt secret: %w", err)
		}
		cfg.JWTSecret = secret
		cfg.EphemeralJWTSecret = true
	case raw == LegacyDefaultJWTSecret:
		return Config{}, fmt.Errorf("%w: refuses to start with the known legacy default", ErrWeakJWTSecret)
	case len(raw) < MinJWTSecretBytes:
		return Config{}, fmt.Errorf("%w: secret must be at least %d bytes (got %d)", ErrWeakJWTSecret, MinJWTSecretBytes, len(raw))
	default:
		cfg.JWTSecret = []byte(raw)
	}

	return cfg, nil
}

// MustLoad is the convenience wrapper for entry points that should hard-fail
// on config errors.
func MustLoad() Config {
	cfg, err := Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	return cfg
}

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
