import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ClassificationTag, StatusPill } from '../components/Tags';
import {
  IconStar, IconFire, IconCode,
  IconArrowUp, IconArrowDown, IconAlertTriangle,
} from '../components/Icons';
import { api } from '../api/client';
import { useAsync } from '../api/useAsync';
import { RatingsPanel } from '../components/RatingsPanel';
import { TrendChart } from '../components/TrendChart';
import { renderMarkdown } from '../lib/markdown';
import { fmtRelative } from '../lib/notify';
import {
  AUDIT_ACTION_COLOR, AUDIT_ACTION_LABEL, auditCategory, shortTarget,
  type AuditCategory,
} from '../lib/audit';

export function SkillDetail() {
  const { ns = '', name = '' } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'overview' | 'versions' | 'health' | 'audit'>('overview');
  const [auditFilter, setAuditFilter] = useState<'all' | AuditCategory>('all');
  const skill = useAsync(() => api.getSkill(ns, name), [ns, name]);
  const versions = useAsync(() => api.listVersions(ns, name), [ns, name]);
  const members = useAsync(() => api.namespaceMembers(ns), [ns]);
  const auditLogs = useAsync(
    () => api.listAuditLogs({ target: `${ns}/${name}`, limit: 100 }),
    [ns, name],
  );
  // Only fetch trend when the health tab is active so we save a roundtrip
  // for users who never open it.
  const trend = useAsync(
    () => tab === 'health' ? api.getSkillTrend(ns, name, 30) : Promise.resolve([]),
    [tab, ns, name],
  );

  if (skill.loading) return <div className="content-inner"><div className="card"><div className="card-body">加载中...</div></div></div>;
  if (skill.error || !skill.data) return (
    <div className="content-inner"><div className="card"><div className="card-body" style={{ color: 'var(--red-text)' }}>
      未找到 Skill: {skill.error?.message || `${ns}/${name}`}
    </div></div></div>
  );

  const p = skill.data;

  async function doYank() {
    const reason = window.prompt('请输入撤销原因（必填，将通知作者）：');
    if (!reason || !reason.trim()) return;
    try {
      await api.yankSkill(p.ns, p.name, reason.trim());
      await skill.reload();
    } catch (e) {
      alert('操作失败：' + (e as Error).message);
    }
  }
  async function doDeprecate() {
    const reason = window.prompt('请输入弃用原因（可选）：') ?? '';
    if (!window.confirm(`确定将 ${p.ns}/${p.name} 标记为 deprecated？`)) return;
    try {
      await api.deprecateSkill(p.ns, p.name, reason.trim());
      await skill.reload();
    } catch (e) {
      alert('操作失败：' + (e as Error).message);
    }
  }

  return (
    <div className="content-inner">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-subtle)', marginBottom: 14 }}>
        <a style={{ color: 'var(--primary)', cursor: 'pointer' }} onClick={() => navigate('/skills')}>← Skills</a>
        <span style={{ color: 'var(--text-faint)' }}>/</span>
        <span>{p.ns}</span>
        <span style={{ color: 'var(--text-faint)' }}>/</span>
        <span style={{ color: 'var(--text)', fontWeight: 500 }}>{p.name}</span>
      </div>

      <div className="detail-hero">
        <div className={`skill-icon ${p.iconClass}`}>{p.icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
              <span style={{ color: 'var(--text-subtle)', fontWeight: 500 }}>{p.ns} / </span>{p.name}
            </h1>
            <ClassificationTag level={p.classification} />
            <StatusPill status={p.status} />
            {p.hot && <span className="tag amber"><IconFire size={11} /> HOT</span>}
          </div>
          <div style={{ marginTop: 8, fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55, maxWidth: 720 }}>{p.desc}</div>
          <div className="detail-hero-meta">
            <span><IconStar size={12} /> <strong style={{ color: 'var(--text)' }}>{p.rating || '—'}</strong> ({p.ratings} 评分)</span>
            <span style={{ color: 'var(--text-faint)' }}>·</span>
            <span><IconFire size={12} /> <strong style={{ color: 'var(--text)' }}>{p.activations.toLocaleString()}</strong> 激活/周</span>
            <span style={{ color: 'var(--text-faint)' }}>·</span>
            <span>由 <span className="mono">@{p.author}</span> 维护 · 更新于 {new Date(p.updatedAt).toLocaleDateString()}</span>
          </div>
        </div>
        <div className="detail-hero-actions">
          <button className="btn primary" onClick={() => navigate(`/skills/${p.ns}/${p.name}/edit`)}><IconCode size={14} /> 编辑</button>
          {p.status !== 'yanked' && p.status !== 'deprecated' && (
            <>
              <button className="btn" onClick={doDeprecate} title="标记为弃用，仍保留访问">弃用</button>
              <button className="btn" onClick={doYank} style={{ color: 'var(--red-text)' }} title="撤销发布，禁止再被激活">撤销</button>
            </>
          )}
        </div>
      </div>

      {(p.status === 'yanked' || p.status === 'deprecated') && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 14px', marginBottom: 14, borderRadius: 8,
            background: p.status === 'yanked' ? 'var(--red-bg)' : 'var(--amber-bg)',
            color: p.status === 'yanked' ? 'var(--red-text)' : 'var(--amber-text)',
            border: `1px solid ${p.status === 'yanked' ? 'var(--red)' : 'var(--amber)'}`,
            fontSize: 13,
          }}
        >
          <IconAlertTriangle size={16} />
          {p.status === 'yanked'
            ? '此 Skill 已被撤销，无法激活。请联系作者或维护者了解详情。'
            : '此 Skill 已被弃用，建议迁移到替代方案。'}
        </div>
      )}

      <div className="tabs">
        <div className={`tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>概览</div>
        <div className={`tab ${tab === 'versions' ? 'active' : ''}`} onClick={() => setTab('versions')}>版本</div>
        <div className={`tab ${tab === 'health' ? 'active' : ''}`} onClick={() => setTab('health')}>健康度</div>
        <div className={`tab ${tab === 'audit' ? 'active' : ''}`} onClick={() => setTab('audit')}>审计</div>
      </div>

      <div className="detail-grid">
        <div>
          {tab === 'overview' && (
            <>
              <div className="card">
                <div className="card-body" style={{ padding: '22px 26px' }}>
                  <div className="readme">
                    <h2>概述</h2>
                    <p><code>{p.name}</code> 由 <span className="mono">@{p.author}</span> 维护，属于 {p.ns} 命名空间，密级 {p.classification}。</p>
                    <p>{p.desc}</p>
                    {p.tags.length > 0 && (
                      <>
                        <h3>标签</h3>
                        <p>{p.tags.map((t) => <code key={t} style={{ marginRight: 6 }}>#{t}</code>)}</p>
                      </>
                    )}
                    {p.longDesc ? (
                      <div dangerouslySetInnerHTML={{ __html: renderMarkdown(p.longDesc) }} />
                    ) : (
                      <p style={{ color: 'var(--text-faint)', fontSize: 12 }}>
                        作者还没有撰写详细 README。点击“编辑”可补充 SKILL.md / README.md。
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <RatingsPanel ns={p.ns} name={p.name} />
            </>
          )}

          {tab === 'versions' && (
            <div className="card">
              <div className="card-body" style={{ padding: '6px 24px' }}>
                <div className="timeline">
                  {(versions.data ?? []).length === 0 && (
                    <div style={{ padding: 16, color: 'var(--text-subtle)', fontSize: 13 }}>
                      暂无版本记录
                    </div>
                  )}
                  {(versions.data ?? []).map((v) => {
                    const isLatest = v.version === p.version;
                    const cls = v.status === 'published' ? 'green'
                      : v.status === 'review' ? 'amber'
                      : v.status === 'changes_requested' ? 'amber'
                      : v.status === 'rejected' ? 'red'
                      : 'indigo';
                    const label = v.status === 'published' ? '已发布'
                      : v.status === 'review' ? '审批中'
                      : v.status === 'changes_requested' ? '需修改'
                      : v.status === 'rejected' ? '已驳回'
                      : v.status;
                    return (
                      <div className="timeline-item" key={v.id}>
                        <div className="timeline-dot" style={isLatest ? { background: 'var(--primary)' } : undefined} />
                        <div className="timeline-content">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}>
                            <span className="mono">v{v.version}</span>
                            <span className={`tag ${cls}`}>{label}</span>
                            {isLatest && <span className="tag green">Latest</span>}
                            {v.reviewId > 0 && (
                              <span
                                className="mono"
                                style={{ fontSize: 11, color: 'var(--primary)', cursor: 'pointer' }}
                                onClick={() => navigate(`/reviews/${v.reviewId}`)}
                              >→ 审批 #{v.reviewId}</span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>
                            <span className="mono">@{v.author}</span> · {new Date(v.createdAt).toLocaleString()}
                          </div>
                          {v.note && (
                            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>{v.note}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {tab === 'health' && (
            <div>
              <div className="stat-strip">
                <div className="stat"><div className="stat-label">激活/周</div><div><span className="stat-value num">{p.activations.toLocaleString()}</span><span className={`stat-delta ${p.delta > 0 ? 'up' : p.delta < 0 ? 'down' : 'flat'}`}>
                  {p.delta > 0 ? <IconArrowUp size={11} /> : p.delta < 0 ? <IconArrowDown size={11} /> : null}
                  {Math.abs(p.delta)}%
                </span></div></div>
                <div className="stat"><div className="stat-label">用户评分</div><div><span className="stat-value num">{p.rating || '—'}</span></div></div>
                <div className="stat"><div className="stat-label">评分数</div><div><span className="stat-value num">{p.ratings}</span></div></div>
                <div className="stat"><div className="stat-label">状态</div><div style={{ marginTop: 6 }}><StatusPill status={p.status} /></div></div>
              </div>
              <div className="card" style={{ marginTop: 'var(--gap)' }}>
                <div className="card-header">
                  <h3 className="card-title">激活趋势 <span style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 400, marginLeft: 6 }}>近 30 天 · UTC</span></h3>
                </div>
                <div className="card-body">
                  {trend.loading && <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>加载中...</div>}
                  {trend.error && <div style={{ fontSize: 12, color: 'var(--red-text)' }}>加载失败: {trend.error.message}</div>}
                  {!trend.loading && !trend.error && (
                    <TrendChart data={trend.data ?? []} height={220} />
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === 'audit' && (() => {
            const all = auditLogs.data ?? [];
            const filtered = auditFilter === 'all'
              ? all
              : all.filter((e) => auditCategory(e.action) === auditFilter);
            const filters: Array<{ id: 'all' | AuditCategory; label: string }> = [
              { id: 'all',     label: '全部' },
              { id: 'release', label: '发布' },
              { id: 'review',  label: '评审' },
              { id: 'file',    label: '文件编辑' },
              { id: 'other',   label: '其它' },
            ];
            return (
              <div className="card">
                <div className="card-header" style={{ padding: '12px 16px' }}>
                  <h3 className="card-title">
                    审计记录
                    {all.length > 0 && (
                      <span className="count-pill" style={{ marginLeft: 6 }}>{all.length}</span>
                    )}
                  </h3>
                  <a
                    style={{ fontSize: 12, color: 'var(--primary)', cursor: 'pointer' }}
                    onClick={() => navigate(`/audit?target=${encodeURIComponent(`${ns}/${name}`)}`)}
                  >查看全局日志 →</a>
                </div>
                <div style={{ display: 'flex', gap: 6, padding: '8px 16px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-soft)', flexWrap: 'wrap' }}>
                  {filters.map((f) => {
                    const isActive = auditFilter === f.id;
                    const count = f.id === 'all' ? all.length : all.filter((e) => auditCategory(e.action) === f.id).length;
                    return (
                      <button
                        key={f.id}
                        onClick={() => setAuditFilter(f.id)}
                        disabled={count === 0 && f.id !== 'all'}
                        style={{
                          padding: '3px 10px', fontSize: 12, borderRadius: 999,
                          border: '1px solid ' + (isActive ? 'var(--primary)' : 'var(--border)'),
                          background: isActive ? 'var(--primary)' : 'transparent',
                          color: isActive ? 'white' : count === 0 ? 'var(--text-faint)' : 'var(--text-subtle)',
                          cursor: count === 0 && f.id !== 'all' ? 'default' : 'pointer',
                          fontWeight: isActive ? 500 : 400,
                          opacity: count === 0 && f.id !== 'all' ? 0.5 : 1,
                          transition: 'all 0.12s',
                        }}
                      >{f.label}{f.id !== 'all' && count > 0 ? ` · ${count}` : ''}</button>
                    );
                  })}
                </div>
                <div className="card-body flush">
                  {auditLogs.loading && <div style={{ padding: 16, color: 'var(--text-subtle)', fontSize: 13 }}>加载中...</div>}
                  {auditLogs.error && <div style={{ padding: 16, color: 'var(--red-text)', fontSize: 13 }}>{auditLogs.error.message}</div>}
                  {!auditLogs.loading && !auditLogs.error && filtered.length === 0 && (
                    <div style={{ padding: '28px 16px', color: 'var(--text-subtle)', textAlign: 'center', fontSize: 13 }}>
                      {all.length === 0 ? '该 skill 还没有任何审计记录' : `暂无此类别记录`}
                    </div>
                  )}
                  {filtered.map((e) => {
                    const detail = shortTarget(e.target, ns, name);
                    return (
                      <div key={e.id} style={{
                        display: 'grid',
                        gridTemplateColumns: '120px 110px 130px minmax(0, 1fr)',
                        gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--border)',
                        fontSize: 12.5, alignItems: 'center',
                      }}>
                        <span style={{ color: 'var(--text-subtle)', fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5 }} title={new Date(e.createdAt).toLocaleString()}>
                          {fmtRelative(e.createdAt)}
                        </span>
                        <span className="mono" style={{ fontSize: 11.5, color: e.actor === 'system' ? 'var(--text-faint)' : 'var(--primary)' }}>@{e.actor}</span>
                        <span><span className={`tag ${AUDIT_ACTION_COLOR[e.action] || ''}`}>{AUDIT_ACTION_LABEL[e.action] || e.action}</span></span>
                        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {detail ? (
                            <span className="mono" style={{ color: 'var(--text)' }}>{detail}</span>
                          ) : (
                            <span style={{ color: 'var(--text-faint)' }}>—</span>
                          )}
                          {e.version && <span className="mono" style={{ color: 'var(--text-faint)', marginLeft: 6, fontSize: 11 }}>{e.version}</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>

        <div>
          <div className="card" style={{ marginBottom: 'var(--gap)' }}>
            <div className="card-header" style={{ padding: '12px 16px' }}><h3 className="card-title">元数据</h3></div>
            <div className="card-body" style={{ padding: '14px 16px' }}>
              <div className="meta-list">
                <div className="meta-row"><span className="k">命名空间</span><span className="v mono">{p.ns}</span></div>
                <div className="meta-row"><span className="k">当前版本</span><span className="v mono">v{p.version}</span></div>
                <div className="meta-row"><span className="k">密级</span><span className="v"><ClassificationTag level={p.classification} /></span></div>
                <div className="meta-row"><span className="k">作者</span><span className="v mono">@{p.author}</span></div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header" style={{ padding: '12px 16px' }}><h3 className="card-title">维护者</h3></div>
            <div className="card-body flush">
              {(() => {
                const list = (members.data ?? []).filter(
                  (m) => m.role === 'owner' || m.role === 'maintainer',
                );
                // Always surface the author at the top, even if their ns role is lower.
                const authorIn = list.find((m) => m.username === p.author);
                const ordered = authorIn
                  ? [authorIn, ...list.filter((m) => m.username !== p.author)]
                  : [{ username: p.author, role: 'author' as const }, ...list];
                if (members.loading) {
                  return <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-subtle)' }}>加载中...</div>;
                }
                return ordered.map((m, i) => (
                  <div key={m.username} style={{
                    padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10,
                    borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                  }}>
                    <div className={`avatar sm bg-${(i % 5) + 1}`}>{m.username[0]?.toUpperCase()}</div>
                    <div style={{ flex: 1, fontSize: 13 }}>
                      <div style={{ fontWeight: 500 }} className="mono">@{m.username}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', textTransform: 'capitalize' }}>
                        {m.username === p.author ? `Author · ${m.role}` : m.role}
                      </div>
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
