# skillHub · 完整设计方案

> 企业级 Skill 生命周期管理 Web 平台
> 含 MVP 范围 + 完整扩展规划

---

# 第一部分 · 平台定位

## 1.1 是什么

skillHub 是一个 **Web 化的企业级 Skill 全生命周期管理平台**。组织内部的 AI Skill 在这里被创建、评审、发布、监控、维护、下线。

**核心三特征：**

1. **Web 唯一入口**：所有动作在浏览器完成，不依赖 CLI 或客户端工具
2. **审批流贯穿生命周期**：每个状态转换都可配置审批策略
3. **企业级治理**：完整的 RBAC、审计、合规、可追溯

## 1.2 不是什么

- 不是分发系统：不管 skill 怎么到达终端开发者本地（用户自己 download / git clone）
- 不是客户端工具：MVP 不做 CLI 和 Sync Agent
- 不是公共 marketplace：聚焦企业内部，不做对外发现

## 1.3 核心用户角色

| 角色 | 主要诉求 |
|---|---|
| **作者** Author | 在 Web 上写 skill、提交审批、迭代版本 |
| **审批人** Reviewer | 收到任务、看 diff、决策、留意见 |
| **使用者** Consumer | 浏览目录、查看详情、获取 skill |
| **维护者** Maintainer | 管 namespace、管成员、紧急 yank |
| **管理员** Admin | 全局配置、用户管理、审计 |

所有角色统一在 Web 入口，按权限看到不同视图。

---

# 第二部分 · 领域模型

## 2.1 核心对象关系

```
Organization
  └── Namespace (团队空间)
       └── Skill (逻辑 skill)
            └── Version (具体版本，不可变)
                 ├── Bundle (skill 文件包)
                 ├── Validation (验证结果)
                 ├── ReviewRequest (审批请求)
                 │    └── ReviewDecision (单个审批决策)
                 └── Release (发布记录)
            ├── Subscription (使用者订阅)
            ├── Feedback (反馈/评分)
            └── DeprecationPlan (下线计划)
```

## 2.2 Skill 完整生命周期

```
                        ┌──────────┐
                        │  CREATED │  作者建好元数据壳子
                        └─────┬────┘
                              │ 上传/编辑文件
                              ▼
                        ┌──────────┐
                        │  DRAFT   │  ◀─────┐
                        └─────┬────┘        │
                              │ 提交审批      │ Request Changes
                              ▼              │
                        ┌──────────┐        │
                        │ VALIDATING│  自动检查
                        └─────┬────┘        │
                              │ pass         │
                              ▼              │
                        ┌──────────┐        │
                        │ REVIEWING│ ───────┘
                        └─────┬────┘
                              │ 全部审批通过
                              ▼
                        ┌──────────┐
                        │ APPROVED │
                        └─────┬────┘
                              │ 发布
                              ▼
                        ┌──────────┐
                        │ PUBLISHED│ ◀───┐ 新版本流转回来
                        └─────┬────┘     │
                              │
                ┌─────────────┼─────────────┐
                │             │             │
            yank│         deprecate│      新版本
                ▼             ▼             │
           ┌─────────┐   ┌─────────────┐   │
           │ YANKED  │   │ DEPRECATED  │   │
           └─────────┘   └──────┬──────┘   │
                                │ 到期      │
                                ▼          │
                          ┌──────────┐     │
                          │ ARCHIVED │     │
                          └──────────┘     │
```

## 2.3 状态转换的权限与审批

| 转换 | 触发者 | 是否需要审批 |
|---|---|---|
| Created → Draft | 作者 | 否（上传文件即转） |
| Draft → Validating | 作者 | 否（自动） |
| Validating → Reviewing | 系统 | 否（验证通过自动） |
| **Reviewing → Approved** | **审批人组** | **是（核心审批流）** |
| Reviewing → Draft | 审批人 | 否（Request Changes） |
| Approved → Published | 系统/Maintainer | 否（可灰度） |
| Published → Yanked | Maintainer+ | 否（紧急动作，强制留 reason） |
| Published → Deprecated | Maintainer+ | 否（软退役） |
| Deprecated → Archived | 系统 | 否（到期自动） |

## 2.4 SKILL.md 规范

标准字段保持与 Anthropic 官方兼容（YAML frontmatter + Markdown body），企业扩展放在 `x-skillhub` 命名空间下。其他客户端会忽略未知字段，跨平台兼容。

```yaml
---
# 标准字段
name: go-code-review
description: "Review Go code for bugs, style and idiomatic patterns. Use when reviewing .go files or PRs."
version: "1.2.3"
license: "Proprietary"

# 企业扩展
x-skillhub:
  namespace: platform-team
  owner:
    team: platform-infra
    email: platform@corp.com
  
  classification: L2          # L1公开 / L2内部 / L3敏感
  visibility: org             # org / team / private
  
  lifecycle:
    stability: stable
    support_until: "2027-01-01"
  
  dependencies:
    skills:
      - "platform-team/go-lint@^1.0"
  
  tags: [go, review, quality]
---

# Go Code Review

## When to Use
...
## Instructions
...
```

---

# 第三部分 · 审批流核心设计

这是平台最关键的特性，单独详细设计。

## 3.1 审批策略模型

每个 namespace 可以配置自己的 ApprovalPolicy，按 skill 密级路由到不同审批者组合。

```yaml
ApprovalPolicy:
  namespace: platform-team
  
  global_constraints:
    no_self_approval: true        # 提交者不能审自己
    no_subordinate_approval: true # 不能审下属提交的
  
  rules:
    - classification: L1
      mode: parallel
      sla_hours: 24
      approver_slots:
        - slot: maintainer
          match: { role: maintainer }
          required_count: 1
    
    - classification: L2
      mode: parallel
      sla_hours: 48
      approver_slots:
        - slot: maintainer
          match: { role: maintainer }
          required_count: 1
        - slot: peer
          match: { role: contributor }
          required_count: 1
    
    - classification: L3
      mode: serial               # 串行审批
      sla_hours: 72
      approver_slots:
        - slot: maintainer
          required_count: 1
        - slot: security
          match: { team: security }
          required_count: 1
      block_on_security_concern: true  # security 阻止则整体阻止
```

## 3.2 关键设计：策略快照

提交审批时把当前 policy **快照**到 ReviewRequest 里。后续即使 policy 改了，已开的审批继续按原策略走。这样审批结果可追溯、可解释。

## 3.3 三种审批模式

| 模式 | 行为 | 适用场景 |
|---|---|---|
| **并行** | 所有审批人同时收到通知，各自决策 | 常规变更，效率优先 |
| **串行** | 前一人通过后下一人才被通知 | 敏感变更，先看技术再看安全 |
| **升级** | SLA 到期未审批，自动升级到上级 | L3+ 高密级变更 |

