# SkillHub · Backend

Go + Gin + SQLite (`modernc.org/sqlite`, pure Go — no CGO).

## Run

```bash
cd server
go mod tidy
go run ./cmd/api
# → http://localhost:8080
```

DB file lives at `./skillhub.db` (auto-created with seed data on first run).  
Uploaded avatars live under `./data/avatars/` and are served publicly at `/api/v1/avatars/*`.

## Config (env vars)

| Var | Default | Notes |
|---|---|---|
| `SKILLHUB_ADDR` | `:8080` | bind address |
| `SKILLHUB_DB` | `./skillhub.db` | SQLite file path |
| `SKILLHUB_JWT_SECRET` | `skillhub-dev-secret-change-me` | HMAC-SHA256 secret — **must change in production** |
| `SKILLHUB_USER` | `alice` | fallback user when no JWT is present (dev only) |

JWT lifetime is hard-coded to 24 h in `internal/config`.

## Layout

```
cmd/api/main.go              entrypoint
internal/config/             env config
internal/auth/               HS256 JWT sign/verify + bcrypt helpers
internal/store/              SQLite wrapper — all DB access lives here
  schema.go                    full DDL (CREATE TABLE IF NOT EXISTS)
  store.go                     Open() — runs ALTER TABLE backfills on upgrade
  seed.go                      first-run demo data (6 users, 7 ns, 9 skills …)
  queries.go                   skill/review list queries + SkillFilter
  me.go                        profile, password, skill-meta, namespace helpers
  users.go                     admin user management
  activations.go               RecordActivation + calcDelta (7-day hot ranking)
  platform_features_test.go    store-layer tests
  new_features_test.go         tests for features added post-MVP
internal/api/
  api.go                       Gin route registration + all HTTP handlers
  ai.go                        AI-assist proxy + SSE streaming
  dist_tags_subs.go            dist-tag + subscription handlers
  policies.go                  namespace-policy admin handlers
internal/model/model.go        request/response structs shared by api + store
internal/policy/policy.go      default L1/L2/L3 + hotfix policies
internal/validate/validate.go  6-check bundle validator
```

## Auth model

Two token types are accepted by the `Authorization: Bearer <token>` middleware:

| Type | Issued by | Format | Disabled-user check |
|---|---|---|---|
| **JWT** | `POST /api/v1/auth/login` | HS256, 24 h TTL | at login time |
| **PAT** | `POST /api/v1/me/tokens` | `skillhub_<random>` prefix | on every request |

Admin-only endpoints additionally require `users.is_admin = 1` (`requireAdmin` middleware).

## API Reference (v1)

All authenticated routes require `Authorization: Bearer <token>`.

### Public

```
GET  /healthz
POST /api/v1/auth/login          {username, password} → {token, user}
GET  /api/v1/avatars/*           static file serve
```

### Me / profile

```
GET    /api/v1/me
PATCH  /api/v1/me                {display?, email?, bio?, location?,
                                  coverPreset?, coverFrom?, coverTo?}
PATCH  /api/v1/me/password       {oldPassword, newPassword}
GET    /api/v1/me/stats
GET    /api/v1/me/achievements
GET    /api/v1/me/drafts
GET    /api/v1/me/notifications
POST   /api/v1/me/notifications/read   {ids?: number[], all?: bool}
GET    /api/v1/me/subscriptions
POST   /api/v1/me/avatar         multipart; field "avatar" ≤ 2 MiB
DELETE /api/v1/me/avatar
```

### Personal Access Tokens (PAT)

PATs are machine tokens for CI/automation. They carry the same permissions as the issuing user and are blocked immediately when the user account is disabled.

```
GET    /api/v1/me/tokens
POST   /api/v1/me/tokens         {name, expiresInDays?} → {token (shown once), …}
DELETE /api/v1/me/tokens/:id
```

### Search

```
GET /api/v1/search?q=            returns {skills, users, namespaces} buckets (⌘K palette)
```

### Namespaces

```
GET    /api/v1/namespaces
POST   /api/v1/namespaces        {id, owner?}
GET    /api/v1/namespaces/:ns/members
POST   /api/v1/namespaces/:ns/members        {username, role}  (owner / admin)
PATCH  /api/v1/namespaces/:ns/members/:u     {role}
DELETE /api/v1/namespaces/:ns/members/:u
GET    /api/v1/namespaces/:ns/policy?classification=L2
```

### Skills

```
GET    /api/v1/skills                    filters: ns, classification, status, q, limit, offset
POST   /api/v1/skills                    create draft (ns member)
GET    /api/v1/skills/:ns/:name
PATCH  /api/v1/skills/:ns/:name          {description?, classification?, tags?,
                                          icon?, iconClass?, longDesc?}
                                         author or ns owner/maintainer
DELETE /api/v1/skills/:ns/:name          author only; draft status only
GET    /api/v1/skills/:ns/:name/validate
POST   /api/v1/skills/:ns/:name/submit   {version, note?, isHotfix?, hotfixReason?}
GET    /api/v1/skills/:ns/:name/versions
GET    /api/v1/skills/:ns/:name/trend?days=30
GET    /api/v1/skills/:ns/:name/ratings
POST   /api/v1/skills/:ns/:name/ratings  {stars, comment?}
POST   /api/v1/skills/:ns/:name/yank     {reason}  (owner / maintainer)
POST   /api/v1/skills/:ns/:name/deprecate  {reason?}  (owner / maintainer)
POST   /api/v1/skills/:ns/:name/draft    {version?}  start new draft from published
POST   /api/v1/skills/:ns/:name/activate {count?}   record N activations (default 1, max 1000)
                                         updates activations counter + daily metrics +
                                         recomputes delta_pct / hot flag in one transaction
GET    /api/v1/skills/:ns/:name/bundle[?tag=|?version=]   streams .tar.gz
```

