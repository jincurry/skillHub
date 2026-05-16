# Migrations

Each schema change after the baseline `schema.go` lives here as a numbered
file:

```
NNNN_short_name.up.sql
```

- `NNNN` — zero-padded version (e.g. `0001`, `0002`). Must be unique and
  monotonically increasing.
- `short_name` — snake_case description.
- `.up.sql` — forward-only DDL/DML. We don't run rollbacks; the SQLite
  schema is small enough that fixing forward is simpler than maintaining
  reversible pairs.

## How it runs

`runMigrations()` in `../migrate.go` is invoked once on startup after
`schemaSQL` (which is still the baseline `CREATE TABLE IF NOT EXISTS …`).
It records each applied file in `schema_migrations(version, name, applied_at)`
and skips already-applied files on subsequent boots.

Each migration runs in its own transaction. SQLite's auto-commit DDL means
a failure leaves the DB in the previous state and the migration is marked
unapplied (so you can fix the file and reboot).

## Authoring tips

- **Idempotent statements only**: prefer `CREATE INDEX IF NOT EXISTS`,
  `CREATE TABLE IF NOT EXISTS`, etc. SQLite has no `ALTER TABLE … ADD
  COLUMN IF NOT EXISTS`, so when adding a column to an existing table,
  guard the file with a check (`PRAGMA table_info(...)`) or accept that
  legacy DBs already have the column from the inline backfill in
  `store.go` and the migration runs only on fresh DBs.
- **Don't edit applied files**: once a number is recorded, treat its
  contents as immutable. Make corrections in a new migration.
- **One concern per file**: keeps the audit trail in `schema_migrations`
  meaningful.
