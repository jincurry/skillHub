package store

import (
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"sort"
	"strings"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// runMigrations applies any *.up.sql files under migrations/ that haven't
// been recorded in schema_migrations yet. Each migration runs in its own
// transaction; on success we record (version, name) in schema_migrations.
//
// Conventions:
//   - Files are named NNNN_short_name.up.sql (e.g. 0001_audit_indexes.up.sql).
//   - The numeric prefix is the version; it must be unique and monotonic.
//   - Files are applied in lexical order, which equals numeric order given
//     the fixed-width prefix.
//
// This system coexists with the legacy schemaSQL baseline + ALTER TABLE
// backfills in Open(). New schema changes should be added here as new files
// rather than expanding the inline backfills in store.go.
func runMigrations(db *sql.DB) error {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version  INTEGER PRIMARY KEY,
		name     TEXT    NOT NULL,
		applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	applied := map[int]bool{}
	rows, err := db.Query(`SELECT version FROM schema_migrations`)
	if err != nil {
		return fmt.Errorf("read schema_migrations: %w", err)
	}
	for rows.Next() {
		var v int
		if err := rows.Scan(&v); err != nil {
			rows.Close()
			return err
		}
		applied[v] = true
	}
	rows.Close()

	files, err := fs.ReadDir(migrationsFS, "migrations")
	if err != nil {
		return fmt.Errorf("read migrations dir: %w", err)
	}

	type mig struct {
		version int
		name    string
		path    string
	}
	var pending []mig
	for _, f := range files {
		if f.IsDir() || !strings.HasSuffix(f.Name(), ".up.sql") {
			continue
		}
		v, name, ok := parseMigrationFilename(f.Name())
		if !ok {
			return fmt.Errorf("invalid migration filename: %s", f.Name())
		}
		if applied[v] {
			continue
		}
		pending = append(pending, mig{v, name, "migrations/" + f.Name()})
	}
	sort.Slice(pending, func(i, j int) bool { return pending[i].version < pending[j].version })

	for _, m := range pending {
		body, err := fs.ReadFile(migrationsFS, m.path)
		if err != nil {
			return fmt.Errorf("read %s: %w", m.path, err)
		}
		tx, err := db.Begin()
		if err != nil {
			return fmt.Errorf("begin %s: %w", m.path, err)
		}
		if _, err := tx.Exec(string(body)); err != nil {
			tx.Rollback()
			return fmt.Errorf("apply %s: %w", m.path, err)
		}
		if _, err := tx.Exec(
			`INSERT INTO schema_migrations(version,name) VALUES(?,?)`, m.version, m.name,
		); err != nil {
			tx.Rollback()
			return fmt.Errorf("record %s: %w", m.path, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit %s: %w", m.path, err)
		}
	}
	return nil
}

// parseMigrationFilename splits "0001_audit_indexes.up.sql" into (1, "audit_indexes", true).
func parseMigrationFilename(fname string) (int, string, bool) {
	base := strings.TrimSuffix(fname, ".up.sql")
	idx := strings.IndexByte(base, '_')
	if idx <= 0 {
		return 0, "", false
	}
	prefix := base[:idx]
	v := 0
	for _, c := range prefix {
		if c < '0' || c > '9' {
			return 0, "", false
		}
		v = v*10 + int(c-'0')
	}
	name := base[idx+1:]
	if name == "" {
		return 0, "", false
	}
	return v, name, true
}
