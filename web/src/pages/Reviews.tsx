import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ClassificationTag } from '../components/Tags';
import {
  IconDownload, IconChevronRight,
} from '../components/Icons';
import { api } from '../api/client';
import { useAsync } from '../api/useAsync';
import type { Review } from '../api/types';
import { SkillIcon } from '../components/SkillIcon';
import { useLocaleText } from '../i18n/useLocaleText';

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function exportReviewsCSV(rows: Review[]) {
  const header = 'id,ns,name,version,classification,author,reviewers,status,urgency,sla,submitted_at,note';
  const body = rows.map((r) => [
    String(r.id),
    r.ns,
    r.name,
    r.version,
    r.classification,
    r.author,
    r.reviewers.join('|'),
    r.status,
    r.urgency,
    r.sla,
    new Date(r.submittedAt).toISOString(),
    r.note,
  ].map(csvEscape).join(',')).join('\n');
  const blob = new Blob([header + '\n' + body + '\n'], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `skillhub-reviews-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function fmtHours(h: number): string {
  if (h < 0) return '—';
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

const URGENCY_BG: Record<Review['urgency'], { bg: string; color: string }> = {
  overdue: { bg: 'var(--red-bg)', color: 'var(--red-text)' },
  soon: { bg: 'var(--amber-bg)', color: 'var(--amber-text)' },
  ok: { bg: 'var(--green-bg)', color: 'var(--green-text)' },
  done: { bg: 'var(--green-bg)', color: 'var(--green-text)' },
  rejected: { bg: 'var(--slate-bg, var(--bg-muted))', color: 'var(--slate-text, var(--text-subtle))' },
  changes: { bg: 'var(--amber-bg)', color: 'var(--amber-text)' },
  hot:     { bg: 'var(--red-bg)', color: 'var(--red-text)' },
};

// Reviews supports two URL params so other pages can deep-link in:
//   ?status=pending|approved|rejected|all   (default pending)
//   ?mine=1                                  (only reviews where I'm author or reviewer)
// The page mirrors any UI changes back to the URL so refresh / back keep state.
export function Reviews() {
  const { text, locale } = useLocaleText();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialStatus = (() => {
    const s = searchParams.get('status');
    return s === 'approved' || s === 'rejected' || s === 'all' ? s : 'pending';
  })() as 'pending' | 'approved' | 'rejected' | 'all';
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>(initialStatus);
  // mineOnly defaults to true so the entry-from-sidebar experience shows
  // actionable items (where I'm author or assigned reviewer), not the
  // platform-wide queue. Pass ?mine=0 to opt into the full list view —
  // this is useful for admins/maintainers auditing other namespaces.
  const [mineOnly, setMineOnly] = useState<boolean>(searchParams.get('mine') !== '0');

  const all = useAsync(() => api.listReviews(), []);
  const stats = useAsync(() => api.reviewStats(), []);
  const me = useAsync(() => api.me(), []);

  // Keep the URL in sync with the local state. Drop the params back to
  // defaults so /reviews stays clean when nothing is filtered.
  useEffect(() => {
    const next = new URLSearchParams();
    if (filter !== 'pending') next.set('status', filter);
    // mineOnly is the default; only persist the opt-out so /reviews stays
    // clean for the common case.
    if (!mineOnly) next.set('mine', '0');
    setSearchParams(next, { replace: true });
  }, [filter, mineOnly, setSearchParams]);

  // "Mine" = I authored the request OR I'm in the reviewer slot. The Reviews
  // payload already carries reviewers as a list of usernames, so this is a
  // cheap client-side filter; no extra API.
  const myUsername = me.data?.username ?? '';
  const visibleAll = useMemo(() => {
    const data = all.data ?? [];
    if (!mineOnly || !myUsername) return data;
    return data.filter((r) => r.author === myUsername || r.reviewers.includes(myUsername));
  }, [all.data, mineOnly, myUsername]);

  const counts = useMemo(() => {
    return {
      pending: visibleAll.filter((r) => r.status === 'pending').length,
      approved: visibleAll.filter((r) => r.status === 'approved').length,
      rejected: visibleAll.filter((r) => r.status === 'rejected').length,
      all: visibleAll.length,
    };
  }, [visibleAll]);

  const filtered = useMemo(() => {
    return filter === 'all' ? visibleAll : visibleAll.filter((r) => r.status === filter);
  }, [visibleAll, filter]);

  const PAGE_SIZE = 20;
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [filter, mineOnly]);
  const paginated = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  return (
    <div className="content-inner">
      <div className="page-header">
        <div>
          <h1 className="page-title">{text('Review Center', '审批中心')}</h1>
          <p className="page-subtitle">{text('As a maintainer, review Skill versions before release. SLA varies by classification: L1 24h / L2 48h / L3 72h.', '作为 maintainer，你需要审核即将发布的 Skill 版本。SLA 按密级区分：L1 24h / L2 48h / L3 72h。')}</p>
        </div>
        <div className="page-actions">
          <button
            className={`btn${mineOnly ? ' primary' : ''}`}
            onClick={() => setMineOnly((v) => !v)}
            title={mineOnly ? text('Currently showing only reviews related to me', '当前只显示与我相关的审批') : text('Show only records where I am author or reviewer', '只看作为作者或审批人的记录')}
          >
            {mineOnly ? text('✓ My View', '✓ 我的视角') : text('My View', '我的视角')}
          </button>
          <button
            className="btn"
            onClick={() => exportReviewsCSV(filtered)}
            disabled={filtered.length === 0}
          >
            <IconDownload size={14} /> {text('Export Current View (CSV)', '导出当前视图 (CSV)')}
          </button>
        </div>
      </div>

      <div className="stat-strip" style={{ marginBottom: 'var(--gap)' }}>
        <div className="stat">
          <div className="stat-label">{text('Total Reviews', '总审批数')}</div>
          <div><span className="stat-value num">{stats.data?.total ?? counts.all}</span></div>
        </div>
        <div className="stat">
          <div className="stat-label">{text('Avg. Review Time', '平均审批耗时')}</div>
          <div>
            <span className="stat-value num">
              {stats.data ? fmtHours(stats.data.avgDecisionHours) : '—'}
            </span>
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">{text('SLA Compliance', 'SLA 达成率')}</div>
          <div>
            <span className="stat-value num">
              {stats.data && (stats.data.approved + stats.data.rejected) > 0
                ? `${stats.data.slaComplianceRate.toFixed(0)}%`
                : '—'}
            </span>
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">{text('Overdue', '超时件数')}</div>
          <div>
            <span className="stat-value num" style={{ color: (stats.data?.overdue ?? 0) > 0 ? 'var(--red)' : undefined }}>
              {stats.data?.overdue ?? 0}
            </span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {([
          { id: 'pending', label: text('Pending', '待审批'), c: counts.pending },
          { id: 'approved', label: text('Approved', '已批准'), c: counts.approved },
          { id: 'rejected', label: text('Rejected', '已驳回'), c: counts.rejected },
          { id: 'all', label: text('All', '全部'), c: counts.all },
        ] as const).map((t) => (
          <button key={t.id} onClick={() => setFilter(t.id)} style={{
            padding: '6px 14px', height: 32,
            border: '1px solid', borderColor: filter === t.id ? 'var(--primary)' : 'var(--border)',
            borderRadius: 6,
            background: filter === t.id ? 'var(--primary-50)' : 'var(--bg)',
            color: filter === t.id ? 'var(--primary-700)' : 'var(--text-muted)',
            fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8,
          }}>
            {t.label}
            <span style={{
              padding: '0 6px', height: 18, fontSize: 11, fontWeight: 600,
              background: filter === t.id ? 'var(--primary)' : 'var(--bg-muted)',
              color: filter === t.id ? 'white' : 'var(--text-subtle)',
              borderRadius: 9, minWidth: 20, textAlign: 'center', lineHeight: '18px',
            }} className="num">{t.c}</span>
          </button>
        ))}
      </div>

      <div className="card">
        <div className="card-body flush table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Skill</th><th>{text('Classification', '密级')}</th><th>{text('Author', '作者')}</th><th>Reviewers</th>
                <th>{text('Submitted', '提交时间')}</th><th>SLA</th><th></th>
              </tr>
            </thead>
            <tbody>
              {all.loading && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-subtle)' }}>{text('Loading...', '加载中...')}</td></tr>}
              {all.error && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--red-text)' }}>{all.error.message}</td></tr>}
              {paginated.map((r) => (
                <tr key={r.id} onClick={() => navigate(`/reviews/${r.id}`)}>
                  <td>
                    <div className="tbl-name">
                      <SkillIcon ns={r.ns} name={r.name} size={24} fontSize={11} />
                      <div>
                        <div className="skill-name-text" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span><span style={{ color: 'var(--text-subtle)', fontWeight: 500 }}>{r.ns}/</span>{r.name}</span>
                          {r.isHotfix && (
                            <span
                              className="tag"
                              style={{ background: 'var(--red-bg)', color: 'var(--red-text)', fontSize: 10, fontWeight: 600 }}
                              title={`Hotfix: ${r.hotfixReason || text('No reason provided', '未填写原因')}`}
                            >⚡ HOTFIX</span>
                          )}
                        </div>
                        <div className="skill-name-desc"><span className="mono">v{r.version}</span></div>
                      </div>
                    </div>
                  </td>
                  <td><ClassificationTag level={r.classification} /></td>
                  <td><span className="mono" style={{ fontSize: 12.5 }}>@{r.author}</span></td>
                  <td>
                    <div className="avatar-stack">
                      {r.reviewers.map((u, i) => <div key={u} className={`avatar sm bg-${(i % 5) + 1}`} title={u}>{u[0].toUpperCase()}</div>)}
                    </div>
                  </td>
                  <td style={{ color: 'var(--text-subtle)', fontSize: 12.5 }}>{new Date(r.submittedAt).toLocaleString(locale)}</td>
                  <td><span className="tag" style={{ background: URGENCY_BG[r.urgency].bg, color: URGENCY_BG[r.urgency].color }}>{r.sla}</span></td>
                  <td><IconChevronRight size={14} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!all.loading && totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, padding: '12px 0' }}>
            <button className="btn sm" disabled={page === 0} onClick={() => setPage(0)}>«</button>
            <button className="btn sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹</button>
            <span style={{ fontSize: 12.5, color: 'var(--text-subtle)', minWidth: 80, textAlign: 'center' }}>
              {text(`${page + 1} / ${totalPages} (${filtered.length} total)`, `${page + 1} / ${totalPages}（共 ${filtered.length} 条）`)}
            </span>
            <button className="btn sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>›</button>
            <button className="btn sm" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>»</button>
          </div>
        )}
      </div>
    </div>
  );
}