### Skill files

```
GET    /api/v1/skills/:ns/:name/files
GET    /api/v1/skills/:ns/:name/files/*path
PUT    /api/v1/skills/:ns/:name/files/*path   {content}
DELETE /api/v1/skills/:ns/:name/files/*path
POST   /api/v1/skills/:ns/:name/rename-file   {from, to}
```

> `skill.yaml`, `SKILL.md`, `README.md` are pinned — they cannot be deleted or renamed.

### Dist tags

`latest` is auto-managed by the approve flow. `stable` / `beta` / custom tags are set manually by owners/maintainers. `latest` cannot be manually deleted.

```
GET    /api/v1/skills/:ns/:name/tags
PUT    /api/v1/skills/:ns/:name/tags/:tag    {version}
DELETE /api/v1/skills/:ns/:name/tags/:tag
```

### Subscriptions

```
POST   /api/v1/skills/:ns/:name/subscribe
DELETE /api/v1/skills/:ns/:name/subscribe
GET    /api/v1/skills/:ns/:name/subscription    → {subscribed, count}
GET    /api/v1/me/subscriptions
```

### Reviews

```
GET  /api/v1/reviews?status=&limit=&offset=
GET  /api/v1/reviews/stats
GET  /api/v1/reviews/:id
POST /api/v1/reviews/:id/decision    {decision: "approve"|"reject"|"request_changes", note?}
GET  /api/v1/reviews/:id/comments
POST /api/v1/reviews/:id/comments   {body}
GET  /api/v1/reviews/:id/files       diff-style snapshot per file
POST /api/v1/reviews/:id/reviewers   {username}
DELETE /api/v1/reviews/:id/reviewers/:username
```

### Webhooks

```
GET    /api/v1/webhooks
POST   /api/v1/webhooks              {url, events[], secret?}
GET    /api/v1/webhooks/:id
PATCH  /api/v1/webhooks/:id          {url?, events?, active?, secret?}
DELETE /api/v1/webhooks/:id
GET    /api/v1/webhooks/:id/deliveries
POST   /api/v1/webhooks/:id/ping
```

### Audit

```
GET /api/v1/audit-logs?actor=&action=&target=&q=&limit=100
```

### AI assist

```
GET  /api/v1/ai/providers                   providers visible to current user
POST /api/v1/ai/skills/:ns/:name/assist     streaming SSE assist for an editable skill
                                            {providerId, action, currentContent, filePath, …}
```

### Admin (requires `users.is_admin = 1`)

**AI providers**
```
GET    /api/v1/admin/ai-providers
POST   /api/v1/admin/ai-providers           {name, baseURL, apiKey, model, isDefault?}
PATCH  /api/v1/admin/ai-providers/:id
DELETE /api/v1/admin/ai-providers/:id
POST   /api/v1/admin/ai-providers/:id/test
```

**Namespace review policies**
```
GET    /api/v1/admin/namespaces/:ns/policies
PUT    /api/v1/admin/namespaces/:ns/policies/:classification   override policy
DELETE /api/v1/admin/namespaces/:ns/policies/:classification   reset to default
```

**User management**
```
GET   /api/v1/admin/users
POST  /api/v1/admin/users        {username, password, display?, role?, team?, email?, isAdmin?}
PATCH /api/v1/admin/users/:u     {display?, role?, team?, email?, isAdmin?, isDisabled?, password?}
```

Disabling a user (`isDisabled: true`) immediately blocks both JWT login and PAT-based requests for that account.

**Hard deletes / escape hatches**
```
DELETE /api/v1/admin/namespaces/:ns        only when ns has no skills
DELETE /api/v1/admin/skills/:ns/:name
```

**Platform metrics**
```
GET /api/v1/admin/metrics
```

## Key design notes

**Schema management** — No migration files. `store/schema.go` has full `CREATE TABLE IF NOT EXISTS` DDL. `store/store.go`'s `Open()` runs `ALTER TABLE … ADD COLUMN` backfills for columns added after the initial schema. SQLite is capped to a single writer (`SetMaxOpenConns(1)`).

**Approval flow** — `SubmitDraftForReview` snapshots the policy as JSON into `reviews.policy_snapshot` at submit time, so later admin edits don't affect in-flight reviews. `DecideReview("approve")` upserts the `latest` dist tag and fans out notifications in the same transaction.

**Activation tracking** — `POST /skills/:ns/:name/activate` atomically increments `skills.activations` and upserts today's row in `skill_daily_metrics`, then recomputes `delta_pct` (7-day vs prior 7-day) and the `hot` flag (delta > 20%) from the last 14 days of daily data. No cron job needed.

**Hotfix channel** — `isHotfix: true` on submit uses `policy.HotfixPolicy` (1 reviewer, 4 h SLA, owner/maintainer only). The reason is required and written to `audit_logs` as `hotfix_submit`.

**Validation** — `validate.Run()` checks: YAML schema, naming conventions, secret scan, classification tag coverage, description completeness. Any `err`-severity check blocks `submit` with HTTP 422.

**Tests**
```bash
cd server
go test ./internal/store/ -v          # all store tests
go test ./internal/store/ -run TestRecordActivation -v
```
