// Package audit centralises writes to the audit_logs table. Before this
// package, callers either embedded INSERTs directly inside their handlers
// (api/*) or inside store transactions, with two consequences worth fixing:
//
//   1. Every call site re-spelled the same INSERT statement; if the schema
//      ever needs another column we'd have to chase ~30 locations.
//   2. The IP column was hard-coded to "127.0.0.1" in store-level writes
//      because the request context never reached the store layer. The Log /
//      LogTx helpers below accept the IP explicitly so callers that *do*
//      have request context (the api package) can pass it through, while
//      store-internal writes can still pass "" until that plumbing lands.
//
// Both helpers are best-effort: they swallow errors after logging them, on
// the theory that an audit-write failure should not fail the user-visible
// action that triggered it. Callers that need the audit row to be atomic
// with the action's transaction must use LogTx.
package audit

import (
	"database/sql"
	"log"
)

// Executor is the subset of *sql.DB / *sql.Tx that we need. Splitting the
// interface lets Log and LogTx share an implementation without exposing
// callers to the difference.
type Executor interface {
	Exec(query string, args ...any) (sql.Result, error)
}

// insert is the canonical statement. Any future column addition only
// requires touching this constant + Log/LogTx signatures.
const insert = `INSERT INTO audit_logs(actor,action,target,version,ip) VALUES(?,?,?,?,?)`

// Log writes a single audit row using the supplied database connection.
// Errors are logged but never returned, matching the previous
// `_, _ = db.Exec(...)` semantics so that audit failures don't bubble up
// and break the user-visible flow.
//
// Empty version / ip are valid: the audit_logs table defaults them to ''.
func Log(db Executor, actor, action, target, version, ip string) {
	if _, err := db.Exec(insert, actor, action, target, version, ip); err != nil {
		log.Printf("audit: failed to write %s by %s on %s: %v", action, actor, target, err)
	}
}

// LogTx writes a single audit row inside the caller's transaction. Unlike
// Log, the error is *returned* so the caller can decide whether to roll the
// transaction back: when the audit row matters for atomicity (e.g. the
// review-decision flow), losing it would leave the system in an
// inconsistent state.
func LogTx(tx *sql.Tx, actor, action, target, version, ip string) error {
	_, err := tx.Exec(insert, actor, action, target, version, ip)
	return err
}
