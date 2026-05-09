# skillHub

> 企业级 Skill 全生命周期管理 Web 平台 — 创建 / 评审 / 发布 / 监控 / 下线，全部在浏览器里完成。

完整设计文档见 [`design/design.md`](design/design.md)。

---

## 仓库结构

```
skillHub/
├── design/         # 完整设计方案（含 MVP 范围与扩展规划）
├── prototype/      # 静态 UI 原型（独立 jsx，无构建链路）
├── server/         # Go + Gin + SQLite 后端
└── web/            # React + TS + Vite + Tailwind 前端
```

| 目录 | 角色 |
|---|---|
| `design/design.md` | 平台定位、领域模型、审批流、数据库 schema、API、MVP 与扩展规划 |
| `prototype/*.jsx` | 设计稿对应的可点 UI 原型（用 `prototype/index.html` 直接打开） |
| `server/` | 单体 API，纯 Go（`modernc.org/sqlite`，无 CGO），自带迁移与种子数据 |
| `web/` | SPA，命中 `/api` 时反代到后端 :8080 |

---

## 快速开始

需要：**Go 1.25+**、**Node 18+**、**npm**。

### 1. 启后端

```bash
cd server
go mod tidy
go run ./cmd/api
# → http://localhost:8080  (db=./skillhub.db, 首次启动自动建表 + 种子)
```

### 2. 启前端（另一个终端）

```bash
cd web
npm install
npm run dev
# → http://localhost:5173
```

打开 http://localhost:5173 ，从下表挑一个账号登录（密码统一是 `password`）：

| 用户名 | 角色 | 主要 namespace |
|---|---|---|
| `alice` | Maintainer / 全能管理员 | platform-team owner、frontend-team owner |
| `bob` | Maintainer | sre-team owner、platform-team maintainer |
| `frank` | Maintainer | data-team owner、product-team owner |
| `charlie` | Reviewer | security-team owner |
| `diana` | Member | finance-team owner、frontend-team maintainer |

---

## 端到端 Demo（≈ 5 分钟）

1. **alice 登录**，进入 Workspace 看到 KPI、待我审、我的草稿。
2. **创建 Skill**：Browse 页 → 右上角 `+ 新建` → 选 `platform-team`、密级 `L2`，状态先停在 `draft`。
3. 进入 **Editor**，Monaco 编辑 SKILL 文件 → 点 **校验**（运行 schema / 命名 / Secret / 标签 / 描述 6 项检查） → 没有 `error` 则可 **提交评审**。
4. **提交**时按密级走默认策略：L1 单审、L2 双审（owner+reviewer）、L3 三审（含安全岗）。Reviewer 由策略自动从 namespace 成员里挑，禁止自审。
5. **bob 登录**，Reviews 列表里能看到指派给自己的待审；进入 ReviewDetail 写 comment、`approve` / `reject` / `request_changes`。
6. 全部 reviewer 通过后版本进 `approved` → 发布 → Skill 详情页可看到 `published` 状态。
7. **alice 回来**，对该 skill 可执行 `yank`（必填 reason） / `deprecate` 生命周期操作；任何写动作都落到 **Audit** 页。

---

## 后端

详见 [`server/README.md`](server/README.md)。要点：

- **栈**：Go 1.25 + Gin + `modernc.org/sqlite`（pure Go，无 CGO）
- **认证**：`POST /api/v1/auth/login` 颁发 HS256 JWT（自实现，无第三方依赖），TTL 24h；密码 bcrypt 存储；后续请求 `Authorization: Bearer …`
- **配置**（环境变量）：

  | var | default | 说明 |
  |---|---|---|
  | `SKILLHUB_ADDR` | `:8080` | 监听地址 |
  | `SKILLHUB_DB` | `./skillhub.db` | SQLite 文件 |
  | `SKILLHUB_JWT_SECRET` | `skillhub-dev-secret-change-me` | JWT 密钥（**生产必改**） |
  | `SKILLHUB_USER` | `alice` | 兜底身份（仅当请求未携带 token 且关闭中间件时使用） |

