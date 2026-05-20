// Typed responses returned by the SkillHub API.
// Aligned with server/internal/model/model.go.

export interface Skill {
  id: number;
  ns: string;
  name: string;
  desc: string;
  longDesc: string;
  icon: string;
  iconClass: string;
  classification: 'L1' | 'L2' | 'L3';
  status: 'published' | 'draft' | 'review' | 'deprecated' | 'yanked';
  version: string;
  author: string;
  rating: number;
  ratings: number;
  activations: number;
  delta: number;
  hot: boolean;
  tags: string[];
  updatedAt: string;
}

export interface Namespace {
  id: string;
  owner: string;
  count: number;
}

export interface Review {
  id: number;
  ns: string;
  name: string;
  version: string;
  classification: 'L1' | 'L2' | 'L3';
  author: string;
  reviewers: string[];
  status: 'pending' | 'approved' | 'rejected' | 'changes_requested';
  urgency: 'overdue' | 'soon' | 'ok' | 'done' | 'rejected' | 'changes' | 'hot';
  sla: string;
  note: string;
  submittedAt: string;
  /** Emergency-channel marker; reviewers see a banner and SLA shortens to 4h. */
  isHotfix: boolean;
  /** Required text justification when isHotfix; preserved in audit logs. */
  hotfixReason?: string;
  /** Policy frozen at submission time; absent on legacy reviews. */
  policySnapshot?: PolicySnapshot;
}

// PolicySnapshot mirrors model.PolicySnapshot (JSON tags are lowercase, unlike
// the legacy PolicyPreview's capitalised Slot shape — they're separate types).
export interface PolicySnapshotSlot {
  roles: string[];
  count: number;
}
export interface PolicySnapshot {
  classification: 'L1' | 'L2' | 'L3';
  mode: 'parallel' | 'serial';
  slaHours: number;
  slots: PolicySnapshotSlot[];
  hotfix?: boolean;
}

// DistTag is one alias ("latest"|"stable"|"beta"|...) → version pointer.
export interface DistTag {
  tag: string;
  version: string;
  updatedAt: string;
  updatedBy: string;
}

// Subscription represents one user's interest in a skill's release stream.
export interface Subscription {
  ns: string;
  name: string;
  createdAt: string;
}

export interface SubscriptionState {
  subscribed: boolean;
  count: number;
}

// ReviewFile is one file's snapshot inside a review request, returned by
// GET /reviews/:id/files. The base/new contents power the diff view; the
// pre-computed changeKind drives the file-list sidebar.
export interface ReviewFile {
  path: string;
  baseContent: string;
  newContent: string;
  changeKind: 'added' | 'modified' | 'deleted' | 'unchanged';
}

// TrendPoint is one row in the SkillDetail activation sparkline returned by
// GET /skills/:ns/:name/trend?days=N. Day is "YYYY-MM-DD" UTC.
export interface TrendPoint {
  day: string;
  activations: number;
}

// AIProviderSummary is the AI-counter trio inside PlatformMetrics; kept as a
// separate type so the overview card can prop-drill just the summary.
export interface AIProviderSummary {
  total: number;
  enabled: number;
  withKey: number;
}

// PlatformMetrics matches server/internal/model/model.go:PlatformMetrics and
// powers the Admin overview dashboard. All numbers are live snapshots; the
// trend array always has exactly 30 entries (days) in chronological order.
export interface PlatformMetrics {
  users: number;
  namespaces: number;
  totalSkills: number;
  skillsByStatus: Record<string, number>;
  totalReviews: number;
  reviewsByStatus: Record<string, number>;
  avgDecisionHours: number;
  slaComplianceRate: number;
  overdue: number;
  aiProviders: AIProviderSummary;
  activations30d: number;
  activationsTrend: TrendPoint[];
  recentAudit: AuditLog[];
}

export interface Comment {
  id: number;
  reviewId: number;
  author: string;
  body: string;
  createdAt: string;
  // Inline anchor (empty filePath = general comment).
  filePath?: string;
  lineNo?: number;
  side?: 'base' | 'head' | '';
}

