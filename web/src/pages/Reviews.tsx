import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClassificationTag } from '../components/Tags';
import {
  IconDownload, IconCheckCircle, IconChevronRight,
} from '../components/Icons';
import { api } from '../api/client';
import { useAsync } from '../api/useAsync';
import type { Review } from '../api/types';

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
};

export function Reviews() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const all = useAsync(() => api.listReviews(), []);
  const stats = useAsync(() => api.reviewStats(), []);

  const counts = useMemo(() => {
    const data = all.data ?? [];
    return {
      pending: data.filter((r) => r.status === 'pending').length,
      approved: data.filter((r) => r.status === 'approved').length,
      rejected: data.filter((r) => r.status === 'rejected').length,
      all: data.length,
    };
  }, [all.data]);

  const filtered = useMemo(() => {
    const data = all.data ?? [];
    return filter === 'all' ? data : data.filter((r) => r.status === filter);
  }, [all.data, filter]);

  return (
    <div className="content-inner">
      <div className="page-header">
        <div>
          <h1 className="page-title">审批中心</h1>
          <p className="page-subtitle">作为 maintainer,你需要审核即将发布或撤回的 Skill 版本。SLA 默认 72 小时。</p>
        </div>
        <div className="page-actions">
          <button className="btn"><IconDownload size={14} /> 导出报表</button>
          <button className="btn primary"><IconCheckCircle size={14} /> 批量批准</button>
        </div>
      </div>

      <div className="stat-strip" style={{ marginBottom: 'var(--gap)' }}>
        <div className="stat">
          <div className="stat-label">总审批数</div>
          <div><span className="stat-value num">{stats.data?.total ?? counts.all}</span></div>
        </div>
        <div className="stat">
          <div className="stat-label">平均审批耗时</div>
          <div>
            <span className="stat-value num">
              {stats.data ? fmtHours(stats.data.avgDecisionHours) : '—'}
            </span>
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">SLA 达成率</div>
          <div>
            <span className="stat-value num">
              {stats.data && (stats.data.approved + stats.data.rejected) > 0
                ? `${stats.data.slaComplianceRate.toFixed(0)}%`
                : '—'}
            </span>
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">超时件数</div>
          <div>
            <span className="stat-value num" style={{ color: (stats.data?.overdue ?? 0) > 0 ? 'var(--red)' : undefined }}>
              {stats.data?.overdue ?? 0}
            </span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {([
          { id: 'pending', label: '待审批', c: counts.pending },
          { id: 'approved', label: '已批准', c: counts.approved },
          { id: 'rejected', label: '已驳回', c: counts.rejected },
          { id: 'all', label: '全部', c: counts.all },
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
                <th>Skill</th><th>密级</th><th>作者</th><th>Reviewers</th>
                <th>提交时间</th><th>SLA</th><th></th>
              </tr>
            </thead>
            <tbody>
              {all.loading && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-subtle)' }}>加载中...</td></tr>}
              {all.error && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--red-text)' }}>{all.error.message}</td></tr>}
              {filtered.map((r) => (
                <tr key={r.id} onClick={() => navigate(`/reviews/${r.id}`)}>
                  <td>
                    <div className="tbl-name">
                      <div className="skill-icon blue" style={{ width: 24, height: 24, fontSize: 11 }}>{r.name.slice(0, 2).toUpperCase()}</div>
                      <div>
                        <div className="skill-name-text"><span style={{ color: 'var(--text-subtle)', fontWeight: 500 }}>{r.ns}/</span>{r.name}</div>
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
                  <td style={{ color: 'var(--text-subtle)', fontSize: 12.5 }}>{new Date(r.submittedAt).toLocaleString()}</td>
                  <td><span className="tag" style={{ background: URGENCY_BG[r.urgency].bg, color: URGENCY_BG[r.urgency].color }}>{r.sla}</span></td>
                  <td><IconChevronRight size={14} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
