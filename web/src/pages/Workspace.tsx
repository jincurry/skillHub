import { useNavigate } from 'react-router-dom';
import { Sparkline } from '../components/Sparkline';
import { StatusPill, ClassificationTag } from '../components/Tags';
import {
  IconPlus, IconDownload, IconArrowUp, IconArrowDown, IconCheckCircle,
  IconAlertTriangle, IconXCircle, IconCode, IconRocket, IconExternal,
  IconChevronDown, IconCheck, IconBell, IconChat, IconChevronRight, IconMore,
} from '../components/Icons';
import { api } from '../api/client';
import { useAsync } from '../api/useAsync';
import { openCreateSkill } from '../components/CreateSkillModal';
import type { Notification, Review, Skill, ValidationReport } from '../api/types';

const DRAFT_CHECKS_FALLBACK = [
  { severity: 'ok' as const, label: 'Schema' },
];

function DraftCard({ d }: { d: Skill }) {
  const navigate = useNavigate();
  const v = useAsync<ValidationReport>(() => api.validate(d.ns, d.name), [d.ns, d.name]);
  const checks = v.data?.checks ?? DRAFT_CHECKS_FALLBACK;
  const blocked = (v.data?.checks ?? []).some((c) => c.severity === 'err');
  const editPath = `/skills/${d.ns}/${d.name}/edit`;
  return (
    <div className="draft-card">
      <div className="draft-card-head">
        <div className="draft-card-name">
          <div className={`skill-icon ${d.iconClass}`}>{d.icon}</div>
          <div>
            <div><span className="ns">{d.ns} /</span> {d.name}</div>
            <div className="draft-card-meta" style={{ margin: 0, marginTop: 2 }}>
              <span className="mono">v{d.version}</span>
              <span className="sep">·</span>
              <span>{new Date(d.updatedAt).toLocaleDateString()}</span>
              <span className="sep">·</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span className="status-pill draft"><span className="swatch"></span>Draft</span>
              </span>
            </div>
          </div>
        </div>
        <button className="icon-btn" style={{ width: 28, height: 28 }}><IconMore size={16} /></button>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 12px', lineHeight: 1.5 }}>{d.desc}</div>
      <div className="draft-checks">
        {checks.slice(0, 4).map((c, i) => (
          <span key={i} className={`check-chip ${c.severity}`}>
            {c.severity === 'ok' && <IconCheckCircle size={12} />}
            {c.severity === 'warn' && <IconAlertTriangle size={12} />}
            {c.severity === 'err' && <IconXCircle size={12} />}
            {c.label}
          </span>
        ))}
        {v.data && (
          <span className="check-chip" style={{
            background: 'var(--bg-soft)',
            color: v.data.score >= 90 ? 'var(--green-text)' : v.data.score >= 70 ? 'var(--amber-text)' : 'var(--red-text)',
            fontWeight: 600,
          }}>{v.data.score}/100</span>
        )}
      </div>
      <div className="draft-actions">
        <button className="btn sm" onClick={() => navigate(editPath)}>
          <IconCode size={13} /> 继续编辑
        </button>
        <button className="btn sm" onClick={() => v.reload()} disabled={v.loading}>
          <IconCheckCircle size={13} /> {v.loading ? '验证中...' : 'Validate'}
        </button>
        <button
          className="btn sm primary"
          disabled={blocked}
          title={blocked ? '存在错误，先到编辑器修复' : undefined}
          onClick={() => navigate(editPath)}
        >
          <IconRocket size={13} /> 提交审批
        </button>
      </div>
    </div>
  );
}

function NotificationItem({ n }: { n: Notification }) {
  const iconMap = {
    review: { bg: 'var(--primary-50)', color: 'var(--primary)', el: <IconCheckCircle size={14} /> },
    comment: { bg: 'var(--blue-bg)', color: 'var(--blue-text)', el: <IconChat size={14} /> },
    publish: { bg: 'var(--green-bg)', color: 'var(--green-text)', el: <IconRocket size={14} /> },
    warn: { bg: 'var(--amber-bg)', color: 'var(--amber-text)', el: <IconAlertTriangle size={14} /> },
  } as const;
  const ic = iconMap[n.kind] || iconMap.comment;
  return (
    <div className={`feed-item ${n.unread ? 'unread' : ''}`}>
      <div className="feed-icon" style={{ background: ic.bg, color: ic.color }}>{ic.el}</div>
      <div className="feed-content">
        <div>{n.body}</div>
        <div className="feed-time">{new Date(n.createdAt).toLocaleString()}</div>
      </div>
    </div>
  );
}