## 3.4 审批操作详解

**Approve（通过）：**
- 可选 comment
- 立即累计到 required_decisions
- 全部满足后自动进入 Approved

**Request Changes（要求修改）：**
- 必须填 comment
- 状态回滚到 Draft，作者可继续编辑
- 历史评论保留，迭代时审批人能看到上次意见

**Block（阻止发布）：**
- 必须填 reason，二次确认
- 整个审批立即终止，状态变 Rejected
- 作者必须创建新版本，不是简单回到 Draft
- 一般给 Security 用，对应严重安全问题

**Withdraw（作者撤回）：**
- 作者主动撤回，状态回 Draft
- 已有审批意见保留作为历史

## 3.5 紧急通道（Hotfix）

某些紧急场景（生产 bug、安全漏洞）需要绕过完整审批流：

- 仅 Maintainer+ 能发起，必须填 incident_id
- 跳过 peer review，由单个 Maintainer 直接发布
- **代价**：发布后 7 天内必须补完整审批，否则自动 yank
- 所有 hotfix 在仪表盘单独标记，季度复盘

---

# 第四部分 · 系统架构

## 4.1 总体架构

```
┌────────────────────────────────────────────────────────────────┐
│                      Web Frontend (React)                       │
│   作者工作台 │ 审批中心 │ Skill 浏览 │ 详情页 │ 编辑器 │ 管理后台 │
└──────────────────────────────┬─────────────────────────────────┘
                               │ HTTPS
                               ▼
┌────────────────────────────────────────────────────────────────┐
│                       Backend API Server                         │
│                          (Go + gin)                              │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              HTTP Layer (auth/ratelimit/audit)           │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────┬──────────┬──────────┬──────────┬───────────┐    │
│  │  Skill   │  Review  │  Notif   │   RBAC   │   Stats   │    │
│  │ Service  │ Service  │ Service  │ Service  │  Service  │    │
│  └──────────┴──────────┴──────────┴──────────┴───────────┘    │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │         Workflow Engine (状态机驱动 · Postgres 持久化)    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │   Validation Pipeline                                    │  │
│  │   Lint · Secret Scan · Size Check · Dependency Resolve   │  │
│  └──────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬─────────────────────────────────┘
                               │
       ┌───────────────────────┼─────────────────────────┐
       ▼                       ▼                         ▼
┌──────────────┐      ┌──────────────┐          ┌──────────────┐
│  PostgreSQL  │      │  Object Store│          │    Redis     │
│  (主存储)     │      │  (S3/MinIO)  │          │ (缓存/队列)   │
└──────────────┘      └──────────────┘          └──────────────┘
                               │
                               ▼
                  ┌────────────────────────┐
                  │   Async Worker         │
                  │  · Validation 执行      │
                  │  · 通知发送             │
                  │  · SLA 监控             │
                  │  · 定时聚合统计          │
                  └────────────────────────┘
```

## 4.2 架构特点

- **单体 Web + API**：企业内规模够用，不做微服务
- **Postgres 为核心**：所有结构化数据，全文搜索用 `tsvector`
- **对象存储**：只放 bundle 文件
- **Redis**：缓存、分布式锁、消息总线
- **异步任务**：Worker 进程（可与 API 同进程或独立）

## 4.3 与外部系统集成

```
┌──────────────┐
│  企业 SSO    │  ← 登录走 OIDC（Keycloak/Okta/Azure AD）
└──────────────┘
┌──────────────┐
│  邮件 SMTP   │  ← 审批通知
└──────────────┘
┌──────────────┐
│  IM 机器人    │  ← Slack / 飞书 / 钉钉
└──────────────┘
┌──────────────┐
│  HR 系统     │  ← 离职/调岗时同步权限
└──────────────┘
┌──────────────┐
│  对象存储     │  ← bundle 文件
└──────────────┘
```

## 4.4 部署形态

```
[ Load Balancer ]
        │
        ├──> Web Server x 2 (静态资源)
        │
        └──> API Server x N (业务逻辑)
                │
                ├──> Worker x M (异步任务)
                │
                ├──> Postgres (主从)
                ├──> Redis (哨兵)
                └──> S3
```

纯 Web 部署，无客户端组件。

---

# 第五部分 · 数据库 Schema

## 5.1 核心表结构

