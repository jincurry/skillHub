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
npm run build             # tsc + vite build → web/dist/
npm run lint              # ESLint (flat config in eslint.config.js, max-warnings 10)
npm test -- --run         # Vitest (single run, no watch)
```

### Reset dev data
```bash
rm server/skillhub.db*    # delete SQLite file; re-running the server re-seeds it
```

### CI
`.github/workflows/ci.yml` runs on push to `main` and every PR:
- backend: `golangci-lint` → `go vet ./...` → `go build ./...` → `go test ./... -race -count=1`
- frontend: `npm ci` → `npm test -- --run` → `npm run build`

Both jobs must pass. Match the CI commands locally before pushing.

## Architecture

### Repository layout
```
server/   Go + Gin + SQLite backend (pure Go, no CGO)
web/      React 18 + TypeScript + Vite + Tailwind SPA
prototype/ Static JSX UI mockups (open prototype/index.html directly; no build step)
design/   Full design doc (domain model, approval flow, DB schema, API spec)
```

### Backend (`server/`)

Entry points:
- `cmd/api/main.go` — HTTP API server
- `cmd/cli/main.go` — `skillhub` CLI (cobra-based; thin HTTP client over the REST API). Subcommands: `auth`, `skill`, `review`, `ns`. Config at `~/.config/skillhub/config.json` (override via `SKILLHUB_CONFIG`).

Internal packages:
- `internal/api` — Gin route registration and all HTTP handlers (`api.go` is the main file; `ai.go`, `dist_tags_subs.go`, `policies.go`, `webhooks.go`, `openapi.go` handle their respective feature sets)
- `internal/store` — SQLite wrapper. All DB access lives here. No ORM; raw `database/sql`. The single `Store` struct exposes every data operation as a method, split across topical files (`activations.go`, `users.go`, `versions.go`, `skill_lifecycle.go`, …).
- `internal/model` — Request/response structs shared between `api` and `store`
- `internal/auth` — HS256 JWT sign/verify (self-implemented, no third-party JWT lib) and bcrypt password hashing
- `internal/config` — Env var config (`SKILLHUB_ADDR`, `SKILLHUB_DB`, `SKILLHUB_JWT_SECRET`, `SKILLHUB_USER`)
- `internal/policy` — Hardcoded default approval policies by classification (L1/L2/L3)
- `internal/validate` — Six skill validation checks (schema, naming, secret scan, classification, tag coverage, description completeness)
- `internal/middleware` — Gin middleware: structured JSON request logger, token-bucket rate limiter, Prometheus metrics registry (request count + latency histogram)
- `internal/notifier` — External notification dispatcher with pluggable senders (Slack, Feishu/Lark). `Dispatcher.Dispatch()` fans events out concurrently and never blocks the caller.
- `internal/templates` — Built-in skill bundle templates served to the New Skill flow

**Schema management**: Hybrid — `store/schema.go` contains the baseline `CREATE TABLE IF NOT EXISTS` DDL applied on `Open()`, followed by `ALTER TABLE … ADD COLUMN` backfills for legacy columns. New schema changes go in `store/migrations/NNNN_name.up.sql` and are applied by `runMigrations()` (embedded via `//go:embed`), tracked in the `schema_migrations` table. Migrations run in numeric-prefix order, each in its own transaction. SQLite is capped to a single writer (`SetMaxOpenConns(1)`); WAL is enabled.

**Seeding**: On first run, `store/seed.go` inserts 6 users, 7 namespaces, 9 skills, 5 reviews, and sample data. All seed passwords are `password`. `alice` is the bootstrap admin (`is_admin=1`).

**Auth model**: Two token types are accepted via `Authorization: Bearer <token>`:
- **JWT**: Issued by `POST /api/v1/auth/login`. HS256, 24h TTL. `is_disabled` checked at login time only.
- **PAT**: Issued by `POST /api/v1/me/tokens`. Format `skillhub_<random>`. `is_disabled` checked on **every request** — disabled users are blocked immediately.

Admin-only routes additionally require `users.is_admin = 1` (`requireAdmin` middleware).