function PendingReviewItem({ r }: { r: Review }) {
  const navigate = useNavigate();
  const ucol = ({
    overdue: { color: 'var(--red-text)', dot: 'var(--red)' },
    soon: { color: 'var(--amber-text)', dot: 'var(--amber)' },
    ok: { color: 'var(--green-text)', dot: 'var(--green)' },
    done: { color: 'var(--green-text)', dot: 'var(--green)' },
    rejected: { color: 'var(--text-subtle)', dot: 'var(--text-faint)' },
    changes: { color: 'var(--amber-text)', dot: 'var(--amber)' },
  } as const)[r.urgency] ?? { color: 'var(--text-subtle)', dot: 'var(--text-faint)' };
  return (
    <div onClick={() => navigate(`/reviews/${r.id}`)}
      style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
      <div style={{ width: 6, alignSelf: 'stretch', borderRadius: 3, background: ucol.dot, flexShrink: 0, minHeight: 36 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
          <span style={{ color: 'var(--text-subtle)', fontWeight: 500 }}>{r.ns}/</span>
          <span>{r.name}</span>
          <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>v{r.version}</span>
          <ClassificationTag level={r.classification} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
          by <span className="mono">@{r.author}</span> · <span style={{ color: ucol.color, fontWeight: 500 }}>{r.note || r.sla}</span>
        </div>
      </div>
      <IconChevronRight size={14} />
    </div>
  );
}

export function Workspace() {
  const navigate = useNavigate();
  const me = useAsync(() => api.me(), []);
  const drafts = useAsync(() => api.myDrafts(), []);
  const mySkills = useAsync(async () => {
    const u = await api.me();
    const all = await api.listSkills();
    return all.filter((s) => s.author === u.username && s.status !== 'draft');
  }, []);
  const notifs = useAsync(() => api.myNotifications(), []);
  const pending = useAsync(() => api.listReviews('pending'), []);

  const draftCount = drafts.data?.length ?? 0;
  const pendingCount = pending.data?.length ?? 0;
  const greeting = me.data ? `早上好,${me.data.display.split(' ')[0]} 👋` : '早上好 👋';

  // Live KPIs derived from data we already have. No fabricated numbers.
  const myPublished = (mySkills.data ?? []).filter((s) => s.status === 'published');
  const totalActivations = (mySkills.data ?? []).reduce((acc, s) => acc + s.activations, 0);
  const ratedSkills = (mySkills.data ?? []).filter((s) => s.ratings > 0);
  const avgRating = ratedSkills.length
    ? ratedSkills.reduce((a, s) => a + s.rating, 0) / ratedSkills.length
    : 0;
  const overdueReviews = (pending.data ?? []).filter((r) => r.urgency === 'overdue').length;

  async function markAllRead() {
    if (!notifs.data?.some((n) => n.unread)) return;
    try {
      await api.markNotificationsRead({ all: true });
      notifs.reload();
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="content-inner">
      <div className="page-header">
        <div>
          <h1 className="page-title">{greeting}</h1>
          <p className="page-subtitle">
            你有 <strong style={{ color: 'var(--text)' }}>{draftCount} 个 draft</strong> 待处理,
            <strong style={{ color: 'var(--primary)' }}> {pendingCount} 项审批</strong> 等你确认。
          </p>
        </div>
        <div className="page-actions">
          <button className="btn"><IconDownload size={14} /> 从 CLI 拉取</button>
          <button className="btn primary" onClick={openCreateSkill}><IconPlus size={14} /> 创建 Skill</button>
        </div>
      </div>

      <div className="stat-strip">
        <div className="stat">
          <div className="stat-label">我的激活/周</div>
          <div>
            <span className="stat-value num">{totalActivations.toLocaleString()}</span>
            <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 8 }}>
              横跨 {myPublished.length} 个 published
            </span>
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">我的草稿</div>
          <div>
            <span className="stat-value num">{draftCount}</span>
            {draftCount > 0 && (
              <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 8 }}>待提交</span>
            )}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">待我审批</div>
          <div>
            <span className="stat-value num" style={{ color: overdueReviews ? 'var(--red)' : undefined }}>
              {pendingCount}
            </span>
            {overdueReviews > 0 && (
              <span className="stat-delta down" style={{ marginLeft: 8 }}>
                <IconArrowDown size={11} />{overdueReviews} 超时
              </span>
            )}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">平均评分</div>
          <div>
            <span className="stat-value num">{avgRating > 0 ? avgRating.toFixed(1) : '—'}</span>
            {ratedSkills.length > 0 && (
              <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 8 }}>
                / 5 · {ratedSkills.length} 个 skill
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="workspace-grid">
        <div>
          <div style={{ marginBottom: 'var(--gap)' }}>
            <div className="sec-title">
              <span>我的 Drafts <span style={{ color: 'var(--text-faint)', fontWeight: 500, marginLeft: 4 }}>{draftCount}</span></span>
              <a className="meta" style={{ color: 'var(--primary)', cursor: 'pointer' }}>查看全部 →</a>
            </div>
            {drafts.loading && <div className="card"><div className="card-body" style={{ color: 'var(--text-subtle)' }}>加载中...</div></div>}
            {drafts.error && <div className="card"><div className="card-body" style={{ color: 'var(--red-text)' }}>加载失败: {drafts.error.message}</div></div>}
            {drafts.data?.length === 0 && <div className="card"><div className="card-body" style={{ color: 'var(--text-subtle)' }}>暂无草稿</div></div>}
            {drafts.data?.map((d) => <DraftCard key={d.id} d={d} />)}
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="card-title">我发布的 Skills <span className="tag outline" style={{ marginLeft: 6 }}>{mySkills.data?.length ?? 0}</span></h3>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="dropdown">全部命名空间 <IconChevronDown size={12} /></button>
                <button className="btn sm ghost"><IconExternal size={13} /></button>
              </div>
            </div>
            <div className="card-body flush table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Skill</th><th>状态</th>
                    <th style={{ textAlign: 'right' }}>当前版本</th>
                    <th style={{ textAlign: 'right' }}>激活/周</th>
                    <th style={{ textAlign: 'right' }}>趋势</th>
                    <th style={{ textAlign: 'right' }}>更新时间</th>
                  </tr>
                </thead>
                <tbody>
                  {mySkills.data?.map((s) => (
                    <tr key={s.id} onClick={() => navigate(`/skills/${s.ns}/${s.name}`)}>
                      <td>
                        <div className="tbl-name">
                          <div className={`skill-icon ${s.iconClass}`}>{s.icon}</div>
                          <div>
                            <div className="skill-name-text"><span style={{ color: 'var(--text-subtle)', fontWeight: 500 }}>{s.ns}/</span>{s.name}</div>
                          </div>
                        </div>
                      </td>
                      <td><StatusPill status={s.status} /></td>
                      <td style={{ textAlign: 'right' }}><span className="mono num">v{s.version}</span></td>
                      <td className="num" style={{ textAlign: 'right', fontWeight: 500 }}>{s.activations.toLocaleString()}</td>
                      <td style={{ textAlign: 'right' }}>
                        {s.delta !== 0 ? (
                          <span className={s.delta > 0 ? 'stat-delta up' : 'stat-delta down'}>
                            {s.delta > 0 ? <IconArrowUp size={11} /> : <IconArrowDown size={11} />}
                            {Math.abs(s.delta)}%
                          </span>
                        ) : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--text-subtle)', fontSize: 12.5 }}>{new Date(s.updatedAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="quick-actions-row">
            <div className="quick-action" onClick={openCreateSkill}>
              <div className="qa-icon"><IconPlus size={16} /></div>
              <div className="qa-text"><span className="qa-title">创建新 Skill</span><span className="qa-desc">从模板或空白开始</span></div>
            </div>
            <div className="quick-action">
              <div className="qa-icon" style={{ background: 'var(--green-bg)', color: 'var(--green-text)' }}><IconCode size={16} /></div>
              <div className="qa-text"><span className="qa-title">从 CLI 拉取</span><span className="qa-desc"><span className="mono">skillhub init</span></span></div>
            </div>
          </div>
        </div>

        <div>
          <div className="card" style={{ marginBottom: 'var(--gap)' }}>
            <div className="card-header" style={{ padding: '12px 16px' }}>
              <h3 className="card-title">
                <IconCheck size={14} stroke={2} />
                待我审批
                <span className="tag indigo" style={{ marginLeft: 4 }}>{pendingCount}</span>
              </h3>
              <a style={{ fontSize: 12, color: 'var(--primary)', cursor: 'pointer' }} onClick={() => navigate('/reviews')}>全部 →</a>
            </div>
            <div className="card-body flush">
              {pending.data?.map((r) => <PendingReviewItem key={r.id} r={r} />)}
            </div>
          </div>

          <div className="card">
            <div className="card-header" style={{ padding: '12px 16px' }}>
              <h3 className="card-title">
                <IconBell size={14} />
                需要我关注
                <span className="tag" style={{ marginLeft: 4 }}>
                  {notifs.data?.filter((n) => n.unread).length ?? 0} 未读
                </span>
              </h3>
              <a
                style={{ fontSize: 12, color: 'var(--text-subtle)', cursor: 'pointer' }}
                onClick={markAllRead}
              >全部已读</a>
            </div>
            <div className="card-body flush feed">
              {notifs.data?.map((n) => <NotificationItem key={n.id} n={n} />)}
            </div>
            <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
              <a style={{ fontSize: 12.5, color: 'var(--primary)', cursor: 'pointer', fontWeight: 500 }}>查看全部通知 →</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