```sql
-- ============================================================
-- 组织、团队、用户、命名空间
-- ============================================================

CREATE TABLE organizations (
    id              BIGSERIAL PRIMARY KEY,
    slug            TEXT UNIQUE NOT NULL,
    display_name    TEXT NOT NULL,
    settings        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE teams (
    id              BIGSERIAL PRIMARY KEY,
    org_id          BIGINT NOT NULL REFERENCES organizations(id),
    parent_id       BIGINT REFERENCES teams(id),
    slug            TEXT NOT NULL,
    display_name    TEXT NOT NULL,
    UNIQUE (org_id, slug)
);

CREATE TABLE users (
    id              BIGSERIAL PRIMARY KEY,
    org_id          BIGINT NOT NULL,
    external_id     TEXT NOT NULL,        -- SSO subject
    email           TEXT NOT NULL,
    display_name    TEXT NOT NULL,
    avatar_url      TEXT,
    status          TEXT NOT NULL DEFAULT 'active',
    last_active_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, external_id)
);

CREATE TABLE team_members (
    team_id         BIGINT NOT NULL REFERENCES teams(id),
    user_id         BIGINT NOT NULL REFERENCES users(id),
    role            TEXT NOT NULL,
    PRIMARY KEY (team_id, user_id)
);

CREATE TABLE namespaces (
    id              BIGSERIAL PRIMARY KEY,
    org_id          BIGINT NOT NULL,
    slug            TEXT NOT NULL,
    display_name    TEXT NOT NULL,
    description     TEXT,
    owner_team_id   BIGINT NOT NULL REFERENCES teams(id),
    visibility      TEXT NOT NULL DEFAULT 'org',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, slug)
);

CREATE TABLE namespace_members (
    namespace_id    BIGINT NOT NULL REFERENCES namespaces(id),
    user_id         BIGINT NOT NULL REFERENCES users(id),
    role            TEXT NOT NULL,        -- owner/maintainer/contributor/reader
    added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    added_by        BIGINT REFERENCES users(id),
    PRIMARY KEY (namespace_id, user_id)
);

-- ============================================================
-- Skill 与版本
-- ============================================================

CREATE TABLE skills (
    id              BIGSERIAL PRIMARY KEY,
    namespace_id    BIGINT NOT NULL REFERENCES namespaces(id),
    name            TEXT NOT NULL,
    description     TEXT NOT NULL,
    classification  TEXT NOT NULL,         -- L1/L2/L3
    lifecycle_stage TEXT NOT NULL DEFAULT 'experimental',
    owner_user_id   BIGINT REFERENCES users(id),
    tags            TEXT[],
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (namespace_id, name)
);

CREATE INDEX idx_skills_search ON skills 
    USING gin(to_tsvector('english', name || ' ' || description));
CREATE INDEX idx_skills_tags ON skills USING gin(tags);

CREATE TABLE skill_versions (
    id                  BIGSERIAL PRIMARY KEY,
    skill_id            BIGINT NOT NULL REFERENCES skills(id),
    version             TEXT NOT NULL,
    status              TEXT NOT NULL,
    manifest            JSONB NOT NULL,    -- frontmatter
    bundle_object_key   TEXT,              -- S3 key
    bundle_size         BIGINT,
    bundle_sha256       TEXT,
    changelog           TEXT,
    created_by          BIGINT NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    submitted_at        TIMESTAMPTZ,
    published_at        TIMESTAMPTZ,
    published_by        BIGINT REFERENCES users(id),
    yanked_at           TIMESTAMPTZ,
    yank_reason         TEXT,
    UNIQUE (skill_id, version)
);

CREATE INDEX idx_versions_status ON skill_versions(status);

CREATE TABLE skill_dist_tags (
    skill_id        BIGINT NOT NULL REFERENCES skills(id),
    tag             TEXT NOT NULL,         -- latest/stable/beta
    version_id      BIGINT NOT NULL REFERENCES skill_versions(id),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (skill_id, tag)
);

CREATE TABLE version_dependencies (
    version_id          BIGINT NOT NULL REFERENCES skill_versions(id),
    depends_on_skill_id BIGINT NOT NULL REFERENCES skills(id),
    version_spec        TEXT NOT NULL,
    dependency_type     TEXT NOT NULL,
    PRIMARY KEY (version_id, depends_on_skill_id)
);

-- ============================================================
-- Skill 文件
-- ============================================================

CREATE TABLE skill_files (
    id              BIGSERIAL PRIMARY KEY,
    version_id      BIGINT NOT NULL REFERENCES skill_versions(id),
    path            TEXT NOT NULL,
    content_sha256  TEXT NOT NULL,
    size            BIGINT NOT NULL,
    content_type    TEXT,
    object_key      TEXT,                  -- 大文件存 S3
    inline_content  BYTEA,                 -- 小文件存 DB
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by      BIGINT REFERENCES users(id),
    UNIQUE (version_id, path)
);

-- ============================================================
-- 验证
-- ============================================================

CREATE TABLE validations (
    id              BIGSERIAL PRIMARY KEY,
    version_id      BIGINT NOT NULL REFERENCES skill_versions(id),
    status          TEXT NOT NULL,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    summary         JSONB
);

CREATE TABLE validation_checks (
    id              BIGSERIAL PRIMARY KEY,
    validation_id   BIGINT NOT NULL REFERENCES validations(id),
    name            TEXT NOT NULL,
    category        TEXT NOT NULL,
    status          TEXT NOT NULL,
    severity        TEXT NOT NULL,
    message         TEXT,
    location        JSONB,
    remediation     TEXT
);

CREATE TABLE validation_justifications (
    id              BIGSERIAL PRIMARY KEY,
    check_id        BIGINT NOT NULL REFERENCES validation_checks(id),
    reason          TEXT NOT NULL,
    justified_by    BIGINT NOT NULL REFERENCES users(id),
    justified_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 审批 (核心)
-- ============================================================

CREATE TABLE approval_policies (
    id                  BIGSERIAL PRIMARY KEY,
    namespace_id        BIGINT NOT NULL REFERENCES namespaces(id),
    rules               JSONB NOT NULL,
    global_constraints  JSONB NOT NULL DEFAULT '{}',
    active              BOOLEAN NOT NULL DEFAULT TRUE,
    version             INTEGER NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE review_requests (
    id                  BIGSERIAL PRIMARY KEY,
    skill_version_id    BIGINT NOT NULL REFERENCES skill_versions(id),
    status              TEXT NOT NULL,
    policy_snapshot     JSONB NOT NULL,    -- 提交时锁定
    required_slots      JSONB NOT NULL,
    submitted_by        BIGINT NOT NULL REFERENCES users(id),
    submitted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    due_at              TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    summary             TEXT,
    note                TEXT,
    is_hotfix           BOOLEAN NOT NULL DEFAULT FALSE,
    hotfix_incident     TEXT
);

CREATE INDEX idx_reviews_status ON review_requests(status);
CREATE INDEX idx_reviews_due ON review_requests(due_at) WHERE status = 'pending';

CREATE TABLE review_decisions (
    id              BIGSERIAL PRIMARY KEY,
    review_id       BIGINT NOT NULL REFERENCES review_requests(id),
    reviewer_id     BIGINT NOT NULL REFERENCES users(id),
    slot            TEXT NOT NULL,
    decision        TEXT NOT NULL,
    comment         TEXT,
    decided_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE review_comments (
    id              BIGSERIAL PRIMARY KEY,
    review_id       BIGINT NOT NULL REFERENCES review_requests(id),
    author_id       BIGINT NOT NULL REFERENCES users(id),
    body            TEXT NOT NULL,
    reply_to        BIGINT REFERENCES review_comments(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

-- ============================================================
-- 发布与下线
-- ============================================================

CREATE TABLE releases (
    id                  BIGSERIAL PRIMARY KEY,
    version_id          BIGINT NOT NULL REFERENCES skill_versions(id),
    released_by         BIGINT NOT NULL REFERENCES users(id),
    released_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes               TEXT,
    is_hotfix           BOOLEAN NOT NULL DEFAULT FALSE,
    hotfix_review_due   TIMESTAMPTZ
);

CREATE TABLE deprecation_plans (
    id                      BIGSERIAL PRIMARY KEY,
    skill_id                BIGINT NOT NULL REFERENCES skills(id),
    reason                  TEXT NOT NULL,
    replacement_skill_id    BIGINT REFERENCES skills(id),
    sunset_at               TIMESTAMPTZ NOT NULL,
    announced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    announced_by            BIGINT NOT NULL REFERENCES users(id),
    status                  TEXT NOT NULL DEFAULT 'active'
);

-- ============================================================
-- 订阅与反馈
-- ============================================================

CREATE TABLE subscriptions (
    user_id         BIGINT NOT NULL REFERENCES users(id),
    skill_id        BIGINT NOT NULL REFERENCES skills(id),
    subscribed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, skill_id)
);

CREATE TABLE skill_feedback (
    id              BIGSERIAL PRIMARY KEY,
    skill_id        BIGINT NOT NULL REFERENCES skills(id),
    version_id      BIGINT REFERENCES skill_versions(id),
    user_id         BIGINT NOT NULL REFERENCES users(id),
    rating          SMALLINT,              -- 1-5
    comment         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 通知
-- ============================================================

CREATE TABLE notifications (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id),
    type            TEXT NOT NULL,
    title           TEXT NOT NULL,
    body            TEXT,
    actor_id        BIGINT REFERENCES users(id),
    resource_type   TEXT,
    resource_id     BIGINT,
    metadata        JSONB,
    read_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_unread 
    ON notifications(user_id, created_at DESC) 
    WHERE read_at IS NULL;

CREATE TABLE notification_preferences (
    user_id         BIGINT PRIMARY KEY REFERENCES users(id),
    email_enabled   JSONB NOT NULL DEFAULT '{}',
    inapp_enabled   JSONB NOT NULL DEFAULT '{}',
    im_enabled      JSONB NOT NULL DEFAULT '{}'
);

-- ============================================================
-- 审计
-- ============================================================

CREATE TABLE audit_logs (
    id              BIGSERIAL,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_id        BIGINT NOT NULL,
    actor_type      TEXT NOT NULL,
    action          TEXT NOT NULL,
    resource_type   TEXT NOT NULL,
    resource_id     BIGINT,
    resource_name   TEXT,
    metadata        JSONB,
    request_id      TEXT,
    ip              INET,
    user_agent      TEXT
) PARTITION BY RANGE (occurred_at);

-- 按月分区，便于归档

-- ============================================================
-- 使用统计
-- ============================================================

CREATE TABLE skill_view_events (
    id              BIGSERIAL PRIMARY KEY,
    skill_id        BIGINT NOT NULL REFERENCES skills(id),
    user_id         BIGINT REFERENCES users(id),
    event_type      TEXT NOT NULL,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE skill_daily_stats (
    skill_id        BIGINT NOT NULL REFERENCES skills(id),
    date            DATE NOT NULL,
    views           INTEGER NOT NULL DEFAULT 0,
    downloads       INTEGER NOT NULL DEFAULT 0,
    unique_users    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (skill_id, date)
);
```