export interface AuditLog {
  id: number;
  actor: string;
  action: string;
  target: string;
  version: string;
  ip: string;
  createdAt: string;
}

export interface Notification {
  id: number;
  kind: 'review' | 'comment' | 'publish' | 'warn';
  body: string;
  /** 'skill' | 'review' | 'audit' | '' (no target) */
  targetKind: string;
  /** For target_kind=skill -> "ns/name"; review -> review id; audit -> "" */
  targetRef: string;
  unread: boolean;
  createdAt: string;
}

export interface Me {
  username: string;
  display: string;
  role: string;
  team: string;
  email: string;
  bio: string;
  location: string;
  /** Empty string -> render initial-letter gradient fallback */
  avatarUrl: string;
  /** Cover preset id (e.g. 'sunset', 'ocean'). Used when coverFrom/coverTo are empty. */
  coverPreset: string;
  /** Custom hex color overriding the preset (#rrggbb). Empty string means "use preset". */
  coverFrom: string;
  coverTo: string;
  /** True for users with users.is_admin = 1; gates the AI provider config UI. */
  isAdmin: boolean;
  joinedAt: string;
}

export interface UpdateMeRequest {
  display?: string;
  email?: string;
  bio?: string;
  location?: string;
  coverPreset?: string;
  coverFrom?: string;
  coverTo?: string;
}

export interface MeStats {
  published: number;
  drafts: number;
  activations: number;
  ratingsReceived: number;
  avgRating: number;
  pendingReviews: number;
  reviewsCompleted: number;
}

export interface ReviewStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  overdue: number;
  slaComplianceRate: number;
  avgDecisionHours: number; // -1 when no data yet
}

export interface AuditFilter {
  actor?: string;
  action?: string;
  target?: string;
  q?: string;
  limit?: number;
}

export type CheckSeverity = 'ok' | 'warn' | 'err';
export interface ValidationCheck {
  id: string;
  label: string;
  severity: CheckSeverity;
  detail?: string;
}
export interface ValidationReport {
  skill: string;
  version: string;
  score: number;
  summary: string;
  checks: ValidationCheck[];
}

export interface RatingSummary {
  average: number;
  count: number;
  mine: number;
}
export interface RatingItem {
  username: string;
  stars: number;
  comment: string;
  createdAt: string;
}
export interface RatingsResponse {
  summary: RatingSummary;
  items: RatingItem[];
}

export interface NamespaceMember {
  username: string;
  role: 'owner' | 'maintainer' | 'reviewer' | 'member' | string;
}

export interface PolicySlot {
  Roles: string[];
  Count: number;
}
export interface PolicyPreview {
  classification: 'L1' | 'L2' | 'L3';
  mode: 'parallel' | 'serial';
  slaHours: number;
  slots: PolicySlot[];
  suggested: string[];
}

// NamespacePolicy is one row in the admin policy editor: the effective
// policy (resolved from the override row, or the global default) plus a
// flag identifying which it is.
export interface NamespacePolicy {
  classification: 'L1' | 'L2' | 'L3';
  mode: 'parallel' | 'serial';
  slaHours: number;
  slots: PolicySlot[];
  isOverride: boolean;
}

export interface NamespacePoliciesResponse {
  ns: string;
  policies: NamespacePolicy[];
}

// SkillTemplate is one of the built-in scaffolds returned by GET /templates.
// Used to pre-populate a new skill's bundle on creation.
export interface SkillTemplate {
  id: string;
  name: string;
  description: string;
}

// UpsertPolicyRequest is the body for PUT /admin/namespaces/:ns/policies/:cls.
export interface UpsertPolicyRequest {
  mode: 'parallel' | 'serial';
  slaHours: number;
  slots: PolicySlot[];
}

export interface SkillVersion {
  id: number;
  ns: string;
  name: string;
  version: string;
  status: 'draft' | 'review' | 'approved' | 'rejected' | 'published' | 'changes_requested' | string;
  author: string;
  note: string;
  reviewId: number;
  createdAt: string;
  updatedAt: string;
}

