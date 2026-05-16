package store

import (
	"database/sql"
	"fmt"

	"github.com/jincurry/skillhub/server/internal/auth"
	_ "modernc.org/sqlite"
)

type Store struct {
	DB *sql.DB
}

func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path+"?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)")
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(1) // SQLite single-writer; keep simple
	if _, err := db.Exec(schemaSQL); err != nil {
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	// Backfill: add ratings_sum column on legacy DBs and seed it from rating*count.
	if _, err := db.Exec(`ALTER TABLE skills ADD COLUMN ratings_sum INTEGER NOT NULL DEFAULT 0`); err == nil {
		_, _ = db.Exec(`UPDATE skills SET ratings_sum = CAST(ROUND(rating * ratings_count) AS INTEGER) WHERE ratings_count > 0`)
	}
	// Backfill: add password_hash column on legacy DBs (empty hash → no login until reseeded).
	_, _ = db.Exec(`ALTER TABLE users ADD COLUMN password_hash TEXT NOT NULL DEFAULT ''`)
	// Backfill: profile fields for the Me model.
	_, _ = db.Exec(`ALTER TABLE users ADD COLUMN email     TEXT NOT NULL DEFAULT ''`)
	_, _ = db.Exec(`ALTER TABLE users ADD COLUMN bio       TEXT NOT NULL DEFAULT ''`)
	_, _ = db.Exec(`ALTER TABLE users ADD COLUMN location  TEXT NOT NULL DEFAULT ''`)
	// SQLite forbids ADD COLUMN with a non-constant default such as
	// CURRENT_TIMESTAMP. Use a constant sentinel and backfill afterwards.
	if _, err := db.Exec(`ALTER TABLE users ADD COLUMN joined_at DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00'`); err == nil {
		_, _ = db.Exec(`UPDATE users SET joined_at = CURRENT_TIMESTAMP WHERE joined_at = '1970-01-01 00:00:00'`)
	}
	// Backfill: long-form description for skills (markdown-ish README body).
	_, _ = db.Exec(`ALTER TABLE skills ADD COLUMN long_desc TEXT NOT NULL DEFAULT ''`)
	// Backfill: when a review was decided, used by the avg-decision-hours stat.
	_, _ = db.Exec(`ALTER TABLE reviews ADD COLUMN decided_at DATETIME`)
	// Backfill: frozen approval-policy JSON captured at submit time. Without
	// this snapshot, editing namespace_policies would retroactively change
	// what reviewers see for in-flight requests. Empty = use live policy.
	_, _ = db.Exec(`ALTER TABLE reviews ADD COLUMN policy_snapshot TEXT NOT NULL DEFAULT ''`)
	// Backfill: hotfix channel — emergency reviews skip the usual SLA + slot
	// requirements and require a written reason that's preserved in audit.
	_, _ = db.Exec(`ALTER TABLE reviews ADD COLUMN is_hotfix     INTEGER NOT NULL DEFAULT 0`)
	_, _ = db.Exec(`ALTER TABLE reviews ADD COLUMN hotfix_reason TEXT    NOT NULL DEFAULT ''`)
	// Backfill: structured target fields on notifications so click-through works.
	_, _ = db.Exec(`ALTER TABLE notifications ADD COLUMN target_kind TEXT NOT NULL DEFAULT ''`)
	_, _ = db.Exec(`ALTER TABLE notifications ADD COLUMN target_ref  TEXT NOT NULL DEFAULT ''`)
	// Backfill: avatar + cover (banner gradient) customisation columns on users.
	_, _ = db.Exec(`ALTER TABLE users ADD COLUMN avatar_url   TEXT NOT NULL DEFAULT ''`)
	_, _ = db.Exec(`ALTER TABLE users ADD COLUMN cover_preset TEXT NOT NULL DEFAULT 'sunset'`)
	_, _ = db.Exec(`ALTER TABLE users ADD COLUMN cover_from   TEXT NOT NULL DEFAULT ''`)
	_, _ = db.Exec(`ALTER TABLE users ADD COLUMN cover_to     TEXT NOT NULL DEFAULT ''`)
	// Backfill: system-wide admin flag (separate from the display-only role).
	if _, err := db.Exec(`ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0`); err == nil {
		// First time the column exists — seed alice as the bootstrap admin so
		// the AI provider config UI is reachable on a fresh install.
		_, _ = db.Exec(`UPDATE users SET is_admin = 1 WHERE username = 'alice'`)
	}
	// Backfill: soft-disable flag; disabled users cannot log in.
	_, _ = db.Exec(`ALTER TABLE users ADD COLUMN is_disabled INTEGER NOT NULL DEFAULT 0`)
	// api_tokens and webhooks tables are created via schemaSQL (CREATE TABLE IF NOT EXISTS).
	// No ALTER TABLE backfills needed for new tables.

	// Run versioned migrations after the baseline + legacy backfills. New
	// schema changes should be added as files under store/migrations/
	// rather than expanding the inline backfills above.
	if err := runMigrations(db); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}

	s := &Store{DB: db}
	if err := s.seedIfEmpty(); err != nil {
		return nil, fmt.Errorf("seed: %w", err)
	}
	if err := s.backfillPasswords(); err != nil {
		return nil, fmt.Errorf("backfill passwords: %w", err)
	}
	if err := s.backfillNamespaceMembers(); err != nil {
		return nil, fmt.Errorf("backfill members: %w", err)
	}
	if err := s.backfillDailyMetrics(); err != nil {
		return nil, fmt.Errorf("backfill metrics: %w", err)
	}
	return s, nil
}