---

# 第六部分 · API 设计

## 6.1 通用约定

- 路径前缀：`/api/v1`
- 认证：`Authorization: Bearer <token>`（OIDC token 或 PAT）
- 响应：成功直接返回数据；错误返回 `{code, message, details, request_id}`
- 分页：游标分页（`cursor` + `limit`）
- 时间：ISO 8601 / RFC 3339 UTC
- 幂等性：写操作支持 `Idempotency-Key` header

## 6.2 完整接口清单

### 6.2.1 认证

```
GET    /api/v1/auth/oidc/login
GET    /api/v1/auth/oidc/callback
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
GET    /api/v1/me
```

### 6.2.2 浏览与发现

```
GET    /api/v1/skills                              # 列表/搜索
       Query: q, namespace, classification, status, tag, sort, cursor, limit
GET    /api/v1/skills/:namespace/:name             # 详情
GET    /api/v1/skills/:namespace/:name/versions    # 版本历史
GET    /api/v1/skills/:namespace/:name/versions/:v # 单版本详情
GET    /api/v1/skills/:namespace/:name/diff?from=&to=
POST   /api/v1/skills/:namespace/:name:subscribe
DELETE /api/v1/skills/:namespace/:name:subscribe
```

### 6.2.3 创建与编辑

```
POST   /api/v1/skills                              # 创建 skill 元数据
PATCH  /api/v1/skills/:namespace/:name             # 更新元数据
POST   /api/v1/skills/:namespace/:name/versions    # 创建新 draft

# 文件级编辑（仅 draft）
GET    /api/v1/skills/:ns/:name/versions/:v/files
GET    /api/v1/skills/:ns/:name/versions/:v/files/*path
PUT    /api/v1/skills/:ns/:name/versions/:v/files/*path
DELETE /api/v1/skills/:ns/:name/versions/:v/files/*path

# Bundle 整体上传/下载
POST   /api/v1/skills/:ns/:name/versions/:v/bundle    # multipart upload
GET    /api/v1/skills/:ns/:name/versions/:v/bundle    # 下载
```

### 6.2.4 验证

```
POST   /api/v1/skills/:ns/:name/versions/:v:validate
GET    /api/v1/skills/:ns/:name/versions/:v/validation
POST   /api/v1/skills/:ns/:name/versions/:v/validation/checks/:check_id/justify
       Body: { reason }
```

### 6.2.5 提交审批

```
POST   /api/v1/skills/:ns/:name/versions/:v:submit
       Body: { summary, note, hotfix?: { incident_id } }
POST   /api/v1/skills/:ns/:name/versions/:v:withdraw
       Body: { reason }
```

### 6.2.6 审批中心

```
GET    /api/v1/reviews
       Query: status, role(approver|submitter), sort, cursor, limit
GET    /api/v1/reviews/:id                         # 含 diff、影响、评论
POST   /api/v1/reviews/:id/decisions
       Body: { slot, decision, comment }
POST   /api/v1/reviews/:id/comments
DELETE /api/v1/reviews/:id/comments/:comment_id
```

### 6.2.7 发布与生命周期

```
POST   /api/v1/skills/:ns/:name/versions/:v:publish
       Body: { dist_tags: ["latest"] }
POST   /api/v1/skills/:ns/:name/versions/:v:yank
       Body: { reason }                            # 二次确认
PUT    /api/v1/skills/:ns/:name/tags/:tag
       Body: { version }
POST   /api/v1/skills/:ns/:name:deprecate
       Body: { reason, replacement_skill?, sunset_at }
POST   /api/v1/skills/:ns/:name:undeprecate
```

### 6.2.8 反馈与统计

```
POST   /api/v1/skills/:ns/:name/feedback
       Body: { rating, comment }
GET    /api/v1/skills/:ns/:name/feedback
GET    /api/v1/skills/:ns/:name/stats
       Query: range=7d|30d|90d
POST   /api/v1/skills/:ns/:name:track-event       # 浏览/下载埋点
```

### 6.2.9 通知

```
GET    /api/v1/notifications
POST   /api/v1/notifications:mark-read
GET    /api/v1/notifications/preferences
PUT    /api/v1/notifications/preferences
```

### 6.2.10 审计与分析

```
GET    /api/v1/audit
POST   /api/v1/audit:export
GET    /api/v1/audit/exports/:id
GET    /api/v1/analytics/top-skills
GET    /api/v1/analytics/zombie-skills
GET    /api/v1/analytics/review-throughput
GET    /api/v1/analytics/sla-compliance
```

### 6.2.11 RBAC 与管理