- **数据库**：单 SQLite 文件，启动时执行 `schema.go` 内联建表 + `seed.go` 注入演示数据，启用 WAL；`server/skillhub.db*` 默认 gitignore。
- **审批策略**：硬编码在 `internal/policy/policy.go`，按 L1/L2/L3 给出 mode + slaHours + slots。`PickReviewersByPolicy` 根据每个 slot 的 role 优先级在 namespace 成员里挑人，应用 no-self-approval 规则。
- **Validation**：`internal/validate/validate.go` 跑 6 项检查（schema、命名、Secret 扫描、密级策略、标签覆盖、描述完整度），任意 `err` 阻塞 submit。

后端关键路由（全部前缀 `/api/v1`）：

```
auth/login                      POST  公开，颁发 JWT

me                              GET   当前用户
me/notifications                GET   通知列表
me/notifications/read           POST  标记已读
me/drafts                       GET   我的草稿

namespaces                      GET   列表
namespaces/:ns/members          GET   成员列表
namespaces/:ns/policy           GET   按密级预览审批策略

skills                          GET   列表（filter: ns, classification, status, q）
skills                          POST  新建草稿
skills/:ns/:name                GET   详情
skills/:ns/:name/validate       GET   触发校验
skills/:ns/:name/submit         POST  提交评审（自动挑 reviewer）
skills/:ns/:name/versions       GET   版本列表
skills/:ns/:name/ratings        GET/POST  评分
skills/:ns/:name/yank           POST  紧急下架（必填 reason）
skills/:ns/:name/deprecate      POST  标记弃用

reviews                         GET   列表（filter: status）
reviews/:id                     GET   详情
reviews/:id/decision            POST  approve / reject / request_changes
reviews/:id/comments            GET/POST  评论

audit-logs                      GET   审计流
healthz                         GET   健康检查
```

---

## 前端

- **栈**：React 18 + TypeScript 5 + Vite 5 + Tailwind 3 + react-router-dom 6 + `@monaco-editor/react`
- **路由**（全部走 `RequireAuth`，未登录跳 `/login`）：

  ```
  /workspace           Workspace（KPI、待办、最近活动）
  /skills              Browse（搜索、过滤、grid/list 切换）
  /skills/:ns/:name    SkillDetail（信息、评分、版本、操作按钮）
  /skills/:ns/:name/edit   Editor（Monaco + validation 面板）
  /reviews             Reviews（按 status / urgency 排）
  /reviews/:id         ReviewDetail（评论 + 决策）
  /audit               Audit（审计流）
  /admin               Admin（namespace、成员、策略预览）
  /profile             Profile（个人统计）
  ```

- **API 客户端**：`web/src/api/client.ts`，所有响应类型在 `web/src/api/types.ts`。401 时通过 `setUnauthorizedHandler` 跳回登录页（`main.tsx` 注册）。
- **构建产物**：

  ```bash
  cd web && npm run build       # → web/dist/
  ```

- **开发代理**：`vite.config.ts` 把 `/api/*` 反代到 `localhost:8080`，所以前端只用相对路径调用。

---

## 一些细节

- **首次启动**：`server/skillhub.db` 不存在 → 自动建表 + 注入 6 用户 / 7 namespace / 9 skill / 5 review / 4 通知 / 5 audit。
- **重置数据**：`rm server/skillhub.db*` 然后重启即可。
- **生产前必做**：换 `SKILLHUB_JWT_SECRET`、加 HTTPS（Nginx / 网关）、规划 SQLite 备份或迁移到 Postgres（schema 风格已尽量 Postgres 友好）。
- **没实现的（按设计文档 P1-P4）**：CLI、IM 集成、AI 辅助、沙箱 Playground、灰度 / Federation 等扩展能力。MVP 聚焦「Web 唯一入口 + 完整审批流 + 审计治理」。

---

## 构建与校验

```bash
# 后端
cd server && go vet ./... && go build ./...

# 前端
cd web && npm run build
```

两侧都通过即可推送。
