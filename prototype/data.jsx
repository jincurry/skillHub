// Mock data — multiple teams, statuses, classifications

const MY_DRAFTS = [
  {
    name: "go-code-review",
    namespace: "platform-team",
    icon: "Go", iconClass: "blue",
    version: "1.3.0",
    updated: "2 小时前",
    summary: "新增 generics 检查规则、修复 error handling 误报",
    checks: [
      { kind: "ok", label: "结构 ✓" },
      { kind: "ok", label: "Secret 扫描 ✓" },
      { kind: "warn", label: "3 个建议" },
      { kind: "ok", label: "依赖 ✓" },
    ],
    canSubmit: true,
  },
  {
    name: "deploy-helper",
    namespace: "platform-team",
    icon: "🚀", iconClass: "violet",
    version: "0.1.0",
    updated: "3 天前",
    summary: "首次创建 — Kubernetes 滚动发布前置检查",
    checks: [
      { kind: "ok", label: "全部通过" },
    ],
    canSubmit: true,
  },
  {
    name: "incident-postmortem",
    namespace: "sre-team",
    icon: "📋", iconClass: "amber",
    version: "2.1.0-rc.1",
    updated: "6 小时前",
    summary: "RCA 模板更新，加入时间线自动生成步骤",
    checks: [
      { kind: "err", label: "1 个错误" },
      { kind: "warn", label: "2 个建议" },
    ],
    canSubmit: false,
  },
];

const MY_SKILLS = [
  { name: "go-code-review", ns: "platform-team", icon: "Go", iconClass: "blue", version: "1.2.3", status: "published", activations: 1234, delta: 12, updated: "2 天前" },
  { name: "data-import-csv", ns: "data-team", icon: "csv", iconClass: "green", version: "2.0.1", status: "published", activations: 842, delta: 5, updated: "5 天前" },
  { name: "k8s-debug", ns: "platform-team", icon: "k8", iconClass: "blue", version: "1.5.0", status: "published", activations: 612, delta: -3, updated: "1 周前" },
  { name: "expense-validate", ns: "finance-team", icon: "$", iconClass: "amber", version: "1.0.0", status: "review", activations: 0, delta: 0, updated: "昨天" },
  { name: "old-deploy-flow", ns: "platform-team", icon: "Dp", iconClass: "red", version: "0.9.4", status: "deprecated", activations: 18, delta: -45, updated: "2 月前" },
  { name: "test-data-gen", ns: "qa-team", icon: "Qa", iconClass: "violet", version: "0.3.0", status: "draft", activations: 0, delta: 0, updated: "3 天前" },
];

const NOTIFICATIONS = [
  { id: 1, type: "review", unread: true, icon: "review", text: <><strong>@bob</strong> 通过了你的 review 请求 <strong>data-team/csv-import@2.0.1</strong></>, time: "12 分钟前" },
  { id: 2, type: "comment", unread: true, icon: "comment", text: <><strong>@charlie</strong> 在 <strong>go-code-review v1.3.0</strong> 留下了 2 条评论</>, time: "2 小时前" },
  { id: 3, type: "publish", unread: true, icon: "publish", text: <>你的 skill <strong>data-import-csv@2.0.1</strong> 已成功发布</>, time: "1 天前" },
  { id: 4, type: "warn", unread: false, icon: "warn", text: <>依赖 <strong>platform-team/go-lint</strong> 有新版本 <span className="mono">1.5.0</span> 可用</>, time: "3 天前" },
  { id: 5, type: "review", unread: false, icon: "review", text: <><strong>@diana</strong> 请求你审批 <strong>finance-team/expense-validate</strong></>, time: "3 天前" },
];

const PENDING_REVIEWS = [
  { id: 1, name: "db-migration", ns: "platform-team", version: "2.0.0", classification: "L3", author: "charlie", urgency: "overdue", note: "SLA 已超时" },
  { id: 2, name: "expense-validate", ns: "finance-team", version: "1.0.0", classification: "L3", author: "diana", urgency: "soon", note: "12 小时内到期" },
  { id: 3, name: "csv-import", ns: "data-team", version: "1.5.2", classification: "L2", author: "eve", urgency: "ok", note: "46h 内到期" },
];

