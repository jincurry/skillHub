# SkillHub backend

Go + Gin + SQLite (modernc.org/sqlite, pure Go — no CGO).

## Run

```bash
cd server
export PATH=$HOME/.local/go/bin:$PATH
go mod tidy
go run ./cmd/api
# → http://localhost:8080
```

DB file lives at `./skillhub.db` (auto-created with seed data on first run).
Uploaded avatars live under `./data/avatars/` and are served publicly at
`/api/v1/avatars/*`.

## Config (env vars)

| var | default | meaning |
|---|---|---|
| `SKILLHUB_ADDR`       | `:8080` | bind address |
| `SKILLHUB_DB`         | `./skillhub.db` | SQLite file path |
| `SKILLHUB_USER`       | `alice` | fallback user when a handler sees no JWT subject (dev only) |
| `SKILLHUB_JWT_SECRET` | `skillhub-dev-secret-change-me` | HMAC secret for signing / verifying login JWTs — **override in production** |

JWT lifetime is hard-coded to 24h in `internal/config`.

## Layout

```
cmd/api/main.go         # entrypoint
internal/config         # env config
internal/auth           # JWT sign/verify
internal/store          # sqlite wrapper + migrations + seed
internal/api            # gin handlers
internal/model          # request/response types
internal/policy         # review-policy defaults
internal/validate       # skill.yaml / bundle validation rules
```

## Auth model

- `POST /api/v1/auth/login` returns `{ token, user }`. The token is a
  24h HS256 JWT whose subject is the username.
- All `/api/v1/*` endpoints other than `/auth/login` and `/avatars/*`
  require `Authorization: Bearer <token>`.
- Admin-only endpoints additionally require `users.is_admin = 1` on the
  authenticated user (`requireAdmin` middleware).

## Endpoints (v1)

### Public

- `GET  /healthz`
- `POST /api/v1/auth/login` — `{username, password}` → `{token, user}`
- `GET  /api/v1/avatars/*` — static files

### Me / profile

- `GET    /api/v1/me`
- `PATCH  /api/v1/me`
- `GET    /api/v1/me/stats`
- `GET    /api/v1/me/achievements`
- `GET    /api/v1/me/drafts`
- `GET    /api/v1/me/notifications`
- `POST   /api/v1/me/notifications/read` — `{ids?: number[], all?: bool}`
- `GET    /api/v1/me/subscriptions`
- `POST   /api/v1/me/avatar` — multipart, field `avatar` (≤ 2 MiB)
- `DELETE /api/v1/me/avatar`

### Search

- `GET /api/v1/search?q=` — returns 3 buckets for the ⌘K palette

### Namespaces

- `GET    /api/v1/namespaces`
- `POST   /api/v1/namespaces` — `{id, owner?}`
- `GET    /api/v1/namespaces/:ns/members`
- `POST   /api/v1/namespaces/:ns/members` — `{username, role}` (owner / admin)
- `PATCH  /api/v1/namespaces/:ns/members/:username` — `{role}`
- `DELETE /api/v1/namespaces/:ns/members/:username`
- `GET    /api/v1/namespaces/:ns/policy?classification=L2`

### Skills

- `GET    /api/v1/skills` — filters: `ns`, `classification`, `status`, `q`
- `POST   /api/v1/skills` — create draft (member of ns)
- `GET    /api/v1/skills/:ns/:name`
- `DELETE /api/v1/skills/:ns/:name` — author-only; draft status only
- `GET    /api/v1/skills/:ns/:name/validate`
- `POST   /api/v1/skills/:ns/:name/submit` — submit for review (supports hotfix channel)
- `GET    /api/v1/skills/:ns/:name/versions`
- `GET    /api/v1/skills/:ns/:name/trend?days=30`
- `GET    /api/v1/skills/:ns/:name/ratings`
- `POST   /api/v1/skills/:ns/:name/ratings` — `{stars, comment?}`
- `POST   /api/v1/skills/:ns/:name/yank` — `{reason}` (owner / maintainer)
- `POST   /api/v1/skills/:ns/:name/deprecate` — `{reason?}` (owner / maintainer)
- `POST   /api/v1/skills/:ns/:name/draft` — `{version?}` start a new draft from a published skill
- `GET    /api/v1/skills/:ns/:name/bundle[?tag=|?version=]` — streams `.tar.gz`

### Skill files

- `GET    /api/v1/skills/:ns/:name/files`
- `GET    /api/v1/skills/:ns/:name/files/*path`
- `PUT    /api/v1/skills/:ns/:name/files/*path` — `{content}`
- `DELETE /api/v1/skills/:ns/:name/files/*path`
- `POST   /api/v1/skills/:ns/:name/rename-file` — `{from, to}`

> `skill.yaml`, `SKILL.md`, `README.md` are pinned and cannot be deleted or renamed.

### Dist tags (`latest` / `stable` / `beta` / custom)

- `GET    /api/v1/skills/:ns/:name/tags`
- `PUT    /api/v1/skills/:ns/:name/tags/:tag` — `{version}`
- `DELETE /api/v1/skills/:ns/:name/tags/:tag`

### Subscriptions

- `POST   /api/v1/skills/:ns/:name/subscribe`
- `DELETE /api/v1/skills/:ns/:name/subscribe`
- `GET    /api/v1/skills/:ns/:name/subscription`

### Reviews

- `GET    /api/v1/reviews?status=`
- `GET    /api/v1/reviews/stats`
- `GET    /api/v1/reviews/:id`
- `POST   /api/v1/reviews/:id/decision` — `{decision: "approve"|"reject", note?}`
- `GET    /api/v1/reviews/:id/comments`
- `POST   /api/v1/reviews/:id/comments` — `{body}`
- `GET    /api/v1/reviews/:id/files` — diff-style snapshot per file
- `POST   /api/v1/reviews/:id/reviewers` — `{username}` (author / reviewer / ns owner / ns maintainer / admin)
- `DELETE /api/v1/reviews/:id/reviewers/:username`

### Audit

- `GET /api/v1/audit-logs?actor=&action=&target=&q=&limit=100`

### AI assist

- `GET  /api/v1/ai/providers` — providers visible to the current user
- `POST /api/v1/ai/skills/:ns/:name/assist` — streaming assist for an editable skill

### Admin (requires `users.is_admin = 1`)

AI providers:

- `GET    /api/v1/admin/ai-providers`
- `POST   /api/v1/admin/ai-providers`
- `PATCH  /api/v1/admin/ai-providers/:id`
- `DELETE /api/v1/admin/ai-providers/:id`
- `POST   /api/v1/admin/ai-providers/:id/test`

Namespace review policies (per classification):

- `GET    /api/v1/admin/namespaces/:ns/policies`
- `PUT    /api/v1/admin/namespaces/:ns/policies/:classification`
- `DELETE /api/v1/admin/namespaces/:ns/policies/:classification` — reset to default

Hard deletes (escape hatches):

- `DELETE /api/v1/admin/namespaces/:ns` — only when empty
- `DELETE /api/v1/admin/skills/:ns/:name`

Platform metrics:

- `GET /api/v1/admin/metrics`