func (s *Store) Close() error { return s.DB.Close() }

// backfillPasswords assigns the default password hash to any user with an empty hash.
// This keeps legacy seeded databases logging in with "password".
func (s *Store) backfillPasswords() error {
	rows, err := s.DB.Query(`SELECT username FROM users WHERE password_hash = '' OR password_hash IS NULL`)
	if err != nil {
		return err
	}
	var users []string
	for rows.Next() {
		var u string
		if err := rows.Scan(&u); err != nil {
			rows.Close()
			return err
		}
		users = append(users, u)
	}
	rows.Close()
	if len(users) == 0 {
		return nil
	}
	hash, err := auth.HashPassword("password")
	if err != nil {
		return err
	}
	for _, u := range users {
		if _, err := s.DB.Exec(`UPDATE users SET password_hash=? WHERE username=?`, hash, u); err != nil {
			return err
		}
	}
	return nil
}

// backfillDailyMetrics seeds the synthetic 30-day series for every skill
// that already exists but has no rows in skill_daily_metrics yet. This runs
// once on upgraded DBs (where seedIfEmpty saw existing rows and skipped
// entirely). The seed function is deterministic so reruns are no-ops as
// long as the data is already there.
func (s *Store) backfillDailyMetrics() error {
	var present int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM skill_daily_metrics LIMIT 1`).Scan(&present); err != nil {
		return err
	}
	if present > 0 {
		return nil
	}
	rows, err := s.DB.Query(`SELECT ns, name, activations, delta_pct FROM skills WHERE activations > 0`)
	if err != nil {
		return err
	}
	type skillRow struct {
		ns, name           string
		weekly, deltaPct   int
	}
	var skills []skillRow
	for rows.Next() {
		var r skillRow
		if err := rows.Scan(&r.ns, &r.name, &r.weekly, &r.deltaPct); err != nil {
			rows.Close()
			return err
		}
		skills = append(skills, r)
	}
	rows.Close()
	for _, r := range skills {
		if err := seedDailyMetrics(s.DB, r.ns, r.name, r.weekly, r.deltaPct); err != nil {
			return err
		}
	}
	return nil
}

// backfillNamespaceMembers ensures each namespace has at least its owner registered
// as 'owner' in namespace_members (only relevant when upgrading legacy DBs).
func (s *Store) backfillNamespaceMembers() error {
	rows, err := s.DB.Query(`SELECT id, owner FROM namespaces`)
	if err != nil {
		return err
	}
	type nsRow struct{ id, owner string }
	var entries []nsRow
	for rows.Next() {
		var n nsRow
		if err := rows.Scan(&n.id, &n.owner); err != nil {
			rows.Close()
			return err
		}
		entries = append(entries, n)
	}
	rows.Close()
	for _, n := range entries {
		if _, err := s.DB.Exec(`INSERT OR IGNORE INTO namespace_members(ns,username,ns_role) VALUES(?,?,?)`,
			n.id, n.owner, "owner"); err != nil {
			return err
		}
	}
	return nil
}

// AuthenticateUser reports whether the given password matches the stored hash.
func (s *Store) AuthenticateUser(username, password string) (bool, error) {
	var hash string
	if err := s.DB.QueryRow(`SELECT password_hash FROM users WHERE username=?`, username).Scan(&hash); err != nil {
		if err == sql.ErrNoRows {
			return false, nil
		}
		return false, err
	}
	return auth.VerifyPassword(hash, password), nil
}