export interface SkillFile {
  path: string;
  /** Empty in list responses; populated for single-file responses. */
  content?: string;
  size: number;
  updatedAt: string;
  updatedBy: string;
}

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  icon: string;
  earned: boolean;
  rare: boolean;
  /** 0..1 */
  progress: number;
  hint?: string;
}

export interface SearchUserHit {
  username: string;
  display: string;
  role: string;
  team: string;
}

export interface SearchResult {
  skills: Skill[];
  namespaces: Namespace[];
  users: SearchUserHit[];
}

// AI provider config (admin-only view). The API key itself is never returned;
// `hasKey` indicates whether one is currently stored.
export interface AIProvider {
  id: number;
  name: string;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  enabled: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

// Trimmed projection visible to non-admin users (the editor dropdown).
export interface AIProviderRef {
  id: number;
  name: string;
  model: string;
  isDefault: boolean;
}

export interface CreateAIProviderRequest {
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  enabled: boolean;
  isDefault: boolean;
}

// All fields optional. Omitting `apiKey` preserves the stored key — sending an
// empty string is rejected by the server to avoid accidental clears.
export interface UpdateAIProviderRequest {
  name?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  enabled?: boolean;
  isDefault?: boolean;
}

// ---- PAT (Personal Access Tokens) ----------------------------------------

export interface APIToken {
  id: number;
  name: string;
  username: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsed: string | null;
}

export interface CreateAPITokenRequest {
  name: string;
  /** "30d" | "90d" | "365d" | "" (never) */
  expiresIn: string;
}

export interface CreateAPITokenResponse {
  /** Raw token value — shown once, never retrievable again. */
  token: string;
  apiToken: APIToken;
}

// ---- Webhooks -------------------------------------------------------------

export interface Webhook {
  id: number;
  /** "" = fires for all namespaces */
  ns: string;
  url: string;
  hasSecret: boolean;
  events: string[];
  enabled: boolean;
  createdBy: string;
  createdAt: string;
}

export interface CreateWebhookRequest {
  ns: string;
  url: string;
  secret?: string;
  events?: string[];
  enabled?: boolean;
}

export interface UpdateWebhookRequest {
  url?: string;
  secret?: string;
  events?: string[];
  enabled?: boolean;
}

export interface WebhookDelivery {
  id: number;
  webhookId: number;
  event: string;
  statusCode: number;
  error?: string;
  durationMs: number;
  deliveredAt: string;
}

export interface PingResult {
  statusCode: number;
  error: string;
  durationMs: number;
}

export type AIAssistAction =
  | 'outline' | 'expand' | 'polish' | 'examples'
  | 'summary' | 'translate' | 'review'
  | 'fix-validation' | 'commit-summary' | 'freeform';

// One prior turn in a multi-turn AI assist conversation. The server only
// accepts user + assistant; system is owned by the backend.
export interface AIAssistTurn {
  role: 'user' | 'assistant';
  content: string;
}

// AdminUser is the admin-facing view returned by GET /admin/users.
export interface AdminUser {
  username: string;
  display: string;
  role: string;
  team: string;
  email: string;
  isAdmin: boolean;
  isDisabled: boolean;
  joinedAt: string;
}

export interface CreateUserRequest {
  username: string;
  display?: string;
  password: string;
  role?: string;
  team?: string;
  email?: string;
  isAdmin?: boolean;
}

export interface AdminUpdateUserRequest {
  display?: string;
  role?: string;
  team?: string;
  email?: string;
  isAdmin?: boolean;
  isDisabled?: boolean;
  password?: string;
}

export interface UpdateSkillMetaRequest {
  desc?: string;
  longDesc?: string;
  icon?: string;
  iconClass?: string;
  classification?: 'L1' | 'L2' | 'L3';
  tags?: string[];
}

export interface AIAssistRequest {
  providerId: number;
  action: AIAssistAction;
  instruction?: string;
  selection?: string;
  currentContent: string;
  filePath: string;
  /** Prior turns; omit or empty for the first message. */
  history?: AIAssistTurn[];
  /** Cross-file context: path → content. */
  additionalFiles?: Record<string, string>;
  /** Validation errors for the fix-validation action. */
  validationErrors?: string[];
}
