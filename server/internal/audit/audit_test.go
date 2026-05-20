package audit

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

// newTestDB spins up an isolated SQLite database with just the audit_logs
// table — enough to exercise both helpers without dragging in the rest of
// the store package's schema. Using on-disk SQLite (under t.TempDir) keeps
// test parity with the real schema; the in-memory DSN drops constraints we
// don't need to test here.
func newTestDB(t *testing.T) *sql.DB {
	t.Helper()
	path := filepath.Join(t.TempDir(), "audit.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := db.Exec(`CREATE TABLE audit_logs (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		actor       TEXT    NOT NULL,
		action      TEXT    NOT NULL,
		target      TEXT    NOT NULL DEFAULT '',
		version     TEXT    NOT NULL DEFAULT '',
		ip          TEXT    NOT NULL DEFAULT '',
		created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`); err != nil {
		t.Fatalf("create table: %v", err)
	}
	return db
}

func TestLog_WritesRow(t *testing.T) {
	db := newTestDB(t)
	Log(db, "alice", "delete_skill", "ns/foo", "v1.2.3", "10.0.0.1")

	var actor, action, target, version, ip string
	if err := db.QueryRow(
		`SELECT actor, action, target, version, ip FROM audit_logs WHERE id = 1`,
	).Scan(&actor, &action, &target, &version, &ip); err != nil {
		t.Fatalf("read row: %v", err)
	}
	if actor != "alice" || action != "delete_skill" || target != "ns/foo" || version != "v1.2.3" || ip != "10.0.0.1" {
		t.Fatalf("row mismatch: %s/%s/%s/%s/%s", actor, action, target, version, ip)
	}
}

func TestLogTx_RolledBackOnExternalError(t *testing.T) {
	db := newTestDB(t)
	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if err := LogTx(tx, "alice", "approve_review", "ns/foo", "v1.0.0", "10.0.0.1"); err != nil {
		t.Fatalf("log: %v", err)
	}
	// Caller decides not to commit (e.g. main action failed downstream); the
	// audit row must not survive. Without LogTx, callers using db.Exec
	// outside the transaction would persist orphan audit rows.
	if err := tx.Rollback(); err != nil {
		t.Fatalf("rollback: %v", err)
	}
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM audit_logs`).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 0 {
		t.Fatalf("rolled-back audit row leaked: %d rows", n)
	}
}

func TestLogTx_ReturnsErrorOnSQLFailure(t *testing.T) {
	db := newTestDB(t)
	// Drop the table after starting the tx so the INSERT fails inside it.
	// We can't drop inside the same tx (DDL auto-commits in SQLite), so the
	// next-best signal is: a busy DB returning an error from Exec. Easiest
	// reproducible path is closing the DB before LogTx fires.
	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if _, err := tx.Exec(`DROP TABLE audit_logs`); err != nil {
		t.Fatalf("drop: %v", err)
	}
	if err := LogTx(tx, "alice", "x", "y", "", ""); err == nil {
		t.Fatal("LogTx should propagate the underlying SQL error")
	}
	_ = tx.Rollback()
}
