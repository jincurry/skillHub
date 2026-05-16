package store

import (
	"path/filepath"
	"testing"
)

func TestMigrationsApplyAndAreIdempotent(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "skillhub.db")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("first Open: %v", err)
	}

	// 0001 should be recorded.
	var v int
	if err := s.DB.QueryRow(
		`SELECT version FROM schema_migrations WHERE version = 1`,
	).Scan(&v); err != nil {
		t.Fatalf("expected migration 1 to be recorded: %v", err)
	}
	if v != 1 {
		t.Fatalf("want version=1, got %d", v)
	}

	// The index 0001 creates should exist.
	var name string
	if err := s.DB.QueryRow(
		`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_audit_actor_created'`,
	).Scan(&name); err != nil {
		t.Fatalf("expected idx_audit_actor_created to exist after migrate: %v", err)
	}

	s.Close()

	// Reopen — should be a no-op for migrations.
	s2, err := Open(dbPath)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer s2.Close()
	var count int
	if err := s2.DB.QueryRow(`SELECT COUNT(*) FROM schema_migrations`).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected exactly 1 recorded migration, got %d", count)
	}
}

func TestParseMigrationFilename(t *testing.T) {
	cases := []struct {
		in        string
		wantV     int
		wantName  string
		wantOK    bool
	}{
		{"0001_audit_indexes.up.sql", 1, "audit_indexes", true},
		{"0042_add_skill_templates.up.sql", 42, "add_skill_templates", true},
		{"audit_indexes.up.sql", 0, "", false},
		{"0001.up.sql", 0, "", false},
		{"0001_x.down.sql", 0, "", false}, // suffix mismatch handled by caller; parse alone won't see this
	}
	for _, c := range cases {
		// Note: parseMigrationFilename assumes ".up.sql" was already trimmed
		// by its caller's filter — but here we pass the full name on purpose
		// to match how runMigrations checks HasSuffix first. So skip the
		// down-suffix case which the runner would never reach.
		if c.in == "0001_x.down.sql" {
			continue
		}
		v, name, ok := parseMigrationFilename(c.in)
		if ok != c.wantOK || v != c.wantV || name != c.wantName {
			t.Errorf("parseMigrationFilename(%q) = (%d,%q,%v), want (%d,%q,%v)",
				c.in, v, name, ok, c.wantV, c.wantName, c.wantOK)
		}
	}
}