```
# Namespace
GET    /api/v1/namespaces
POST   /api/v1/namespaces
GET    /api/v1/namespaces/:slug
PATCH  /api/v1/namespaces/:slug
GET    /api/v1/namespaces/:slug/members
POST   /api/v1/namespaces/:slug/members
PATCH  /api/v1/namespaces/:slug/members/:user_id
DELETE /api/v1/namespaces/:slug/members/:user_id

# 审批策略
GET    /api/v1/namespaces/:slug/approval-policy
PUT    /api/v1/namespaces/:slug/approval-policy

# 用户管理
GET    /api/v1/admin/users
PATCH  /api/v1/admin/users/:id

# Team
GET/POST/PATCH/DELETE /api/v1/teams
GET/POST/DELETE /api/v1/teams/:id/members

# 系统配置
GET    /api/v1/admin/settings
PUT    /api/v1/admin/settings
```

---

# 第七部分 · 前端页面设计

## 7.1 全局结构

```
┌────────────────────────────────────────────────────────────────┐
│  skillHub  [⌘K 搜索]                          🔔3  @user ▼      │  顶部栏
├────────┬───────────────────────────────────────────────────────┤
│ 🏠工作台│                                                         │
│ 📦浏览  │                                                         │
│ ✏️ 我的 │                  主内容区                              │
│ ✅审批  │                                                         │
│ 📊统计  │                                                         │
│ 📋审计 │                                                         │
│ ⚙️ 管理 │                                                         │
└────────┴───────────────────────────────────────────────────────┘
```

## 7.2 完整页面清单

```
/                              首页（按角色重定向）
├── /workspace                  工作台
├── /skills                     浏览所有 skill
│   ├── /:namespace/:name       skill 详情
│   │   ├── ?tab=overview       概览
│   │   ├── ?tab=versions       版本历史
│   │   ├── ?tab=feedback       反馈
│   │   ├── ?tab=stats          使用统计
│   │   └── ?tab=audit          审计
│   ├── /:ns/:name/versions/:v  版本详情
│   ├── /:ns/:name/edit         在线编辑器
│   ├── /:ns/:name/edit/:v      编辑特定 draft
│   └── /:ns/:name/validate/:v  验证结果
├── /my-skills                  我维护的 skill
├── /reviews                    审批中心
│   ├── ?status=pending         待我审（默认）
│   ├── ?status=submitted       我提交的
│   ├── ?status=completed       已完成
│   └── /:id                    审批详情
├── /analytics                  分析仪表盘
├── /audit                      全局审计
├── /admin                      管理后台
│   ├── /users
│   ├── /teams
│   ├── /namespaces
│   │   └── /:slug/policy       审批策略配置
│   └── /settings
└── /settings                   个人设置
```

## 7.3 关键页面设计

### 7.3.1 工作台 `/workspace`

按"我关心什么"组织个性化首页。

**核心区块：**
- **4 个 KPI 卡片**：我维护的 skill / 总浏览量 / 平均评分 / 待我审批
- **我的 Drafts**：状态色条 + validation 结果 + 快捷操作
- **我维护的 Skills**：表格，含名称、版本、激活数 spark line、更新时间
- **待我审批**（Reviewer 角色）：卡片列表，按 SLA 紧迫度排序
- **需要关注**：通知流（@提及、新版本、审批请求）
- **快捷入口**：创建新 Skill、浏览目录

### 7.3.2 浏览 Skills `/skills`

**布局：左过滤 + 右结果**

过滤维度：Namespace、密级、状态、标签
视图切换：网格视图（默认）/ 列表视图
排序：相关度 / 最热 / 最新 / 字母序

卡片信息：名字 + 密级 / description / 评分 + 浏览量 / 版本 + 时间 + 作者 / 标签 / 操作（查看详情、获取 Skill）

**[获取 Skill] 按钮**：弹 modal 显示三种获取方式
- 直接下载 zip
- 复制 git clone URL
- 复制 download URL

### 7.3.3 Skill 详情页

**顶部固定区：**
- Skill 名 + 状态 tag + 密级
- 评分 + 浏览数
- Owner + 当前版本 + 更新时间
- 主操作：📥 获取 / ⭐ 收藏 / 🔔 订阅
- 次操作（按权限）：✏️ 创建新版本 / Yank / Deprecate

**Tab 内容：**
- Overview：渲染 SKILL.md body + Metadata 列表
- Versions：时间轴 + 版本状态 + diff 对比
- Feedback：评分分布 + 评论列表
- Stats：4 个 KPI 卡片 + 趋势图 + 版本分布
- Audit：该 skill 相关的审计事件

### 7.3.4 在线编辑器

**三栏布局：** 文件树 / Monaco Editor / Frontmatter 表单

核心交互：
- 自动保存（10s 防抖）
- Cmd+S 显式保存
- 文件树右键菜单
- frontmatter 表单模式
- 自动保存为 draft

### 7.3.5 验证结果页

顶部状态总览（绿/黄/红）+ 各检查项分组展示
警告可"标记为合理"，记录原因供审批人参考
错误必须修复，"提交审批"按钮置灰

### 7.3.6 审批中心

Tab 分类：待我审批 / 我提交的 / 已完成
卡片左侧 SLA 紧迫度色条（红=逾期 / 黄=快到期 / 绿=充裕）
按紧迫度自动排序

### 7.3.7 审批详情页

**核心页面，信息密度最大。**

- 顶部审批旅程 stepper
- 左侧 Tab 区：变更（diff）/ 检查 / 影响 / 历史
- 右侧固定栏：Summary + 评论 + 决策操作

决策操作：
- ✓ 通过：可选填 comment
- ✗ 要求修改：必填 comment
- ⛔ 阻止发布：必填 reason，二次确认

### 7.3.8 审批策略配置 `/admin/namespaces/:slug/policy`

可视化编辑器：
- 全局约束（禁止自审等）
- 按密级配置规则（模式、SLA、审批人槽位）
- 策略预览：模拟某用户提交某密级 skill 会路由给谁

### 7.3.9 分析仪表盘 `/analytics`

- 总览 KPI（总 skill / 活跃 / 待审批 / 平均 SLA）
- 审批吞吐量趋势图
- Top Skills + 僵尸 Skills
- 审批者排行榜

### 7.3.10 审计日志 `/audit`

筛选 + 表格 + CSV 导出

## 7.4 设计系统

**状态 Tag 配色：**

| 状态 | 颜色 |
|---|---|
| Draft | 灰 |
| Validating | 蓝 |
| Reviewing | 黄 |
| Approved | 浅绿 |
| Published | 绿 |
| Yanked | 红 |
| Deprecated | 深灰 |
| Archived | 浅灰 |

**密级 Tag 配色：**

| 密级 | 颜色 |
|---|---|
| L1 公开 | 浅蓝 |
| L2 内部 | 蓝 |
| L3 敏感 | 橙 |

**全局快捷键：**
- `Ctrl+K`：全局搜索
- `g w`：工作台
- `g s`：浏览 skills
- `g r`：审批中心
- `g a`：审计
- `/`：聚焦搜索框
- `?`：快捷键帮助