**Store methods** — key operations on the `Store` struct:
- `RecordActivation(ns, name, count)` — atomically increments `skills.activations`, upserts today's `skill_daily_metrics`, recomputes `delta_pct` (7-day vs prior-7-day) and `hot` flag (delta > 20%)
- `ChangePassword(username, oldPass, newPass)` — bcrypt-verifies old password before updating
- `UpdateSkillMeta(ns, name, req)` — partial update of description/classification/tags/icon/longDesc
- `CreateAdminUser(req)` — create user with optional `is_admin` flag; validates non-empty username and password min-length
- `AdminUpdateUser(username, req)` — patch display/role/team/email/isAdmin/isDisabled/password
- `IsUserDisabled(username)` — returns `(bool, error)`; unknown users return `false, nil`
- `LookupTokenUser(token)` — resolves PAT to username; returns `""` if expired or invalid

**Approval / review flow**: When a skill is submitted for review, `SubmitDraftForReview` in `store/queries.go` snapshots the current policy as JSON into the `reviews.policy_snapshot` column. This freeze means admin policy edits never affect in-flight reviews. `DecideReview("approve")` in the same transaction upserts the `latest` dist tag and fan-outs notifications to all subscribers (excluding the author and the approver).

**AI assist**: `internal/api/ai.go` proxies to a configurable upstream (stored in the `ai_providers` table) and streams SSE deltas back to the client.

**Observability endpoints** (no auth required):
- `GET /healthz` — liveness probe (always 200 if process is up)
- `GET /readyz` — readiness probe (checks DB connectivity)
- `GET /metrics` — Prometheus exposition format (request count + latency histogram, served by `internal/middleware`)
- `GET /api/v1/openapi.json` — generated OpenAPI 3.0 spec for the public API surface

**External notifications**: `internal/notifier.Dispatcher` fans events out to registered `Sender`s (Slack, Feishu/Lark) concurrently. Senders are best-effort — failures are logged and never block the caller. The dispatcher is constructed in `cmd/api/main.go` from env config and injected into the `Server`.

### Frontend (`web/src/`)

- `api/client.ts` — Single `api` object containing every API call. All types in `api/types.ts`. On 401, calls `clearAuth()` and invokes the handler registered by `setUnauthorizedHandler` (wired in `main.tsx` to redirect to `/login`).
- `api/auth.ts` — Token storage (localStorage). `getTokenExpiry()` parses the JWT `exp` claim from the base64 payload.
- `api/useAsync.ts` — Minimal async hook used across pages
- `pages/` — One file per route. Routes are declared in `App.tsx` and wrapped in `RequireAuth` → `Layout`.
- `components/` — Shared UI pieces:
  - `Layout.tsx` — sidebar shell; also renders `SessionExpiryBanner`
  - `RequireAuth.tsx` — guards all authenticated routes (redirects to `/login` on missing token)
  - `RequireAdmin.tsx` — guards `/admin` route; reads `getStoredUser().isAdmin` from localStorage; redirects non-admins to `/workspace`
  - `SessionExpiryBanner.tsx` — shows bottom banner 5 minutes before JWT expiry with live countdown; uses `setTimeout` to wake up at the right moment, then `setInterval` for 1s ticks
- `lib/aiAssist.ts` — SSE streaming client for AI assist. Uses `fetch()` with `Accept: text/event-stream` instead of `EventSource` because `EventSource` doesn't support `Authorization` headers.
- `lib/tokens.ts` — Client-side token count estimator (no WASM; heuristic: CJK ~0.67 tok/char, ASCII ~0.25 tok/char).

**Routing**: All routes are under a single `RequireAuth` + `Layout` wrapper. The `/admin` route is additionally wrapped in `RequireAdmin`. There is no code splitting; all pages are bundled together.

**Dev proxy**: `vite.config.ts` proxies `/api/*` to `localhost:8080`, so the frontend always uses relative URLs.

### Editor page (`web/src/pages/Editor.tsx`)

Key features beyond basic Monaco editing:

