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
  urgency: 'overdue' | 'soon' | 'ok' | 'done' | 'rejected' | 'changes';
  sla: string;
  note: string;
  submittedAt: string;
}

export interface Comment {
  id: number;
  reviewId: number;
  author: string;
  body: string;
  createdAt: string;
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
  joinedAt: string;
}

export interface UpdateMeRequest {
  display?: string;
  email?: string;
  bio?: string;
  location?: string;
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