**核心组件：** 状态 Tag、密级 Tag、用户头像、相对时间、空状态、加载骨架、Markdown 渲染、Diff 视图、Monaco 编辑器封装、评论框（支持 @提及）、命令面板

---

# 第八部分 · 通知设计

## 8.1 通知触发场景

| 事件 | 接收人 | 默认渠道 |
|---|---|---|
| 我提交的审批 → 进入审批 | 提交者 | In-app |
| 审批请求 → 我是审批人 | 审批人 | In-app + 邮件 + IM |
| 我收到 Request Changes | 提交者 | In-app + 邮件 |
| 我提交的审批被通过 | 提交者 | In-app + IM |
| 我提交的审批被 Block | 提交者 | In-app + 邮件 + IM |
| SLA 即将到期（剩 25%） | 审批人 | In-app + 邮件 |
| SLA 已逾期 | 审批人 + 提交者 + Manager | In-app + 邮件 + IM |
| 我订阅的 skill 发新版本 | 订阅者 | In-app |
| 我订阅的 skill 被 yank | 订阅者 | In-app + 邮件 |
| 我维护的 skill 被 deprecate | Maintainer | In-app + 邮件 |
| 评论 @我 | 被 @ 者 | In-app + 邮件 |

## 8.2 用户偏好设置

`/settings/notifications` 中按事件类型 × 渠道矩阵勾选启停。

## 8.3 IM 集成

支持 Slack / 飞书 / 钉钉 / 微信企业号
绑定方式：用户在个人设置绑定 IM 账号
推送方式：通过对应平台 webhook

## 8.4 邮件模板要点

- 主题清晰：`[审批] 请审批 platform-team/go-code-review v1.3.0`
- 正文摘要：作者、版本、密级、变更摘要、SLA
- 一键操作按钮：`查看详情` 跳转 Web 审批详情页

---

# 第九部分 · 安全与合规

## 9.1 鉴权

- 所有请求必须带 token，未认证返回 401
- token 经 OIDC 颁发，包含 user_id、org_id、roles
- 敏感操作（yank、policy 修改）需要二次确认
- API 支持 PAT，便于脚本/CI 使用

## 9.2 鉴权细粒度

每个 API 调用通过中间件校验：
1. Token 解析 → 当前用户
2. 资源定位 → 资源所属 namespace
3. 权限检查（用户角色 × 动作矩阵）
4. 通过则继续，否则 403

## 9.3 文件安全

- 文件大小限制（单 skill ≤ 10 MB，单文件 ≤ 1 MB）
- 文件名校验（禁止特殊字符、路径穿越）
- 不允许可执行文件
- 病毒扫描（ClamAV 异步）
- Secret 扫描（gitleaks）
- 内容白名单（只允许 markdown、yaml、json、shell、python 等明确类型）

## 9.4 审计完整性

- 每个写操作必须留审计记录
- 审计记录写入后不可改不可删（应用层强制 + DB 触发器双重保障）
- 关键合规字段（如 yank reason）字符级保留
- 支持按法规要求保留期（默认 7 年）

## 9.5 数据保护

- 数据库连接 TLS
- 敏感字段加密存储
- PII 数据按 GDPR 要求脱敏导出

---

# 第十部分 · 技术选型

## 10.1 后端

| 模块 | 选型 |
|---|---|
| 语言 | Go 1.21+ |
| HTTP 框架 | gin |
| 数据库 | PostgreSQL 14+ |
| 数据库访问 | sqlc（类型安全 SQL 生成） |
| 数据库迁移 | golang-migrate |
| 缓存/队列 | Redis |
| 对象存储 | S3 兼容（MinIO 自托管或云上） |
| 认证 | OIDC（coreos/go-oidc） |
| 配置 | viper + 环境变量 |
| 日志 | slog |
| Tracing | OpenTelemetry |
| Workflow | 自研轻量状态机 |
| API 规范 | OpenAPI 3.0 |
| 代码生成 | oapi-codegen |
| 测试 | testify + dockertest |
| 邮件 | SMTP / SES |
| IM | 各平台 webhook |

## 10.2 前端

| 模块 | 选型 |
|---|---|
| 框架 | React 18 + TypeScript |
| 构建 | Vite |
| 路由 | React Router v6 |
| 状态管理 | Zustand + TanStack Query |
| 组件库 | Ant Design 或 shadcn/ui |
| 样式 | Tailwind CSS |
| 编辑器 | Monaco Editor |
| Diff 渲染 | diff2html |
| Markdown 渲染 | react-markdown |
| 图表 | Recharts |
| 表单 | React Hook Form + Zod |
| API client | openapi-fetch |
| 类型生成 | openapi-typescript |
| Mock | MSW |
| 测试 | Vitest + Testing Library + Playwright |

## 10.3 部署

| 模块 | 选型 |
|---|---|
| 容器 | Docker |
| 编排 | Kubernetes + Helm |
| CI/CD | GitHub Actions / GitLab CI |
| 监控 | Prometheus + Grafana |
| 日志聚合 | Loki |
| Tracing | Jaeger |
| 错误监控 | Sentry |
| Secret 管理 | Vault 或云 KMS |

## 10.4 项目结构

**后端：**
```
skillhub-backend/
├── cmd/
│   ├── api/            # API server
│   └── worker/         # 异步 worker
├── internal/
│   ├── api/handler/
│   ├── api/middleware/
│   ├── service/        # skill / review / workflow / validation / notification / rbac / audit
│   ├── repo/
│   ├── model/
│   └── auth/
├── api/openapi.yaml    # 单一真相源
├── migrations/
├── deploy/
└── docs/
```

**前端：**
```
skillhub-web/
├── src/
│   ├── api/            # 生成的 client + types
│   ├── components/
│   ├── features/       # workspace / skills / reviews / editor / analytics / admin
│   ├── hooks/
│   ├── lib/
│   ├── routes/
│   └── styles/
└── tests/
```

---

# 第十一部分 · 关键用户旅程

平台必须支持以下端到端流程：

**旅程 1：作者创建并发布 Skill**
登录 → 工作台 → 创建 → 编辑器写 SKILL.md → 自动保存 → Validate 全通过 → 提交审批 → 审批通过 → 发布 → 通知

**旅程 2：审批人处理审批**
邮件通知 → 审批详情页 → 看 diff、影响面、历史 → 评论沟通 → 通过 → 进度推进

**旅程 3：使用者发现 Skill**
浏览 → 搜索 → 详情页 → 看 Feedback 和 Stats → 获取 Skill → 订阅

**旅程 4：作者迭代版本**
详情页 → 创建新版本（基于 latest） → 编辑器 → 提交审批 → 通过后 latest 指向新版本

