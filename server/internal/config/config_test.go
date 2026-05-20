package config

import (
	"errors"
	"os"
	"strings"
	"testing"
)

// unsetEnv removes an env var for the duration of the test and restores its
// prior value on cleanup. t.Setenv only handles the set side; we need the
// "unset" path to exercise Load's ephemeral-secret branch.
func unsetEnv(t *testing.T, key string) {
	t.Helper()
	prev, prevSet := os.LookupEnv(key)
	if err := os.Unsetenv(key); err != nil {
		t.Fatalf("unset %s: %v", key, err)
	}
	t.Cleanup(func() {
		if prevSet {
			_ = os.Setenv(key, prev)
		} else {
			_ = os.Unsetenv(key)
		}
	})
}

func TestLoad_RejectsLegacyDefaultSecret(t *testing.T) {
	t.Setenv("SKILLHUB_JWT_SECRET", LegacyDefaultJWTSecret)
	_, err := Load()
	if !errors.Is(err, ErrWeakJWTSecret) {
		t.Fatalf("err = %v, want ErrWeakJWTSecret", err)
	}
}

func TestLoad_RejectsShortSecret(t *testing.T) {
	t.Setenv("SKILLHUB_JWT_SECRET", strings.Repeat("a", MinJWTSecretBytes-1))
	_, err := Load()
	if !errors.Is(err, ErrWeakJWTSecret) {
		t.Fatalf("err = %v, want ErrWeakJWTSecret", err)
	}
}

func TestLoad_AcceptsLongSecret(t *testing.T) {
	want := strings.Repeat("k", MinJWTSecretBytes)
	t.Setenv("SKILLHUB_JWT_SECRET", want)
	cfg, err := Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if string(cfg.JWTSecret) != want {
		t.Fatalf("JWTSecret = %q, want %q", string(cfg.JWTSecret), want)
	}
	if cfg.EphemeralJWTSecret {
		t.Fatal("EphemeralJWTSecret should be false when secret was provided")
	}
}

func TestLoad_GeneratesEphemeralSecretWhenUnset(t *testing.T) {
	unsetEnv(t, "SKILLHUB_JWT_SECRET")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if !cfg.EphemeralJWTSecret {
		t.Fatal("EphemeralJWTSecret should be true when env var is unset")
	}
	if len(cfg.JWTSecret) < MinJWTSecretBytes {
		t.Fatalf("ephemeral secret too short: %d", len(cfg.JWTSecret))
	}
	// Two consecutive Loads should produce different ephemeral secrets so
	// nothing is sneakily memoised.
	cfg2, err := Load()
	if err != nil {
		t.Fatalf("load2: %v", err)
	}
	if string(cfg.JWTSecret) == string(cfg2.JWTSecret) {
		t.Fatal("ephemeral secrets must be regenerated per Load")
	}
}
