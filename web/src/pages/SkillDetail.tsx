import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ClassificationTag, StatusPill } from '../components/Tags';
import { Sparkline } from '../components/Sparkline';
import {
  IconStar, IconFire, IconUsers, IconCopy, IconBookmark, IconCode, IconDownload,
  IconArrowUp, IconArrowDown, IconAlertTriangle,
} from '../components/Icons';
import { api } from '../api/client';
import { useAsync } from '../api/useAsync';
import { RatingsPanel } from '../components/RatingsPanel';

export function SkillDetail() {
  const { ns = '', name = '' } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'overview' | 'versions' | 'health' | 'audit'>('overview');
  const skill = useAsync(() => api.getSkill(ns, name), [ns, name]);
  const versions = useAsync(() => api.listVersions(ns, name), [ns, name]);

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
            <span><IconUsers size={12} /> {Math.max(1, Math.round(p.activations / 10))} 用户</span>
            <span style={{ color: 'var(--text-faint)' }}>·</span>
            <span>由 <span className="mono">@{p.author}</span> 维护 · 更新于 {new Date(p.updatedAt).toLocaleDateString()}</span>
          </div>
          <div className="install-block">
            <span className="pmt">$</span>
            <span className="cmd">skillhub install {p.ns}/{p.name}@{p.version}</span>
            <button className="copy-btn"><IconCopy size={11} /> 复制</button>
          </div>
        </div>
        <div className="detail-hero-actions">
          <button className="btn"><IconBookmark size={14} /> 收藏</button>
          <button className="btn" onClick={() => navigate(`/skills/${p.ns}/${p.name}/edit`)}><IconCode size={14} /> 编辑</button>
          <button className="btn primary"><IconDownload size={14} /> 安装</button>
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
                    <h3>标签</h3>
                    <p>{p.tags.map((t) => <code key={t} style={{ marginRight: 6 }}>#{t}</code>)}</p>
                    <h3>使用示例</h3>
                    <pre><code>{`# 安装并运行
skillhub install ${p.ns}/${p.name}@${p.version}
skillhub run ${p.name}`}</code></pre>
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
                  <div className="timeline-item">
                    <div className="timeline-dot" style={{ background: 'var(--primary)' }} />
                    <div className="timeline-content">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}>
                        <span className="mono">v{p.version}</span>
                        <span className="tag green">Latest</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>
                        <span className="mono">@{p.author}</span> · {new Date(p.updatedAt).toLocaleString()}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>当前发布版本</div>
                    </div>
                  </div>
                  {(versions.data ?? []).map((v) => {
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
                        <div className="timeline-dot" />
                        <div className="timeline-content">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}>
                            <span className="mono">v{v.version}</span>
                            <span className={`tag ${cls}`}>{label}</span>
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
                </span></div><Sparkline data={[820, 860, 900, 950, 1010, 1080, 1120, 1180, p.activations]} /></div>
                <div className="stat"><div className="stat-label">用户评分</div><div><span className="stat-value num">{p.rating || '—'}</span></div></div>
                <div className="stat"><div className="stat-label">评分数</div><div><span className="stat-value num">{p.ratings}</span></div></div>
                <div className="stat"><div className="stat-label">状态</div><div style={{ marginTop: 6 }}><StatusPill status={p.status} /></div></div>
              </div>
            </div>
          )}

          {tab === 'audit' && (
            <div className="card"><div className="card-body" style={{ color: 'var(--text-subtle)' }}>
              单 skill 审计视图待实现 — 暂时请到 <a style={{ color: 'var(--primary)', cursor: 'pointer' }} onClick={() => navigate('/audit')}>审计日志</a> 查看全局记录。
            </div></div>
          )}
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
                <div className="meta-row"><span className="k">License</span><span className="v">Internal</span></div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header" style={{ padding: '12px 16px' }}><h3 className="card-title">维护者</h3></div>
            <div className="card-body flush">
              <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="avatar sm bg-1">{p.author[0]?.toUpperCase()}</div>
                <div style={{ flex: 1, fontSize: 13 }}>
                  <div style={{ fontWeight: 500 }} className="mono">@{p.author}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>Owner</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