**旅程 5：紧急 Yank**
发现严重 bug → Versions tab → Yank → 二次确认 → dist tag 回退 → 通知订阅者 → 审计留痕

**旅程 6：下线老 Skill**
Deprecate → 设置替代和下线日期 → 通知订阅者 → 30/7/1 天提醒 → 到期 archived

**旅程 7：管理员配置审批策略**
管理后台 → namespace 策略页 → 修改 SLA / 增加槽位 → 预览模拟 → 保存（已开审批用旧策略）

---

# 第十二部分 · MVP 范围与扩展规划

## 12.1 MVP 范围（必做）

**MVP 的目标**：让第一个团队真实地走完"创建 → 审批 → 发布 → 使用 → 下线"完整闭环。

### 全局能力

| 项 | 备注 |
|---|---|
| SSO 登录（OIDC） | 对接企业 IdP |
| 基础 RBAC | Namespace 级 4 角色 |
| 全局搜索 | 顶部搜索框 |
| 审计日志 | 表格 + CSV 导出 |
| 命令面板 ⌘K | 跳转 + 基础动作 |

### 创建与编辑

| 项 | 备注 |
|---|---|
| Skill 列表与详情页 | Overview + Versions + Audit 三个核心 tab |
| 在线编辑器 | Monaco + 文件树 + frontmatter 表单 |
| 自动保存为 draft | |
| 版本时间轴 | 列表 + 状态 |
| 版本 diff | 文本 diff |
| 创建新版本 | 基于 latest 复制 |

### 验证

只做关键检查：

| 检查项 | 备注 |
|---|---|
| SKILL.md 结构校验 | frontmatter schema、必需字段、name 格式 |
| 文件大小检查 | 单 skill < 10 MB |
| Secret 扫描 | gitleaks |
| 依赖解析 | 被依赖的 skill 是否存在、是否 yanked |

### 审批流（核心）

| 项 | 备注 |
|---|---|
| 审批策略 | 两档：L2 内部（1 人）/ L3 敏感（2 人含 security） |
| 审批人不能是发布者本人 | 硬规则 |
| Reviewer Workbench | 待审清单 + SLA |
| Review 详情页 | Summary + diff + 影响 + 评论 + 决策 |
| 三种决策 | Approve / Request Changes / Block |
| 整体评论区 | 不做行内 comment |
| SLA 邮件提醒 | 不做自动升级 |

### 发布与下线

| 项 | 备注 |
|---|---|
| 审批通过后发布 | 不做灰度，直接全量 |
| 一键 Yank | Maintainer+，强制填原因 |
| Deprecate | 填替代和下线日期 |

### 运营

| 项 | 备注 |
|---|---|
| Skill Health（简化版） | 4 个 KPI + 一条趋势线 |
| 组织级 Top N | Top Skills / Zombie Skills |
| 浏览/下载埋点 | 入库 Postgres |

### 通知

| 项 | 备注 |
|---|---|
| In-app 通知 | 顶栏铃铛 + 工作台 feed |
| 邮件通知 | 审批相关事件 |
| 偏好设置 | 简化版 |

### 管理后台

| 项 | 备注 |
|---|---|
| 用户管理 | 列表、禁用、角色 |
| Namespace 管理 | 创建、配置 |
| 审批策略配置 | 简化版（写配置文件） |
| 系统配置查看 | 只读展示 |

---

## 12.2 扩展规划（P1-P4）

按优先级和主题分组。**不必全做**，根据用户反馈和实际需求挑选。

### P1：高 ROI 立即可做（MVP 上线后立刻补）

#### AI 辅助创作
集成 LLM 帮作者写 SKILL.md。
- "根据描述生成骨架"
- "优化 description 提高触发率"
- "基于这段文档抽取 instructions"

**价值**：降低创作门槛，平台 skill 数量指数增长

#### 在线 Sandbox Playground
作者输入测试 query，平台启动隔离 Claude/Codex 实例加载 draft skill 试跑，展示响应 + trace。

**价值**：解决调试 skill 这个核心痛点

#### Description 质量打分
LLM 评估 description 触发性，0-100 分 + 改进建议，集成到 Validation。

**价值**：质量从源头抓起

#### Inline Diff 评论
审批 diff 视图每一行可评论，类似 GitHub PR review。

**价值**：审批沟通粒度细化

#### Skill 评论与讨论
每个 skill 详情页有讨论区，使用者可以提问、分享用法、报 bug。

**价值**：知识沉淀，"如何使用"通过 Q&A 沉淀

#### CLI 工具
发布 `skillhub` CLI（login / push / pull / list / yank）。

**价值**：工程师 CLI 比 Web 高频，CI/CD 也需要

#### 移动端审批
审批页面支持移动端浏览，reviewer 在会议间隙可处理。

**价值**：审批人不可能时刻在电脑前

#### 模板库
新建 skill 时选模板（空白、代码审查、文档生成、工作流等）。

**价值**：降低创建门槛

#### Token 估算实时显示
编辑器实时显示 SKILL.md 的 token 数，超 5000 警告。

**价值**：避免 skill 过大

#### Slack/飞书通知集成
深度集成企业 IM，比邮件更即时。

**价值**：审批响应速度提升

---

### P2：有数据后做（积累 1-3 个月使用数据）

#### AI 辅助审批
审批详情页 AI 助手侧栏：风险评级、历史类似变更对比、提交者画像。

#### Eval Suite
作者维护测试用例集，每次改动自动跑 precision/recall，低于阈值不允许提交。

#### 智能 Skill 推荐
基于历史浏览/订阅/角色，工作台推荐"你可能感兴趣"。

#### 评分系统
使用者打分 + 评价，搜索按热度排序。

#### Issue Tracker
使用者一键报 bug，关联 skill 版本和客户端。

#### 自动僵尸 Skill 处理
90 天无活动自动通知 owner，180 天自动 deprecated。

#### Sunset 迁移追踪
Deprecated skill 的迁移看板：还有多少用户在用、迁移率多少。

#### Ideation/Proposal 流程
用户提交"想做什么 skill"提案，其他人 upvote、认领。重复检测。

#### Gap 分析
分析使用者搜索但没找到的关键词，反推组织缺什么 skill。

#### Git-backed 分发
每个 namespace 一个受管 Git 仓库，发布成功自动 push。开发者本地 git clone。

#### 审批人 SLA 看板
每个 reviewer 个人仪表盘：审批量、平均耗时、按时完成率。

#### 审批指派与轮值
自动轮值 / 显式指派 / 自动避开请假者。

#### 委托审批
请假/出差时委托给同事，到期自动收回。

#### 升级审批
SLA 到期自动升级到 manager / lead。

#### 条件审批策略
更复杂条件（仅当包含网络调用才需 security 审批 / 文档修改自动跳过审批）。

