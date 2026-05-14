import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ClassificationTag, StatusPill } from '../components/Tags';
import {
  IconStar, IconFire, IconCode,
  IconArrowUp, IconArrowDown, IconAlertTriangle,
  IconFile, IconChevronRight, IconDownload, IconPlus,
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

// Pre-fills the "new draft version" prompt with a sensible default. The server
// re-runs the same logic so the prompt is just UX — the user can override.
function bumpedPatch(v: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return v;
  return `${m[1]}.${m[2]}.${parseInt(m[3], 10) + 1}`;
}

export function SkillDetail() {
  const { ns = '', name = '' } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'overview' | 'files' | 'versions' | 'health' | 'audit'>('overview');
  const [auditFilter, setAuditFilter] = useState<'all' | AuditCategory>('all');
  const skill = useAsync(() => api.getSkill(ns, name), [ns, name]);
  const versions = useAsync(() => api.listVersions(ns, name), [ns, name]);
  const members = useAsync(() => api.namespaceMembers(ns), [ns]);
  const me = useAsync(() => api.me(), []);
  const files = useAsync(() => api.listFiles(ns, name), [ns, name]);
  const auditLogs = useAsync(
    () => api.listAuditLogs({ target: `${ns}/${name}`, limit: 100 }),
    [ns, name],
  );
  // Path of the file currently shown in the 文件 tab viewer. Defaults to
  // SKILL.md (or whatever is alphabetically first) once the list arrives.
  const [activePath, setActivePath] = useState<string | null>(null);
  const activeFile = useAsync(
    () => activePath
      ? api.getFile(ns, name, activePath)
      : Promise.resolve(null),
    [ns, name, activePath],
  );
  // Pull SKILL.md content for the overview tab. We don't gate this on
  // tab === 'overview' because the same file is also what the 文件 tab
  // shows by default, and useAsync caches per-deps.
  const skillMd = (files.data ?? []).find(
    (f) => f.path.toLowerCase() === 'skill.md' || f.path.toLowerCase() === 'readme.md',
  );
  const skillMdContent = useAsync(
    () => skillMd ? api.getFile(ns, name, skillMd.path) : Promise.resolve(null),
    [ns, name, skillMd?.path],
  );
  // Only fetch trend when the health tab is active so we save a roundtrip
  // for users who never open it.
  const trend = useAsync(
    () => tab === 'health' ? api.getSkillTrend(ns, name, 30) : Promise.resolve([]),
    [tab, ns, name],
  );

  // dist_tags + subscription state. Kept top-level (above early returns) so
  // hook order stays stable on the loading branch.
  const distTags = useAsync(() => api.listDistTags(ns, name), [ns, name]);
  const subState = useAsync(() => api.getSubscriptionState(ns, name), [ns, name]);
  const [subBusy, setSubBusy] = useState(false);
  const [distModalOpen, setDistModalOpen] = useState(false);
  async function toggleSubscribe() {
    if (subBusy) return;
    setSubBusy(true);
    try {
      const subbed = subState.data?.subscribed ?? false;
      if (subbed) await api.unsubscribeSkill(ns, name);
      else await api.subscribeSkill(ns, name);
      subState.reload();
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setSubBusy(false);
    }
  }

  // Pick a sensible default file once the listing comes back. SKILL.md is
  // the primary surface so it wins over README.md / skill.yaml.
  // IMPORTANT: this must run BEFORE the early-return guards below so the
  // hook order stays stable between loading and loaded renders.
  useEffect(() => {
    if (!files.data || files.data.length === 0) return;
    if (activePath && files.data.some((f) => f.path === activePath)) return;
    const preferred = ['SKILL.md', 'README.md', 'skill.yaml'];
    const pick = preferred.find((pp) => files.data!.some((f) => f.path === pp))
      ?? files.data[0].path;
    setActivePath(pick);
  }, [files.data, activePath]);

  if (skill.loading) return <div className="content-inner"><div className="card"><div className="card-body">加载中...</div></div></div>;
  if (skill.error || !skill.data) return (
    <div className="content-inner"><div className="card"><div className="card-body" style={{ color: 'var(--red-text)' }}>
      未找到 Skill: {skill.error?.message || `${ns}/${name}`}
    </div></div></div>
  );

  const p = skill.data;

  // Permission model — mirrors backend api.go:
  //   * canEditSkill (used by file PUT/DELETE + 编辑 button + 提交审批):
  //       author OR ns owner OR ns maintainer
  //   * lifecycleAction (used by 弃用 / 撤销):
  //       ns owner OR ns maintainer (author alone isn't enough)
  //   * everyone else (incl. plain members / non-members): read-only
  //     can still rate, view files, browse versions/audit.
  const myUsername = me.data?.username ?? '';
  const myRole = (members.data ?? []).find((m) => m.username === myUsername)?.role ?? '';
  const isAuthor = myUsername !== '' && p.author === myUsername;
  const isMaintainer = myRole === 'owner' || myRole === 'maintainer';
  const canEdit = isAuthor || isMaintainer;
  const canManageLifecycle = isMaintainer; // author alone is NOT allowed
  const showLifecycleButtons = canManageLifecycle && p.status !== 'yanked' && p.status !== 'deprecated';

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

  // Bump a published / yanked / deprecated skill into a fresh draft so the
  // author can iterate. We let the user override the auto-bumped version
  // because patch-bumps don't always match intent (a major refactor wants
  // a minor or major bump).
  async function doCreateDraft() {
    const suggested = bumpedPatch(p.version);
    const v = window.prompt(
      `为 ${p.ns}/${p.name} 新建草稿版本。\n当前 v${p.version} → 新版本号（留空使用建议 v${suggested}）：`,
      suggested,
    );
    if (v === null) return; // user cancelled
    try {
      await api.createSkillDraft(p.ns, p.name, v.trim());
      await skill.reload();
      navigate(`/skills/${p.ns}/${p.name}/edit`);
    } catch (e) {
      alert('操作失败：' + (e as Error).message);
    }
  }

  async function doDownloadBundle() {
    try {
      await api.downloadBundle(p.ns, p.name);
    } catch (e) {
      alert('下载失败：' + (e as Error).message);
    }
  }

  function openDistTagsModal() { setDistModalOpen(true); }

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
            {(subState.data?.count ?? 0) > 0 && (
              <>
                <span style={{ color: 'var(--text-faint)' }}>·</span>
                <span>{subState.data!.count} 关注</span>
              </>
            )}
          </div>
          {(distTags.data ?? []).length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {distTags.data!.map((t) => (
                <span
                  key={t.tag}
                  className={`tag ${t.tag === 'latest' ? 'green' : t.tag === 'stable' ? 'indigo' : t.tag === 'beta' ? 'amber' : ''}`}
                  title={`${t.tag} → v${t.version} · 更新于 ${new Date(t.updatedAt).toLocaleString()} by @${t.updatedBy || 'system'}`}
                  style={{ fontSize: 11 }}
                >
                  {t.tag} <span className="mono" style={{ marginLeft: 4, opacity: 0.85 }}>v{t.version}</span>
                </span>
              ))}
              {canEdit && (
                <button
                  className="btn sm ghost"
                  style={{ fontSize: 11, padding: '2px 8px' }}
                  onClick={openDistTagsModal}
                  title="管理 dist tags(latest/stable/beta/...)"
                >编辑</button>
              )}
            </div>
          )}
        </div>
        <div className="detail-hero-actions">
          {/* Download bundle — available to everyone who can see the skill. */}
          <button
            className="btn"
            onClick={doDownloadBundle}
            title={`下载 ${p.ns}/${p.name} v${p.version} 的文件 bundle (.tar.gz)`}
          ><IconDownload size={14} /> 下载</button>

          {/* Subscribe: writes an in-app notification on every publish. */}
          <button
            className={`btn ${subState.data?.subscribed ? 'primary' : ''}`}
            onClick={toggleSubscribe}
            disabled={subBusy}
            title={subState.data?.subscribed ? '取消关注以停止接收发布通知' : '关注以接收新版本发布通知'}
          >
            {subState.data?.subscribed ? '✓ 已关注' : '+ 关注'}
          </button>

          {canEdit ? (
            // The primary CTA depends on status: draft/review → continue
            // editing; published/yanked/deprecated → spawn a new draft.
            p.status === 'draft' || p.status === 'review' ? (
              <button
                className="btn primary"
                onClick={() => navigate(`/skills/${p.ns}/${p.name}/edit`)}
                title={isAuthor ? '编辑你的 skill' : `以 ${myRole} 身份编辑此 skill`}
              ><IconCode size={14} /> 编辑</button>
            ) : (
              <button
                className="btn primary"
                onClick={doCreateDraft}
                title="以新版本号创建一个可编辑的草稿"
              ><IconPlus size={14} /> 新建草稿版本</button>
            )
          ) : (
            <span
              className="tag"
              title="你不是该 skill 的作者，也不是该命名空间的 owner/maintainer"
              style={{ background: 'var(--bg-soft)', color: 'var(--text-faint)', fontWeight: 400 }}
            >只读</span>
          )}
          {showLifecycleButtons && (
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
        <div className={`tab ${tab === 'files' ? 'active' : ''}`} onClick={() => setTab('files')}>
          文件
          {files.data && files.data.length > 0 && (
            <span className="count" style={{ marginLeft: 6 }}>{files.data.length}</span>
          )}
        </div>
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
                    {/* Prefer the real SKILL.md / README.md content over the
                        synthetic longDesc; fall back gracefully through:
                          1. fetched file content
                          2. legacy longDesc field (used by older seeds)
                          3. "no readme yet" hint */}
                    {skillMd && skillMdContent.loading && (
                      <p style={{ color: 'var(--text-faint)', fontSize: 12 }}>正在加载 {skillMd.path}...</p>
                    )}
                    {skillMd && skillMdContent.data?.content ? (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, marginBottom: 8, fontSize: 11, color: 'var(--text-faint)' }}>
                          <IconFile size={12} />
                          <span className="mono">{skillMd.path}</span>
                          <span>·</span>
                          <a
                            style={{ color: 'var(--primary)', cursor: 'pointer' }}
                            onClick={() => setTab('files')}
                          >浏览全部文件 →</a>
                        </div>
                        <div dangerouslySetInnerHTML={{ __html: renderMarkdown(skillMdContent.data.content) }} />
                      </>
                    ) : p.longDesc ? (
                      <div dangerouslySetInnerHTML={{ __html: renderMarkdown(p.longDesc) }} />
                    ) : (
                      <p style={{ color: 'var(--text-faint)', fontSize: 12 }}>
                        作者还没有撰写 SKILL.md / README.md{canEdit ? '。点击"编辑"可以补充。' : '。'}
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <RatingsPanel ns={p.ns} name={p.name} />
            </>
          )}

          {tab === 'files' && (
            <div className="card">
              <div className="card-body" style={{ padding: 0 }}>
                {/* Two-column layout: file index on the left, content on the
                    right. We keep this read-only — actual editing lives in the
                    /edit route which is permission-gated. */}
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 220px) 1fr', minHeight: 360 }}>
                  <div style={{ borderRight: '1px solid var(--border)', padding: '10px 6px', overflowY: 'auto' }}>
                    {files.loading && <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text-faint)' }}>加载中...</div>}
                    {!files.loading && (files.data ?? []).length === 0 && (
                      <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text-faint)' }}>暂无文件</div>
                    )}
                    {(files.data ?? []).map((f) => {
                      const active = f.path === activePath;
                      return (
                        <div
                          key={f.path}
                          onClick={() => setActivePath(f.path)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '6px 10px', borderRadius: 6,
                            cursor: 'pointer', marginBottom: 2,
                            background: active ? 'var(--primary-50, rgba(79,70,229,0.1))' : 'transparent',
                            color: active ? 'var(--primary-700, var(--primary))' : 'var(--text)',
                            fontWeight: active ? 500 : 400,
                          }}
                          title={f.path}
                        >
                          <IconFile size={12} />
                          <span className="mono" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{f.path}</span>
                          <IconChevronRight size={11} style={{ color: 'var(--text-faint)' }} />
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ padding: '14px 20px', overflowX: 'auto' }}>
                    {!activePath && (
                      <div style={{ color: 'var(--text-faint)', fontSize: 13 }}>从左侧选择一个文件查看内容。</div>
                    )}
                    {activePath && activeFile.loading && (
                      <div style={{ color: 'var(--text-faint)', fontSize: 13 }}>加载 {activePath}...</div>
                    )}
                    {activePath && activeFile.error && (
                      <div style={{ color: 'var(--red-text)', fontSize: 13 }}>读取失败：{activeFile.error.message}</div>
                    )}
                    {activePath && activeFile.data && (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 12, color: 'var(--text-faint)' }}>
                          <IconFile size={12} />
                          <span className="mono" style={{ color: 'var(--text)', fontSize: 13 }}>{activePath}</span>
                          <span>·</span>
                          <span>{activeFile.data.size} 字节</span>
                          {activeFile.data.updatedBy && (
                            <>
                              <span>·</span>
                              <span>@{activeFile.data.updatedBy} 更新于 {fmtRelative(activeFile.data.updatedAt)}</span>
                            </>
                          )}
                        </div>
                        {/^.*\.(md|markdown)$/i.test(activePath) ? (
                          <div className="readme" dangerouslySetInnerHTML={{ __html: renderMarkdown(activeFile.data.content ?? '') }} />
                        ) : (
                          <pre style={{
                            background: 'var(--bg-soft)', border: '1px solid var(--border)',
                            borderRadius: 6, padding: '12px 14px',
                            fontSize: 12, lineHeight: 1.55, overflowX: 'auto',
                            margin: 0,
                          }}><code className="mono">{activeFile.data.content ?? ''}</code></pre>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
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

      {distModalOpen && (
        <DistTagsModal
          ns={p.ns}
          name={p.name}
          versions={(versions.data ?? []).map((v) => v.version)}
          tags={distTags.data ?? []}
          onClose={() => setDistModalOpen(false)}
          onChange={() => distTags.reload()}
        />
      )}
    </div>
  );
}

// DistTagsModal: a focused panel for pinning/removing dist tags. We pass in
// the version list so the value picker stays a controlled dropdown — typing
// raw versions worked for the old prompt UI but was easy to get wrong.
// "latest" is auto-managed by the publish flow; we let admins override it
// for rollback scenarios but warn inline.
function DistTagsModal({
  ns, name, versions, tags, onClose, onChange,
}: {
  ns: string;
  name: string;
  versions: string[];
  tags: import('../api/types').DistTag[];
  onClose: () => void;
  onChange: () => void;
}) {
  const [tagInput, setTagInput] = useState('stable');
  const [versionInput, setVersionInput] = useState(versions[0] ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function applySet() {
    setErr(null);
    if (!tagInput.trim() || !versionInput.trim()) {
      setErr('tag 与 version 必填'); return;
    }
    setBusy(true);
    try {
      await api.setDistTag(ns, name, tagInput.trim(), versionInput.trim());
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function applyDelete(tag: string) {
    if (!window.confirm(`确定删除 tag "${tag}"?`)) return;
    setErr(null); setBusy(true);
    try {
      await api.deleteDistTag(ns, name, tag);
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--bg)', borderRadius: 10, width: 520, maxWidth: '92vw', boxShadow: '0 20px 50px rgba(15,23,42,0.25)', border: '1px solid var(--border)' }}
      >
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 600 }}>管理 Dist Tags</div>
          <button className="btn sm ghost" onClick={onClose}>关闭</button>
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ fontSize: 12.5, color: 'var(--text-subtle)', marginBottom: 8 }}>现有 tags</div>
            {tags.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>暂无</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {tags.map((t) => (
                  <div key={t.tag} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                    <span
                      className={`tag ${t.tag === 'latest' ? 'green' : t.tag === 'stable' ? 'indigo' : t.tag === 'beta' ? 'amber' : ''}`}
                      style={{ fontSize: 11 }}
                    >{t.tag}</span>
                    <span className="mono" style={{ color: 'var(--text)' }}>v{t.version}</span>
                    <span style={{ color: 'var(--text-faint)', fontSize: 11.5, flex: 1 }}>
                      by @{t.updatedBy || 'system'} · {new Date(t.updatedAt).toLocaleString()}
                    </span>
                    <button
                      className="btn sm ghost"
                      disabled={busy || t.tag === 'latest'}
                      onClick={() => applyDelete(t.tag)}
                      title={t.tag === 'latest' ? 'latest 由发布流程自动维护,不可手动删除' : '删除该 tag'}
                      style={{ color: t.tag === 'latest' ? 'var(--text-faint)' : 'var(--red-text)' }}
                    >删除</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <div style={{ fontSize: 12.5, color: 'var(--text-subtle)', marginBottom: 8 }}>新增 / 修改</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                className="input"
                placeholder="tag (e.g. stable)"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                style={{ flex: 1, fontSize: 12.5 }}
              />
              <span style={{ color: 'var(--text-faint)' }}>→</span>
              <select
                className="input"
                value={versionInput}
                onChange={(e) => setVersionInput(e.target.value)}
                style={{ flex: 1, fontSize: 12.5 }}
              >
                {versions.length === 0 && <option value="">(no versions)</option>}
                {versions.map((v) => <option key={v} value={v}>v{v}</option>)}
              </select>
              <button className="btn primary sm" disabled={busy} onClick={applySet}>
                {busy ? '...' : '应用'}
              </button>
            </div>
            {tagInput.trim() === 'latest' && (
              <div style={{ fontSize: 11, color: 'var(--amber-text)', marginTop: 6 }}>
                提示:latest 通常由发布流程自动管理,手动修改可作为回滚使用。
              </div>
            )}
            {err && <div style={{ fontSize: 11.5, color: 'var(--red-text)', marginTop: 6 }}>{err}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