// Browse data — diverse teams, statuses, classifications
const ALL_SKILLS = [
  { name: "go-code-review", ns: "platform-team", desc: "Review Go code for bugs, idiomatic patterns, error handling, and Go 1.21+ generics usage. Catches common pitfalls before merge.", icon: "Go", iconClass: "blue", version: "1.2.3", status: "published", classification: "L2", rating: 4.3, ratings: 24, activations: 1234, updated: "2 天前", author: "alice", tags: ["go", "review", "lint"], hot: true },
  { name: "csv-import", ns: "data-team", desc: "Robust CSV ingestion with schema inference, encoding detection, and error reporting. Supports multi-GB files via streaming.", icon: "csv", iconClass: "green", version: "2.0.1", status: "published", classification: "L2", rating: 4.6, ratings: 51, activations: 842, updated: "5 天前", author: "frank", tags: ["data", "ingestion", "etl"], hot: true },
  { name: "k8s-debug", ns: "platform-team", desc: "Diagnose Kubernetes pod failures: pull events, logs, describe, and suggest probable cause from common patterns.", icon: "k8", iconClass: "blue", version: "1.5.0", status: "published", classification: "L2", rating: 4.5, ratings: 38, activations: 612, updated: "1 周前", author: "alice", tags: ["k8s", "debug", "ops"] },
  { name: "expense-validate", ns: "finance-team", desc: "Validate expense reports against company policy, flag exceptions, and generate approval routing recommendations.", icon: "$", iconClass: "amber", version: "1.0.0", status: "review", classification: "L3", rating: 0, ratings: 0, activations: 0, updated: "昨天", author: "diana", tags: ["finance", "policy"] },
  { name: "incident-postmortem", ns: "sre-team", desc: "Generate post-mortem documents from incident channels: timeline, contributing factors, and action items in standard format.", icon: "📋", iconClass: "amber", version: "2.1.0", status: "published", classification: "L2", rating: 4.7, ratings: 19, activations: 287, updated: "1 月前", author: "george", tags: ["sre", "incident", "writing"] },
  { name: "test-data-gen", ns: "qa-team", desc: "Generate realistic test fixtures from JSON schema, including PII-safe synthetic data for staging environments.", icon: "Qa", iconClass: "violet", version: "0.3.0", status: "published", classification: "L1", rating: 4.1, ratings: 12, activations: 198, updated: "2 周前", author: "henry", tags: ["test", "qa", "fixtures"] },
  { name: "sql-explain", ns: "data-team", desc: "Explain SQL query plans in plain language, identify expensive operations, and suggest index improvements.", icon: "SQ", iconClass: "green", version: "1.1.0", status: "published", classification: "L2", rating: 4.8, ratings: 67, activations: 1502, updated: "4 天前", author: "frank", tags: ["sql", "performance", "data"], hot: true },
  { name: "react-component-review", ns: "frontend-team", desc: "Review React components for accessibility, performance anti-patterns, and adherence to design system conventions.", icon: "Re", iconClass: "blue", version: "0.8.2", status: "published", classification: "L1", rating: 4.2, ratings: 33, activations: 421, updated: "6 天前", author: "ivan", tags: ["react", "frontend", "review"] },
  { name: "auth-audit", ns: "security-team", desc: "Audit authentication flows for OAuth/OIDC misconfigurations, weak session handling, and token leakage.", icon: "🔒", iconClass: "red", version: "1.0.0", status: "published", classification: "L3", rating: 4.9, ratings: 8, activations: 56, updated: "2 天前", author: "judy", tags: ["security", "auth"] },
  { name: "old-deploy-flow", ns: "platform-team", desc: "(已弃用) 旧版部署流程脚本。请改用 deploy-helper@1.0+。", icon: "Dp", iconClass: "red", version: "0.9.4", status: "deprecated", classification: "L2", rating: 3.1, ratings: 15, activations: 18, updated: "2 月前", author: "alice", tags: ["deploy", "deprecated"] },
  { name: "graphql-schema-lint", ns: "frontend-team", desc: "Lint GraphQL schemas for naming conventions, deprecated field handling, and breaking-change detection.", icon: "GQ", iconClass: "violet", version: "1.4.0", status: "published", classification: "L1", rating: 4.4, ratings: 22, activations: 367, updated: "1 周前", author: "ivan", tags: ["graphql", "lint", "frontend"] },
  { name: "log-pii-scan", ns: "security-team", desc: "Scan log streams for accidentally-emitted PII (emails, SSN, credit cards) with low false-positive rules.", icon: "🛡", iconClass: "red", version: "0.5.0", status: "review", classification: "L3", rating: 0, ratings: 0, activations: 0, updated: "3 小时前", author: "judy", tags: ["security", "pii", "logs"] },
];

const NAMESPACES = [
  { id: "platform-team", count: 12 },
  { id: "data-team", count: 8 },
  { id: "frontend-team", count: 6 },
  { id: "sre-team", count: 5 },
  { id: "security-team", count: 4 },
  { id: "qa-team", count: 4 },
  { id: "finance-team", count: 3 },
];

const TAGS = [
  { id: "go", count: 8 }, { id: "review", count: 14 }, { id: "python", count: 11 },
  { id: "data", count: 19 }, { id: "k8s", count: 6 }, { id: "security", count: 7 },
  { id: "frontend", count: 9 }, { id: "sql", count: 5 },
];

Object.assign(window, {
  MY_DRAFTS, MY_SKILLS, NOTIFICATIONS, PENDING_REVIEWS,
  ALL_SKILLS, NAMESPACES, TAGS,
});
