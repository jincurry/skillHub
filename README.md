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
- **认证**：两种令牌类型（均通过 `Authorization: Bearer <token>` 传递）：
  - **JWT**：`POST /api/v1/auth/login` 颁发 HS256 JWT，TTL 24h；密码 bcrypt 存储
  - **PAT**（个人访问令牌）：`POST /api/v1/me/tokens` 创建，格式 `skillhub_<random>`，适合 CI/自动化；用户被禁用时立即失效
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
auth/login                          POST  公开，颁发 JWT

me                                  GET / PATCH  当前用户信息
me/password                         PATCH  修改密码 {oldPassword, newPassword}
me/stats                            GET   我的统计
me/achievements                     GET   我的成就
me/notifications                    GET   通知列表
me/notifications/read               POST  标记已读
me/drafts                           GET   我的草稿
me/subscriptions                    GET   我关注的 skill 列表
me/avatar                           POST / DELETE  头像上传
me/tokens                           GET / POST / DELETE  个人访问令牌 (PAT)

namespaces                          GET   列表
namespaces/:ns/members              GET / POST / PATCH / DELETE  成员管理
namespaces/:ns/policy               GET   按密级预览审批策略

skills                              GET   列表（filter: ns, classification, status, q）
skills                              POST  新建草稿
skills/:ns/:name                    GET   详情
skills/:ns/:name                    PATCH  更新元信息 {description?, classification?, tags?, …}
skills/:ns/:name                    DELETE  删除（仅草稿，仅作者）
skills/:ns/:name/validate           GET   触发校验
skills/:ns/:name/submit             POST  提交评审（body 可带 isHotfix + hotfixReason）
skills/:ns/:name/versions           GET   版本列表
skills/:ns/:name/trend              GET   趋势数据（?days=30）
skills/:ns/:name/ratings            GET / POST  评分
skills/:ns/:name/yank               POST  紧急下架（必填 reason）
skills/:ns/:name/deprecate          POST  标记弃用
skills/:ns/:name/draft              POST  从已发布版本开始新草稿
skills/:ns/:name/activate           POST  记录 N 次激活（{count?}，默认1，最大1000）
                                          原子更新 activations / 日指标 / delta_pct / hot 标志
skills/:ns/:name/bundle             GET   下载 tar.gz（?tag=latest|stable|... 或 ?version=x.y.z）

