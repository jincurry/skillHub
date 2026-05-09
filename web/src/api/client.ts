import type { AuditLog, Comment, Me, Namespace, NamespaceMember, Notification, PolicyPreview, RatingsResponse, RatingSummary, Review, Skill, SkillVersion, ValidationReport } from './types';
import { clearAuth, getToken } from './auth';

const BASE = '/api/v1';

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(h: () => void): void {
  onUnauthorized = h;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...((init?.headers as Record<string, string>) || {}) };
  const tok = getToken();
  if (tok && !headers['Authorization']) headers['Authorization'] = `Bearer ${tok}`;
  const res = await fetch(BASE + path, { ...init, headers });
  if (res.status === 401) {
    clearAuth();
    if (onUnauthorized) onUnauthorized();
    throw new Error('401 unauthorized');
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) detail = j.error;
    } catch { /* ignore */ }
    throw new Error(`${res.status} ${detail}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function qs(params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) usp.append(k, v);
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

export const api = {
  login: (username: string, password: string) =>
    request<{ token: string; user: Me }>('/auth/login', {
      method: 'POST', body: JSON.stringify({ username, password }),
    }),
  me: () => request<Me>('/me'),
  myNotifications: () => request<Notification[]>('/me/notifications'),
  markNotificationsRead: (opts: { ids?: number[]; all?: boolean }) =>
    request<{ ok: true }>('/me/notifications/read', {
      method: 'POST', body: JSON.stringify(opts),
    }),
  yankSkill: (ns: string, name: string, reason: string) =>
    request<{ ok: true; status: string }>(`/skills/${ns}/${name}/yank`, {
      method: 'POST', body: JSON.stringify({ reason }),
    }),
  deprecateSkill: (ns: string, name: string, reason?: string) =>
    request<{ ok: true; status: string }>(`/skills/${ns}/${name}/deprecate`, {
      method: 'POST', body: JSON.stringify({ reason: reason ?? '' }),
    }),
  myDrafts: () => request<Skill[]>('/me/drafts'),

  namespaces: () => request<Namespace[]>('/namespaces'),
  namespaceMembers: (ns: string) => request<NamespaceMember[]>(`/namespaces/${ns}/members`),
  namespacePolicy: (ns: string, classification: 'L1' | 'L2' | 'L3') =>
    request<PolicyPreview>(`/namespaces/${ns}/policy?classification=${classification}`),

  listSkills: (filter: { ns?: string; classification?: string; status?: string; q?: string } = {}) =>
    request<Skill[]>('/skills' + qs(filter)),
  getSkill: (ns: string, name: string) => request<Skill>(`/skills/${ns}/${name}`),
  createSkill: (body: { ns: string; name: string; desc?: string; classification: 'L1' | 'L2' | 'L3'; tags?: string[] }) =>
    request<Skill>('/skills', { method: 'POST', body: JSON.stringify(body) }),
  submitForReview: (ns: string, name: string, body: { version?: string; note?: string; reviewers?: string[] } = {}) =>
    request<Review>(`/skills/${ns}/${name}/submit`, { method: 'POST', body: JSON.stringify(body) }),
  validate: (ns: string, name: string) =>
    request<ValidationReport>(`/skills/${ns}/${name}/validate`),
  listVersions: (ns: string, name: string) =>
    request<SkillVersion[]>(`/skills/${ns}/${name}/versions`),
  listRatings: (ns: string, name: string) =>
    request<RatingsResponse>(`/skills/${ns}/${name}/ratings`),
  rateSkill: (ns: string, name: string, stars: number, comment = '') =>
    request<RatingSummary>(`/skills/${ns}/${name}/ratings`, {
      method: 'POST', body: JSON.stringify({ stars, comment }),
    }),

  listReviews: (status?: 'pending' | 'approved' | 'rejected') =>
    request<Review[]>('/reviews' + qs({ status })),
  getReview: (id: number | string) => request<Review>(`/reviews/${id}`),
  decideReview: (id: number | string, decision: 'approve' | 'reject' | 'request_changes', note?: string) =>
    request<Review>(`/reviews/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision, note: note ?? '' }),
    }),
  listComments: (id: number | string) => request<Comment[]>(`/reviews/${id}/comments`),
  addComment: (id: number | string, body: string) =>
    request<Comment>(`/reviews/${id}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),

  listAuditLogs: (limit = 100) => request<AuditLog[]>('/audit-logs' + qs({ limit: String(limit) })),
};
