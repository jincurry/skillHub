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

## Config (env vars)

| var | default | meaning |
|---|---|---|
| `SKILLHUB_ADDR` | `:8080` | bind address |
| `SKILLHUB_DB`   | `./skillhub.db` | SQLite file path |
| `SKILLHUB_USER` | `alice` | mock current user (until OIDC) |

## Layout

```
cmd/api/main.go         # entrypoint
internal/config         # env config
internal/store          # sqlite wrapper + migrations + seed
internal/api            # gin handlers
internal/model          # request/response types
```

## Endpoints (v1)

- `GET  /healthz`
- `GET  /api/v1/me`
- `GET  /api/v1/skills` — list (filter: ns, classification, status, q)
- `GET  /api/v1/skills/:ns/:name`
- `POST /api/v1/skills` — create draft
- `GET  /api/v1/namespaces`
- `GET  /api/v1/reviews?status=`
- `GET  /api/v1/reviews/:id`
- `POST /api/v1/reviews/:id/decision` — `{decision: "approve"|"reject", note?}`
- `POST /api/v1/reviews/:id/comments` — `{body}`
- `GET  /api/v1/audit-logs`
- `GET  /api/v1/me/notifications`
- `GET  /api/v1/me/drafts`