skills/:ns/:name/files              GET   文件列表
skills/:ns/:name/files/*path        GET / PUT / DELETE  文件读写删
skills/:ns/:name/rename-file        POST  重命名文件（pinned 文件禁止）

skills/:ns/:name/tags               GET   dist tags 列表
skills/:ns/:name/tags/:tag          PUT   {version} 设置/修改 tag
skills/:ns/:name/tags/:tag          DELETE  删除 tag（latest 不可删，由发布流程自动维护）

skills/:ns/:name/subscribe          POST / DELETE  关注 / 取消关注
skills/:ns/:name/subscription       GET   {subscribed, count}

reviews                             GET   列表（filter: status）
reviews/stats                       GET   统计
reviews/:id                         GET   详情（含 isHotfix, hotfixReason, policySnapshot）
reviews/:id/decision                POST  approve / reject / request_changes
reviews/:id/comments                GET / POST  评论
reviews/:id/files                   GET   diff 快照（每个文件前后对比）
reviews/:id/reviewers               POST / DELETE  手动指派/移除 reviewer

webhooks                            GET / POST  webhook 列表 / 创建
webhooks/:id                        GET / PATCH / DELETE  webhook 管理
webhooks/:id/deliveries             GET   投递历史
webhooks/:id/ping                   POST  测试 ping

search                              GET   ?q= 全局搜索（skills, users, namespaces）

audit-logs                          GET   审计流（?actor=&action=&target=&q=）

ai/providers                        GET   可用 AI provider 列表
ai/skills/:ns/:name/assist          POST  SSE 流式 AI 辅助

admin/ai-providers                  GET / POST / PATCH / DELETE  AI provider 管理
admin/ai-providers/:id/test         POST  测试连接
admin/namespaces/:ns/policies       GET  namespace 审批策略
admin/namespaces/:ns/policies/:cls  PUT / DELETE  覆盖/重置策略
admin/namespaces/:ns               DELETE  删除 namespace（须无 skills）
admin/skills/:ns/:name             DELETE  强制删除 skill
admin/users                         GET / POST  用户列表 / 创建
admin/users/:u                      PATCH  修改用户（含禁用账号）
admin/metrics                       GET   平台统计指标

healthz                             GET   健康检查
```

### 平台特性

- **策略快照**：`reviews.policy_snapshot` 在 submit 时冻结 JSON，审批中 admin 修改 namespace policy 不会影响在途请求。
- **Hotfix 通道**：`isHotfix=true` 切换到 `policy.HotfixPolicy`（1 审批人 / 4h SLA），仅限 namespace owner / maintainer，必填 `hotfixReason` 并写 `audit_logs.hotfix_submit`。
- **订阅 + 发布通知**：`DecideReview(approve)` 同事务里 `fanOutPublishNotifTx` 给所有订阅者（排除 author + actor）写站内通知。
- **Dist tags**：`skill_dist_tags` 表；`latest` 由 approve 同事务自动 upsert，`stable` / `beta` / 自定义由 owner / maintainer 手动维护；`/bundle?tag=` 解析后从 `review_files` 拿对应版本的快照。
- **激活追踪**：`POST /skills/:ns/:name/activate` 原子递增 `skills.activations`，upsert 当天 `skill_daily_metrics`，计算 7 日对比 `delta_pct` 和 `hot`（delta > 20%）。无需 cron job。
- **PAT 安全**：PAT 认证每次请求都检查 `users.is_disabled`，账号被禁用后立即失效（JWT 只在登录时检查）。

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
  /admin               Admin（管理后台，仅 is_admin=1 用户可访问）
  /profile             Profile（个人统计、头像、封面）
  ```

- **权限保护**：
  - `RequireAuth`：所有登录后路由，401/无 token → 跳 `/login`
  - `RequireAdmin`：`/admin` 路由额外检查 `isAdmin` 标志，非管理员 → 跳 `/workspace`

- **会话管理**：`SessionExpiryBanner` 在 JWT 到期前 5 分钟弹出底部横幅，实时倒计时提醒用户重新登录。

- **API 客户端**：`web/src/api/client.ts`，所有响应类型在 `web/src/api/types.ts`。401 时通过 `setUnauthorizedHandler` 跳回登录页（`main.tsx` 注册）。

- **构建产物**：

  ```bash
  cd web && npm run build       # → web/dist/
  ```

- **开发代理**：`vite.config.ts` 把 `/api/*` 反代到 `localhost:8080`，所以前端只用相对路径调用。

### Skill 编辑器（Editor）

`/skills/:ns/:name/edit` 是核心创作界面，功能包括：

- **Monaco 多 model**：每个文件对应独立 Monaco model，切 tab 调 `editor.setModel()` 并保留滚动/光标位置。
- **Cmd/Ctrl+P 文件搜索**：模糊搜索文件名，方向键 + Enter 跳转，覆盖 Monaco 默认的命令面板。
- **Token 预算**：Bundle Structure 侧边栏底部实时显示所有文件的 token 估算总量（CJK ~0.67/字符，ASCII ~0.25/字符），颜色警示阈值。
- **版本 + 标签表单**：Frontmatter 侧边栏包含 version 输入框和 chip 风格标签编辑器（Enter/逗号添加，Backspace 删除最后一个）。
- **文件上传**：新建文件对话框支持切换「模板」/ 「本地上传」，可多选文件一次性导入。
- **全局放弃**：顶部栏有「放弃全部修改」按钮（有脏文件时显示），清除所有 localStorage 草稿并从服务器重新加载。
- **提交 diff 预览**：提交评审模态框中每个修改过的文件旁有「查看变更」，展示 LCS diff（±行高亮，上下文折叠）。

---

## CLI

源码：`server/cmd/cli/`（cobra + `golang.org/x/term`，纯 HTTP 客户端复用 REST API）。

```bash
cd server
go build -o skillhub ./cmd/cli
./skillhub auth login                       # 输入用户名密码，写 ~/.config/skillhub/config.json
./skillhub auth token create ci --save      # 创建 PAT 并写回 config（适合 CI）
./skillhub skill list --json
./skillhub skill pull platform-team/k8s-debug ./bundle    # 拉取文件到本地
./skillhub skill push platform-team/k8s-debug ./bundle    # 同步本地修改
./skillhub skill validate platform-team/k8s-debug
./skillhub skill submit platform-team/k8s-debug -v 1.5.1 --hotfix --hotfix-reason "patch CVE"
./skillhub skill activate platform-team/k8s-debug --count 3
./skillhub review list
./skillhub review approve 12 -n "LGTM"
./skillhub ns list
```

命令组：

| 组 | 子命令 |
|---|---|
| `auth` | `login` / `logout` / `whoami` / `token create|list|delete` |
| `skill` | `list` / `get` / `pull` / `push` / `validate` / `submit` / `activate` |
| `review` | `list` / `show` / `approve` / `reject` |
| `ns` | `list` / `members` |

所有列表命令支持 `--json` 输出，便于管道处理。配置路径可用 `SKILLHUB_CONFIG` 环境变量覆盖。

---

## 一些细节

- **首次启动**：`server/skillhub.db` 不存在 → 自动建表 + 注入 6 用户 / 7 namespace / 9 skill / 5 review / 4 通知 / 5 audit。
- **重置数据**：`rm server/skillhub.db*` 然后重启即可。
- **生产前必做**：换 `SKILLHUB_JWT_SECRET`、加 HTTPS（Nginx / 网关）、规划 SQLite 备份或迁移到 Postgres（schema 风格已尽量 Postgres 友好）。
- **没实现的（按设计文档 P1-P4）**：IM 集成、沙箱 Playground、灰度 / Federation 等扩展能力。MVP 聚焦「Web 唯一入口 + 完整审批流 + 审计治理 + AI 辅助 + CLI」。

---

## 构建与校验

```bash
# 后端
cd server && go vet ./... && go build ./...

# 前端
cd web && npm run build
```

两侧都通过即可推送。
