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

Entry points:
- `cmd/api/main.go` — HTTP API server
- `cmd/cli/main.go` — `skillhub` CLI (cobra-based; thin HTTP client over the REST API). Subcommands: `auth`, `skill`, `review`, `ns`. Config at `~/.config/skillhub/config.json` (override via `SKILLHUB_CONFIG`).

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

**Skill files**: Only `SKILL.md` is pinned — it's the bundle's canonical entry point and the validate pass treats its absence as a blocker. `skill.yaml` and `README.md` are seeded by the default template but the author can delete or rename them. The `REQUIRED_FILES` set in `web/src/pages/Editor.tsx` is the source of truth. Small files are stored inline in the DB; larger ones go to disk under `./data/`.

**Dist tags**: `latest` is automatically upserted to point at the newest approved version on every `approve` decision. `stable` / `beta` / custom tags are managed manually by owners/maintainers. `latest` cannot be manually deleted.

**Activation tracking**: `POST /skills/:ns/:name/activate` atomically increments `skills.activations` and upserts today's row in `skill_daily_metrics`, then recomputes `delta_pct` (7-day vs prior 7-day) and the `hot` flag (delta > 20%) from the last 14 days of daily data. No cron job needed.

## i18n

Two-locale setup (zh-CN default, en). Frontend uses **react-i18next**; backend has a tiny custom helper. The frontend sends `Accept-Language` on every request (set by `web/src/api/client.ts`); the backend reads it via `i18n.LangFromGin(c)`.

**Frontend** (`web/src/i18n/`):
- `index.ts` — boots i18next with localStorage persistence (key: `skillHub.lang`). Imported once from `main.tsx`.
- `locales/zh-CN.json` and `locales/en.json` — translation dictionaries. Keys are dotted, lowercase: `nav.workspace`, `login.submit`, `commandPalette.placeholder`. Adding a key means filling it in BOTH files.
- `LanguageSwitcher` (in `components/`) sits in the topbar and cycles through `SUPPORTED_LANGUAGES`.
- Components use `const { t } = useTranslation()` and `t('namespace.key', { interpolation })`.
- `lib/notify.ts`'s `fmtRelative()` uses `Intl.RelativeTimeFormat` keyed on `i18n.resolvedLanguage`, so "5 minutes ago" / "5 分钟前" come from the platform without us writing pluralization rules.

**Backend** (`server/internal/i18n/`):
- `i18n.go` exposes `LangFromHeader`, `LangFromGin`, `T(lang, key, args...)`. No external deps; we do our own Accept-Language parsing (very loose — first-match wins, q-values ignored).
- `tables.go` is the flat `map[Lang]map[string]string` translation table. Keys grouped by surface: `api.*` for HTTP error responses, `notif.*` for notification body templates.
- `gin.go` provides `i18n.Error(c, status, key, args...)` shorthand — most call sites use this instead of `c.JSON(status, gin.H{"error": i18n.T(...)})`.
- Missing keys fall back to default locale (zh-CN), then to the literal key. Never panics.
- `i18n_test.go` covers parsing, fallbacks, sprintf, and a parity check that every key exists in both locales.

**What's migrated so far** (Phase 1):
- Frontend: Layout (sidebar nav, breadcrumbs, topbar search), `Login`, `ThemeToggle`, `NotificationBell`, `CommandPalette`, `SessionExpiryBanner`, `App.tsx` lazy-load fallback, `lib/notify.ts` relative time.
- Backend: 5 error responses in `api.go` (`api.skill_md_*`, `api.need_author_or_member`, `api.namespace_exists`) and 2 in `dist_tags_subs.go` (`api.need_author_or_maintainer`).

**What's deferred** (Phase 2+):
- Pages still in zh-CN: `Workspace`, `Browse`, `SkillDetail`, `Reviews`, `ReviewDetail`, `Audit`, `Admin`, `Profile`, `Editor` and most of `web/src/components/` (CreateSkillModal, AIAssistDrawer, WebhookPanel, etc.). These are migrated by adding new keys under the matching i18n namespace and replacing literal strings with `t('...')` — no architectural changes.
- `lib/audit.ts` action labels — straightforward dictionary replacement.
- Backend notification bodies in `store/queries.go`, `skill_lifecycle.go`, `me.go`, `ratings.go`, `subscriptions.go`, `reviewers.go`. These are persisted at write time, so translating them needs an architectural decision: either (a) add `users.preferred_lang` and translate at write time, or (b) store structured `kind + args_json` and render at read time on the client. Option (b) is cleaner — language switches retroactively re-render existing notifications — but requires a schema change. Until that's resolved, notifications stay zh-CN.
- `validate/validate.go` Check.Label / Check.Detail. Recommend moving these to the frontend keyed by `Check.ID` so the server only emits IDs and severities (similar to the discover.go achievements pattern that needs the same fix).
- Skill bundle templates (`templates/templates.go`, `editor/constants.ts`'s `TEMPLATE_GROUPS` content), seed data, and CLI strings — intentionally not translated. They're either bundle scaffolding or power-user surfaces.

To migrate a page, follow the pattern in `Layout.tsx`: add `const { t } = useTranslation()`, replace literals with `t('...')`, and add the keys to BOTH locale JSONs (the test in `server/internal/i18n/i18n_test.go::TestTables_ParityBetweenLocales` enforces parity on the server side; the frontend has no equivalent guard yet).

## Tests

Tests live in `server/internal/store/`:
- `platform_features_test.go` — original store tests (policy snapshot freeze, activation, etc.)
- `new_features_test.go` — tests added for `RecordActivation`, `ChangePassword`, `UpdateSkillMeta`, and admin user management

All tests use a real on-disk SQLite under `t.TempDir()`. Helper `seedBasicWorld()` creates a namespace + users + skill; `seedUserWithPassword()` creates a user with a real bcrypt hash for auth tests.

To run a specific test:
```bash
cd server && go test ./internal/store/ -run TestRecordActivation -v
cd server && go test ./internal/store/ -run TestChangePassword -v
cd server && go test ./internal/store/ -run TestAdminUpdateUser -v
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
