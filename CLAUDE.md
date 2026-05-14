# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

skillHub is an enterprise AI Skill lifecycle management platform. Skills are YAML/Markdown bundles that describe how an AI assistant should behave in a specific context. The platform manages their creation, approval workflow, publishing, and retirement — all through a web UI.

## Commands

### Backend (Go)
```bash
cd server
go run ./cmd/api          # dev server → http://localhost:8080
go test ./...             # run all tests
go vet ./...              # vet
go build ./...            # build check
```

### Frontend (React/TS)
```bash
cd web
npm install
npm run dev               # dev server → http://localhost:5173 (proxies /api/* to :8080)
npm run build             # production build → web/dist/
npm run lint              # ESLint
```

### Reset dev data
```bash
rm server/skillhub.db*    # delete SQLite file; re-running the server re-seeds it
```

## Architecture

### Repository layout
```
server/   Go + Gin + SQLite backend (pure Go, no CGO)
web/      React 18 + TypeScript + Vite + Tailwind SPA
prototype/ Static JSX UI mockups (open prototype/index.html directly; no build step)
design/   Full design doc (domain model, approval flow, DB schema, API spec)
```

### Backend (`server/`)

Entry point: `cmd/api/main.go`

Internal packages:
- `internal/api` — Gin route registration and all HTTP handlers (`api.go` is the main file; `ai.go`, `dist_tags_subs.go`, `policies.go` handle their respective feature sets)
- `internal/store` — SQLite wrapper. All DB access lives here. No ORM; raw `database/sql`. The single `Store` struct exposes every data operation as a method.
- `internal/model` — Request/response structs shared between `api` and `store`
- `internal/auth` — HS256 JWT sign/verify (self-implemented, no third-party JWT lib) and bcrypt password hashing
- `internal/config` — Env var config (`SKILLHUB_ADDR`, `SKILLHUB_DB`, `SKILLHUB_JWT_SECRET`, `SKILLHUB_USER`)
- `internal/policy` — Hardcoded default approval policies by classification (L1/L2/L3)
- `internal/validate` — Six skill validation checks (schema, naming, secret scan, classification, tag coverage, description completeness)

**Schema management**: There are no migration files. `store/schema.go` contains the full `CREATE TABLE IF NOT EXISTS` DDL, and `store/store.go`'s `Open()` function runs `ALTER TABLE … ADD COLUMN` backfills for every column added after the initial schema. SQLite is capped to a single writer (`SetMaxOpenConns(1)`).

**Seeding**: On first run, `store/seed.go` inserts 6 users, 7 namespaces, 9 skills, 5 reviews, and sample data. All seed passwords are `password`. `alice` is the bootstrap admin (`is_admin=1`).

**Auth model**: `POST /api/v1/auth/login` returns a 24h HS256 JWT. All other routes under `/api/v1` require `Authorization: Bearer <token>`. Admin-only routes additionally check `users.is_admin = 1`.

**Approval / review flow**: When a skill is submitted for review, `SubmitDraftForReview` in `store/queries.go` snapshots the current policy as JSON into the `reviews.policy_snapshot` column. This freeze means admin policy edits never affect in-flight reviews. `DecideReview("approve")` in the same transaction upserts the `latest` dist tag and fan-outs notifications to all subscribers (excluding the author and the approver).

**AI assist**: `internal/api/ai.go` proxies to a configurable upstream (stored in the `ai_providers` table) and streams SSE deltas back to the client.

### Frontend (`web/src/`)

- `api/client.ts` — Single `api` object containing every API call. All types in `api/types.ts`. On 401, calls `clearAuth()` and invokes the handler registered by `setUnauthorizedHandler` (wired in `main.tsx` to redirect to `/login`).
- `api/auth.ts` — Token storage (localStorage)
- `api/useAsync.ts` — Minimal async hook used across pages
- `pages/` — One file per route. Routes are declared in `App.tsx` and wrapped in `RequireAuth` → `Layout`.
- `components/` — Shared UI pieces. `Layout.tsx` is the sidebar shell; `RequireAuth.tsx` guards all authenticated routes.
- `lib/aiAssist.ts` — SSE streaming client for AI assist. Uses `fetch()` with `Accept: text/event-stream` instead of `EventSource` because `EventSource` doesn't support `Authorization` headers.
- `lib/tokens.ts` — Client-side token count estimator (no WASM; heuristic only).

**Routing**: All routes are under a single `RequireAuth` + `Layout` wrapper. There is no code splitting; all pages are bundled together.

**Dev proxy**: `vite.config.ts` proxies `/api/*` to `localhost:8080`, so the frontend always uses relative URLs.

## Key Domain Concepts

**Skill lifecycle**: `draft → reviewing → approved → published`. From `published`, a skill can be `yanked` (emergency, requires a reason) or `deprecated` (soft retirement). A yanked/deprecated skill can start a new draft version.

**Classification**: L1 (public) / L2 (internal) / L3 (sensitive). Controls the review policy: L1 = 1 reviewer, L2 = 2 reviewers (parallel), L3 = 3 reviewers (serial). Policies are defined in `internal/policy/policy.go` and can be overridden per namespace via the `namespace_policies` table.

**Hotfix channel**: `isHotfix=true` on submit uses a relaxed 1-reviewer / 4h-SLA policy. Only namespace owners/maintainers can use it. The audit log always records a `hotfix_submit` entry.

**Skill files**: Three files are pinned and cannot be deleted or renamed: `skill.yaml`, `SKILL.md`, `README.md`. Small files are stored inline in the DB; larger ones go to disk under `./data/`.

**Dist tags**: `latest` is automatically upserted to point at the newest approved version on every `approve` decision. `stable` / `beta` / custom tags are managed manually by owners/maintainers. `latest` cannot be manually deleted.

## Tests

The only tests are in `server/internal/store/platform_features_test.go`. They use a real on-disk SQLite (not `:memory:`) under `t.TempDir()`. To run a single test:
```bash
cd server && go test ./internal/store/ -run TestSubmitDraftFreezesPolicySnapshot -v
```

There are no frontend tests.

## Seed Accounts

All passwords are `password`.

| Username | Role | Notes |
|---|---|---|
| `alice` | Maintainer | Bootstrap admin (`is_admin=1`), owns `platform-team` |
| `bob` | Maintainer | Owns `sre-team` |
| `frank` | Maintainer | Owns `data-team` |
| `charlie` | Reviewer | Owns `security-team` |
| `diana` | Member | Finance/frontend teams |
