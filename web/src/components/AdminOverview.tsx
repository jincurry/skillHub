import { useMemo } from 'react';
import { api } from '../api/client';
import { useAsync } from '../api/useAsync';
import { TrendChart } from './TrendChart';
import { AUDIT_ACTION_COLOR, auditActionLabel } from '../lib/audit';
import { fmtRelative } from '../lib/notify';
import { useLocaleText } from '../i18n/useLocaleText';

/**
 * AdminOverview is the dashboard on the admin page's 概览 tab. It fans out a
 * single GET /admin/metrics call and arranges the result into:
 *   - 4 top KPI cards (users, namespaces, total skills, total reviews)
 *   - a two-column grid:
 *       left : platform-wide 30-day activation trend (reuses TrendChart)
 *       right: SLA / AI / review-status at-a-glance cards
 *   - a bottom "最近操作" audit feed (last 10 entries)
 *
 * Everything is derived; we intentionally don't store the metrics in any
 * other state so a `reload()` gives a fresh snapshot.
 */
export function AdminOverview() {
  const { text, isEnglish } = useLocaleText();
  const m = useAsync(() => api.adminMetrics(), []);
  const data = m.data;

  // Derive KPI strip values. Wrapped in useMemo only so the format helpers
  // don't rerun on every auditLog hover.
  const kpis = useMemo(() => {
    if (!data) return null;
    return [
      {
        label: isEnglish ? 'Platform Users' : '平台用户',
        value: data.users.toLocaleString(),
        color: 'var(--primary)',
      },
      {
        label: isEnglish ? 'Namespaces' : '命名空间',
        value: data.namespaces.toLocaleString(),
        color: '#10b981',
      },
      {
        label: isEnglish ? 'Total Skills' : 'Skills 总数',
        value: data.totalSkills.toLocaleString(),
        sub: skillsBreakdown(data.skillsByStatus, isEnglish),
        color: '#6366f1',
      },
      {
        label: isEnglish ? 'Total Reviews' : '审批总数',
        value: data.totalReviews.toLocaleString(),
        sub: reviewsBreakdown(data.reviewsByStatus, data.overdue, isEnglish),
        color: '#f59e0b',
      },
    ];
  }, [data, isEnglish]);

  if (m.loading) {
    return <div className="card"><div className="card-body" style={{ color: 'var(--text-subtle)' }}>{text('Loading platform metrics...', '加载平台指标...')}</div></div>;
  }
  if (m.error || !data) {
    return (
      <div className="card">
        <div className="card-body" style={{ color: 'var(--red-text)', fontSize: 13 }}>
          {text('Load failed: ', '加载失败：')}{m.error?.message ?? text('Unknown error', '未知错误')}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
      {/* KPI strip -------------------------------------------------------- */}
      <div className="stat-strip">
        {kpis?.map((k) => (
          <div className="stat" key={k.label}>
            <div className="stat-label">{k.label}</div>
            <div>
              <span className="stat-value num" style={{ color: k.color }}>{k.value}</span>
              {k.sub && <span style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginLeft: 8 }}>{k.sub}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Two-column body -------------------------------------------------- */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)', gap: 'var(--gap)' }}>
        {/* Left: platform activation trend */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              {isEnglish ? 'Platform Activation Trend' : '平台激活趋势'}
              <span style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 400, marginLeft: 6 }}>
                {isEnglish ? 'Last 30 days · UTC' : '近 30 天 · UTC'}
              </span>
            </h3>
            <span className="num" style={{ fontSize: 13, color: 'var(--text-subtle)' }}>
              {isEnglish ? 'Total' : '合计'} <b style={{ color: 'var(--text)', fontWeight: 600 }}>{data.activations30d.toLocaleString()}</b>
            </span>
          </div>
          <div className="card-body">
            <TrendChart data={data.activationsTrend} height={220} label={isEnglish ? 'Activations' : '激活'} />
          </div>
        </div>

        {/* Right: SLA + AI + risk cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
          {/* SLA card */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">{text('Review SLA', '审批 SLA')}</h3>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <MiniRow
                label={isEnglish ? 'Compliance' : '达成率'}
                value={data.slaComplianceRate > 0
                  ? `${data.slaComplianceRate.toFixed(1)}%`
                  : '—'}
                tone={slaTone(data.slaComplianceRate)}
              />
              <MiniRow
                label={isEnglish ? 'Average Time' : '平均耗时'}
                value={data.avgDecisionHours >= 0 ? fmtHours(data.avgDecisionHours, isEnglish) : '—'}
              />
              <MiniRow
                label={isEnglish ? 'Overdue' : '超时中'}
                value={data.overdue.toLocaleString()}
                tone={data.overdue > 0 ? 'red' : 'green'}
              />
            </div>
          </div>

          {/* AI card */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">{isEnglish ? 'AI Models' : 'AI 模型'}</h3>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <MiniRow label={isEnglish ? 'Configured' : '已配置'} value={data.aiProviders.total.toLocaleString()} />
              <MiniRow
                label={isEnglish ? 'Enabled' : '启用中'}
                value={data.aiProviders.enabled.toLocaleString()}
                tone={data.aiProviders.enabled > 0 ? 'green' : undefined}
              />
              <MiniRow
                label={isEnglish ? 'Keys Set' : '已填 Key'}
                value={data.aiProviders.withKey.toLocaleString()}
                tone={data.aiProviders.withKey < data.aiProviders.total ? 'amber' : undefined}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Recent audit feed ----------------------------------------------- */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">{text('Recent Activity', '最近操作')} <span style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 400, marginLeft: 6 }}>Top 10</span></h3>
        </div>
        <div className="card-body flush table-wrap">
          {data.recentAudit.length === 0 ? (
            <div style={{ padding: 16, fontSize: 12, color: 'var(--text-subtle)' }}>{text('No records', '暂无记录')}</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 120 }}>{text('Time', '时间')}</th>
                  <th style={{ width: 140 }}>{text('Action', '操作')}</th>
                  <th style={{ width: 120 }}>{text('User', '用户')}</th>
                  <th>{text('Target', '目标')}</th>
                </tr>
              </thead>
              <tbody>
                {data.recentAudit.map((a) => {
                  const color = AUDIT_ACTION_COLOR[a.action] ?? '';
                  return (
                    <tr key={a.id}>
                      <td style={{ fontSize: 12, color: 'var(--text-subtle)' }}>{fmtRelative(a.createdAt)}</td>
                      <td>
                        <span className={`tag ${color || 'slate'}`} style={{ fontSize: 10.5 }}>
                          {auditActionLabel(a.action, isEnglish)}
                        </span>
                      </td>
                      <td><span className="mono" style={{ fontSize: 12.5 }}>@{a.actor}</span></td>
                      <td style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                        <span className="mono">{a.target}</span>
                        {a.version && (
                          <span className="mono" style={{ marginLeft: 8, color: 'var(--text-faint)' }}>{a.version}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function MiniRow({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'amber' | 'red' }) {
  const color = tone === 'green' ? 'var(--green-text)'
    : tone === 'amber' ? 'var(--amber-text)'
    : tone === 'red' ? 'var(--red-text)'
    : 'var(--text)';
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', fontSize: 13 }}>
      <span style={{ color: 'var(--text-subtle)' }}>{label}</span>
      <span className="num" style={{ fontWeight: 600, color }}>{value}</span>
    </div>
  );
}

function slaTone(pct: number): 'green' | 'amber' | 'red' | undefined {
  if (pct <= 0) return undefined;
  if (pct >= 95) return 'green';
  if (pct >= 80) return 'amber';
  return 'red';
}

function skillsBreakdown(by: Record<string, number>, isEnglish: boolean): string {
  const parts: string[] = [];
  if (by.published) parts.push(`${by.published} ${isEnglish ? 'Published' : '已发布'}`);
  if (by.review) parts.push(`${by.review} ${isEnglish ? 'In Review' : '审批中'}`);
  if (by.draft) parts.push(`${by.draft} ${isEnglish ? 'Drafts' : '草稿'}`);
  if (by.yanked) parts.push(`${by.yanked} ${isEnglish ? 'Yanked' : '撤回'}`);
  return parts.join(' · ');
}

function reviewsBreakdown(by: Record<string, number>, overdue: number, isEnglish: boolean): string {
  const parts: string[] = [];
  if (by.pending) parts.push(`${by.pending} ${isEnglish ? 'Pending' : '待审'}`);
  if (overdue > 0) parts.push(`${overdue} ${isEnglish ? 'Overdue' : '超时'}`);
  if (by.approved) parts.push(`${by.approved} ${isEnglish ? 'Approved' : '通过'}`);
  if (by.rejected) parts.push(`${by.rejected} ${isEnglish ? 'Rejected' : '驳回'}`);
  return parts.join(' · ');
}

function fmtHours(h: number, isEnglish: boolean): string {
  if (h < 0) return '—';
  if (h < 1) return `${Math.round(h * 60)} ${isEnglish ? 'min' : '分钟'}`;
  if (h < 24) return `${h.toFixed(1)} ${isEnglish ? 'h' : '小时'}`;
  return `${(h / 24).toFixed(1)} ${isEnglish ? 'd' : '天'}`;
}
