import type { Achievement, AIProvider, AIProviderRef, AuditFilter, AuditLog, Comment, CreateAIProviderRequest, Me, MeStats, Namespace, NamespaceMember, NamespacePoliciesResponse, Notification, PlatformMetrics, PolicyPreview, RatingsResponse, RatingSummary, Review, ReviewFile, ReviewStats, SearchResult, Skill, SkillFile, SkillVersion, TrendPoint, UpdateAIProviderRequest, UpdateMeRequest, UpsertPolicyRequest, ValidationReport } from './types';
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
  updateMe: (body: UpdateMeRequest) =>
    request<Me>('/me', { method: 'PATCH', body: JSON.stringify(body) }),
  /** Upload a new avatar image (multipart). Returns the refreshed Me row. */
  uploadAvatar: async (file: File): Promise<Me> => {
    const fd = new FormData();
    fd.append('avatar', file);
    const tok = getToken();
    const headers: Record<string, string> = {};
    if (tok) headers['Authorization'] = `Bearer ${tok}`;
    const res = await fetch(BASE + '/me/avatar', { method: 'POST', body: fd, headers });
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
    return (await res.json()) as Me;
  },
  /** Remove the current user's avatar (server deletes the file). */
  deleteAvatar: () => request<Me>('/me/avatar', { method: 'DELETE' }),
  meStats: () => request<MeStats>('/me/stats'),
  meAchievements: () => request<Achievement[]>('/me/achievements'),
  search: (q: string) => request<SearchResult>('/search' + qs({ q })),
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
  // createSkillDraft transitions a published/yanked/deprecated skill into a
  // fresh editable draft. Empty body = auto-bump patch.
  createSkillDraft: (ns: string, name: string, version?: string) =>
    request<Skill>(`/skills/${ns}/${name}/draft`, {
      method: 'POST', body: JSON.stringify({ version: version ?? '' }),
    }),
  // downloadBundle fetches a tar.gz and triggers a browser download. Returns
  // the suggested filename so the caller can surface a "downloaded X" toast.
  downloadBundle: async (ns: string, name: string): Promise<string> => {
    const tok = getToken();
    const res = await fetch(`${BASE}/skills/${ns}/${name}/bundle`, {
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const j = (await res.json()) as { error?: string };
        if (j?.error) detail = j.error;
      } catch { /* ignore */ }
      throw new Error(`${res.status} ${detail}`);
    }
    // Parse filename from Content-Disposition; fall back to `${ns}-${name}.tar.gz`.
    const cd = res.headers.get('Content-Disposition') ?? '';
    const m = /filename="([^"]+)"/.exec(cd);
    const filename = m?.[1] ?? `${ns}-${name}.tar.gz`;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return filename;
  },
  myDrafts: () => request<Skill[]>('/me/drafts'),

  namespaces: () => request<Namespace[]>('/namespaces'),
  createNamespace: (body: { id: string; owner?: string }) =>
    request<Namespace>('/namespaces', { method: 'POST', body: JSON.stringify(body) }),
  namespaceMembers: (ns: string) => request<NamespaceMember[]>(`/namespaces/${ns}/members`),
  addNamespaceMember: (ns: string, body: { username: string; role: string }) =>
    request<NamespaceMember[]>(`/namespaces/${ns}/members`, {
      method: 'POST', body: JSON.stringify(body),
    }),
  updateNamespaceMemberRole: (ns: string, username: string, role: string) =>
    request<NamespaceMember[]>(`/namespaces/${ns}/members/${encodeURIComponent(username)}`, {
      method: 'PATCH', body: JSON.stringify({ role }),
    }),
  removeNamespaceMember: (ns: string, username: string) =>
    request<NamespaceMember[]>(`/namespaces/${ns}/members/${encodeURIComponent(username)}`, {
      method: 'DELETE',
    }),
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
  getSkillTrend: (ns: string, name: string, days = 30) =>
    request<TrendPoint[]>(`/skills/${ns}/${name}/trend?days=${days}`),

  listFiles: (ns: string, name: string) =>
    request<SkillFile[]>(`/skills/${ns}/${name}/files`),
  getFile: (ns: string, name: string, path: string) =>
    request<SkillFile>(`/skills/${ns}/${name}/files/${encodeURI(path)}`),
  putFile: (ns: string, name: string, path: string, content: string) =>
    request<SkillFile>(`/skills/${ns}/${name}/files/${encodeURI(path)}`, {
      method: 'PUT', body: JSON.stringify({ content }),
    }),
  deleteFile: (ns: string, name: string, path: string) =>
    request<void>(`/skills/${ns}/${name}/files/${encodeURI(path)}`, {
      method: 'DELETE',
    }),
  /**
   * Move a file from one path to another inside the same skill bundle.
   * Uses a sibling endpoint (not /files/*) because the wildcard there would
   * eat the "rename" segment.
   */
  renameFile: (ns: string, name: string, from: string, to: string) =>
    request<SkillFile>(`/skills/${ns}/${name}/rename-file`, {
      method: 'POST', body: JSON.stringify({ from, to }),
    }),
  listRatings: (ns: string, name: string) =>
    request<RatingsResponse>(`/skills/${ns}/${name}/ratings`),
  rateSkill: (ns: string, name: string, stars: number, comment = '') =>
    request<RatingSummary>(`/skills/${ns}/${name}/ratings`, {
      method: 'POST', body: JSON.stringify({ stars, comment }),
    }),

  listReviews: (status?: 'pending' | 'approved' | 'rejected') =>
    request<Review[]>('/reviews' + qs({ status })),
  reviewStats: () => request<ReviewStats>('/reviews/stats'),
  getReview: (id: number | string) => request<Review>(`/reviews/${id}`),
  decideReview: (id: number | string, decision: 'approve' | 'reject' | 'request_changes', note?: string) =>
    request<Review>(`/reviews/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision, note: note ?? '' }),
    }),
  listComments: (id: number | string) => request<Comment[]>(`/reviews/${id}/comments`),
  addComment: (id: number | string, body: string) =>
    request<Comment>(`/reviews/${id}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),
  addReviewer: (id: number | string, username: string) =>
    request<Review>(`/reviews/${id}/reviewers`, {
      method: 'POST', body: JSON.stringify({ username }),
    }),
  removeReviewer: (id: number | string, username: string) =>
    request<Review>(`/reviews/${id}/reviewers/${encodeURIComponent(username)}`, {
      method: 'DELETE',
    }),
  listReviewFiles: (id: number | string) => request<ReviewFile[]>(`/reviews/${id}/files`),

  listAuditLogs: (filter: AuditFilter = {}) => {
    const limit = filter.limit ?? 200;
    return request<AuditLog[]>('/audit-logs' + qs({
      actor: filter.actor,
      action: filter.action,
      target: filter.target,
      q: filter.q,
      limit: String(limit),
    }));
  },

  // ---- AI providers (admin) ---------------------------------------------
  listAIProviders: () => request<AIProvider[]>('/admin/ai-providers'),
  createAIProvider: (body: CreateAIProviderRequest) =>
    request<AIProvider>('/admin/ai-providers', { method: 'POST', body: JSON.stringify(body) }),
  updateAIProvider: (id: number, body: UpdateAIProviderRequest) =>
    request<AIProvider>(`/admin/ai-providers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteAIProvider: (id: number) =>
    request<{ ok: true }>(`/admin/ai-providers/${id}`, { method: 'DELETE' }),
  /** One-token ping against the upstream. Returns `{ok:true}` on success or throws. */
  testAIProvider: (id: number) =>
    request<{ ok: true; status: number }>(`/admin/ai-providers/${id}/test`, { method: 'POST' }),

  // ---- Namespace approval policies (admin) ------------------------------
  listNamespacePolicies: (ns: string) =>
    request<NamespacePoliciesResponse>(`/admin/namespaces/${ns}/policies`),
  upsertNamespacePolicy: (ns: string, classification: 'L1' | 'L2' | 'L3', body: UpsertPolicyRequest) =>
    request<NamespacePoliciesResponse>(
      `/admin/namespaces/${ns}/policies/${classification}`,
      { method: 'PUT', body: JSON.stringify(body) },
    ),
  deleteNamespacePolicy: (ns: string, classification: 'L1' | 'L2' | 'L3') =>
    request<NamespacePoliciesResponse>(
      `/admin/namespaces/${ns}/policies/${classification}`,
      { method: 'DELETE' },
    ),

  // ---- Namespace lifecycle (admin) --------------------------------------
  // Hard delete. Fails with HTTP 409 if the namespace still owns any skills.
  adminDeleteNamespace: (ns: string) =>
    request<{ ok: true }>(`/admin/namespaces/${ns}`, { method: 'DELETE' }),
  // Hard delete a skill and all its descendants (versions / files / ratings
  // / reviews / comments / snapshots / metrics / notifications). Admin-only.
  adminDeleteSkill: (ns: string, name: string) =>
    request<{ ok: true }>(`/admin/skills/${ns}/${name}`, { method: 'DELETE' }),

  // ---- Platform metrics (admin overview) --------------------------------
  adminMetrics: () => request<PlatformMetrics>('/admin/metrics'),

  // ---- AI providers (any logged-in user) --------------------------------
  listAIProviderRefs: () => request<AIProviderRef[]>('/ai/providers'),
};