- **Multi-model**: One Monaco model per file path. Tab switches call `editor.setModel()` and preserve view state (scroll + cursor) per path in a `Map`.
- **Cmd/Ctrl+P file picker**: Custom `FilePicker` overlay replaces Monaco's built-in command palette. Fuzzy-scored results, keyboard navigation.
- **Token budget**: `estimateTokens()` across all files; unloaded files fall back to `file.size * 0.25`. Displayed in Bundle Structure sidebar with color thresholds.
- **Frontmatter form**: Parses/writes YAML frontmatter in SKILL.md. Includes `version` field and `TagsField` chip input (Enter/comma to add, Backspace removes last).
- **File upload**: New-file dialog has template/upload mode switcher. Upload reads `File` objects as text and calls `api.putFile`.
- **Discard all**: Confirms, clears all dirty buffers and localStorage drafts, reactivates the current file from server.
- **Submit diff preview**: `computeDiff(before, after, ctx=3)` — LCS-based unified diff capped at 400 lines. Each dirty file in the submit modal has a "查看变更" toggle showing colored +/- rows with context collapsing.
- **Server snapshots**: `serverSnapshots: Record<string, string>` stores content as fetched from server; used as the "before" side of the diff.

## Key Domain Concepts

**Skill lifecycle**: `draft → reviewing → approved → published`. From `published`, a skill can be `yanked` (emergency, requires a reason) or `deprecated` (soft retirement). A yanked/deprecated skill can start a new draft version.

**Classification**: L1 (public) / L2 (internal) / L3 (sensitive). Controls the review policy: L1 = 1 reviewer, L2 = 2 reviewers (parallel), L3 = 3 reviewers (serial). Policies are defined in `internal/policy/policy.go` and can be overridden per namespace via the `namespace_policies` table.

**Hotfix channel**: `isHotfix=true` on submit uses a relaxed 1-reviewer / 4h-SLA policy. Only namespace owners/maintainers can use it. The audit log always records a `hotfix_submit` entry.

**Skill files**: Three files are pinned and cannot be deleted or renamed: `skill.yaml`, `SKILL.md`, `README.md`. Small files are stored inline in the DB; larger ones go to disk under `./data/`.

**Dist tags**: `latest` is automatically upserted to point at the newest approved version on every `approve` decision. `stable` / `beta` / custom tags are managed manually by owners/maintainers. `latest` cannot be manually deleted.

**Activation tracking**: `POST /skills/:ns/:name/activate` atomically increments `skills.activations` and upserts today's row in `skill_daily_metrics`, then recomputes `delta_pct` (7-day vs prior 7-day) and the `hot` flag (delta > 20%) from the last 14 days of daily data. No cron job needed.

## Tests

Backend tests are spread across the package they cover:
- `internal/store/` — `platform_features_test.go`, `new_features_test.go`, `inline_comments_test.go`, `migrate_test.go` (real on-disk SQLite under `t.TempDir()`; helpers `seedBasicWorld()` / `seedUserWithPassword()` set up fixtures)
- `internal/api/` — HTTP integration tests (`auth_test.go`, `skills_test.go`, `reviews_test.go`, `comments_test.go`, `notifications_test.go`, `observability_test.go`); `helpers_test.go` builds a test `Server` over a temp DB
- `internal/middleware/` — logger / metrics / ratelimit unit tests
- `internal/notifier/` — dispatcher fan-out test
- `internal/templates/` — built-in template fixtures

CI runs `go test ./... -race -count=1`; match locally before pushing.

Run a single test:
```bash
cd server && go test ./internal/store/ -run TestRecordActivation -v
cd server && go test ./internal/api/ -run TestSkills -v
```

Frontend tests use **Vitest** (jsdom + Testing Library). Co-located `*.test.ts(x)` files; run with `npm test -- --run` (single shot) or `npm test` (watch mode).

## Seed Accounts

All passwords are `password`.

| Username | Role | Notes |
|---|---|---|
| `alice` | Maintainer | Bootstrap admin (`is_admin=1`), owns `platform-team` |
| `bob` | Maintainer | Owns `sre-team` |
| `frank` | Maintainer | Owns `data-team` |
| `charlie` | Reviewer | Owns `security-team` |
| `diana` | Member | Finance/frontend teams |
