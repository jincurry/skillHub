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
	_, _ = db.Exec(`ALTER TABLE users ADD COLUMN joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`)
	// Backfill: long-form description for skills (markdown-ish README body).
	_, _ = db.Exec(`ALTER TABLE skills ADD COLUMN long_desc TEXT NOT NULL DEFAULT ''`)
	// Backfill: when a review was decided, used by the avg-decision-hours stat.
	_, _ = db.Exec(`ALTER TABLE reviews ADD COLUMN decided_at DATETIME`)
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