#### 审批模板
常见审批意见模板化，"LGTM" / "请加测试"等一键插入。

---

### P3：合规/规模驱动（半年后视情况做）

#### SSO 深度集成
- 自动同步组织架构
- 离职/调岗自动撤销权限
- 团队变更自动调整 namespace 成员

#### 审批策略可视化编辑器
JSON → 图形化编辑器，拖拽配置审批节点。

#### ABAC 策略引擎
基于属性的访问控制（如"L3 必须公司内网"）。

#### Compliance 报告
一键生成季度合规报告，导出 PDF。

#### Data Retention 策略
可配置保留期：审计 7 年、deleted skill 元数据 3 年。

#### SIEM 集成
审计日志实时推送到企业 SIEM（Splunk、Elastic）。

#### Sigstore / Cosign 签名
bundle 发布强制签名，下载时验证。

#### SBOM 生成
每个 skill 自动生成 SPDX 格式 SBOM。

#### 漏洞扫描
集成 Trivy / Grype，扫描外部脚本依赖的 CVE。

#### 异常行为检测
基于历史模式识别异常（用户突发大量发布、skill 突然大量下载等）。

#### 全文搜索升级
Postgres → Elasticsearch / Meilisearch / Typesense。

#### ClickHouse for Analytics
事件、telemetry、统计数据迁移到 ClickHouse 做 OLAP。

#### Redis 缓存优化
skill 详情页、版本解析、用户权限、通知未读数缓存。

#### CDN 加速
bundle 下载走 CDN。

#### 完整 OTel 接入
trace/metrics/logs 三柱齐全。

#### 业务监控仪表盘
每日 skill 创建数、审批通过率、SLA 合规率、Yank 次数等。

#### 智能告警
skill yank 次数突增、SLA 违规率超阈值等自动告警。

---

### P4：长期演进（看战略方向）

#### Sync Agent
常驻 daemon 自动同步授权 skill，权限实时撤销。

#### Managed Settings + MDM
通过 MDM 推送配置，强管控环境用。

#### IDE 插件
VSCode、JetBrains 插件，IDE 内浏览/搜索/安装。

#### CI/CD 集成
GitHub Action / GitLab CI 模板，PR 评论。

#### 多语言 SDK
Go / Python / TypeScript SDK。

#### 跨组织 Federation
跨公司私有 registry 互通。

#### Skill Marketplace
公共 namespace 跨组织可见，付费/订阅。

#### 开源 SDK 与协议
Skill 元数据规范、API 协议开源，建立行业标准。

#### Plugin / Extension 系统
第三方开发插件扩展平台能力。

#### Webhooks
平台事件推送到外部系统。

#### Skill 协作（多作者）
同一 skill 多人共同编辑，类似 Wiki。

#### Skill Fork
使用者可 fork 到自己 namespace，原作者可选 merge upstream。

#### Skill Showcase
管理员每周精选优秀 skill 推荐。

#### A/B 测试
同一 skill 两版本同时发布给不同用户，30 天选优胜。

#### 灰度发布机制
平台自身发布支持灰度（5% → 50% → 100%）。

#### 混沌工程
定期故障演练。

#### 国际化（i18n）
中英双语支持。

#### 暗色模式
完整深色主题。

#### 无障碍（a11y）
键盘导航、屏幕阅读器、高对比度。

#### Onboarding 引导
新用户产品 tour，分角色引导。

#### Skill 写作认证
作者参加内部认证，通过后获"高级作者"标签 + 宽松审批。

---

## 12.3 优先级判断三原则

实际选择时按这三个标准判断：

1. **用户在抱怨什么**：抱怨多的优先做（数据驱动 > 想象驱动）
2. **合规线在哪里**：合规审计逼近时优先安全/审计相关
3. **ROI 比**：AI 辅助、CLI 这类高 ROI 优先；微服务拆分、混沌工程这类基础设施投资先放后

**关键原则：不要试图把扩展清单全做完。** 一个产品的健康指标是"该做的做了，不该做的没做"。这份扩展规划的价值是让你**知道有哪些选项**。

---

# 第十三部分 · 关键架构决策

## 13.1 为什么状态机驱动？
Skill 生命周期有明确状态和转换规则。状态机让代码意图清晰、转换可追溯、违规转换可阻止。每个 transition 是原子事务（DB lock + state update + audit log + notification）。

## 13.2 为什么策略快照？
ApprovalPolicy 会演化（团队扩张、合规变化）。但已开审批必须按提交时策略执行。快照保证可追溯性。

## 13.3 为什么并行 + 串行混合？
不同密级关注点不同：L2 peer + maintainer 并行高效；L3 先看技术再看安全，串行合理。

## 13.4 为什么有 Hotfix 通道？
生产事故真实存在。完全不允许绕过审批是教条主义；不留痕地绕过是失控。Hotfix 是**有约束的快速通道**：单人可走，但 7 天内必须补审批，否则自动 yank。

## 13.5 为什么文件分两种存储（DB inline + S3）？
SKILL.md 一般几 KB，频繁读写小文件存 DB 性能更好。脚本和 references 可能更大，存 S3。阈值（如 256 KB）作为切换点。

## 13.6 为什么 MVP 不做 CLI 和 Agent？
聚焦 Web 平台是定位。Skill 怎么从平台到本地，由开发者自己负责。这让平台职责清晰，避免变成大杂烩。CLI 和 Agent 在扩展规划里。

## 13.7 为什么不用 ES 搜索？
Postgres 的 `tsvector` + `pg_trgm` 对 skill 搜索完全够用。不引入 ES 省运维成本、保数据一致性。规模上来再升级。

## 13.8 为什么单体而非微服务？
企业内部 skillHub 的并发量、数据量、团队规模都不需要微服务。单体 + 模块化代码组织 + 部署多副本 = 简单可靠。等真有性能瓶颈再拆。

---

# 第十四部分 · 验收标准

## 14.1 功能完整性
- 7 个核心用户旅程全部跑通
- 所有 API endpoint 有 OpenAPI spec 且测试覆盖 > 80%
- Web 所有页面交互完整、无死链
- 审批策略可配置且生效

## 14.2 性能
- API p99 < 200ms
- Web 首屏 < 2s
- 同时支持 1000 人在线、100 个并发审批

## 14.3 安全
- OWASP Top 10 自查无高危
- 渗透测试通过
- 审计日志覆盖所有写操作
- PII 数据加密存储

## 14.4 可观测
- 关键 SLI 仪表盘可用
- 审批 SLA 合规率监控
- 每个审批可端到端追踪

## 14.5 文档
- 用户手册（作者、审批、使用者）
- 管理员手册（含审批策略配置）
- API 文档（基于 OpenAPI 生成）
- 运维 runbook

---