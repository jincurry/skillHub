import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ClassificationTag, StatusPill } from '../components/Tags';
import {
  IconStar, IconFire, IconCode,
  IconArrowUp, IconArrowDown, IconAlertTriangle,
  IconFile, IconChevronRight, IconPlus, IconX,
} from '../components/Icons';
import { api } from '../api/client';
import { useAsync } from '../api/useAsync';
import { RatingsPanel } from '../components/RatingsPanel';
import { TrendChart } from '../components/TrendChart';
import { VersionExplorer } from '../components/VersionExplorer';
import { DownloadMenu } from '../components/DownloadMenu';
import { SkillIcon } from '../components/SkillIcon';
import { renderMarkdown } from '../lib/markdown';
import { fmtRelative } from '../lib/notify';
import { shouldDisplaySkillFile } from '../lib/files';
import {
  AUDIT_ACTION_COLOR, auditActionLabel, auditCategory, shortTarget,
  type AuditCategory,
} from '../lib/audit';
import { useLocaleText } from '../i18n/useLocaleText';
import { useConfirm } from '../components/useConfirm';
import { usePrompt } from '../components/usePrompt';
import { toast } from '../lib/toast';

// Pre-fills the "new draft version" prompt with a sensible default. The server
// re-runs the same logic so the prompt is just UX — the user can override.
function bumpedPatch(v: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return v;
  return `${m[1]}.${m[2]}.${parseInt(m[3], 10) + 1}`;
}

const DRAFT_VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

export function SkillDetail() {
  const { ns = '', name = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { text, isEnglish, locale } = useLocaleText();
  // The page-level confirm dialog is owned by inner modals (DistTagsModal)
  // that have their own destructive flows. The page itself only needs a
  // prompt for yank / deprecate reasons.
  const [prompt, promptEl] = usePrompt();
  type Tab = 'overview' | 'files' | 'versions' | 'health' | 'audit';
  // Honor a deep-link from another page (e.g. the editor's "查看历史版本"
  // button). We read both react-router state and the URL hash so plain
  // /skills/ns/name#versions also works.
  const initialTab: Tab = (() => {
    const fromState = (location.state as { tab?: string } | null)?.tab;
    const fromHash = location.hash.replace(/^#/, '');
    const cand = fromState || fromHash;
    return cand === 'files' || cand === 'versions' || cand === 'health' || cand === 'audit'
      ? cand : 'overview';
  })();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [auditFilter, setAuditFilter] = useState<'all' | AuditCategory>('all');
  const skill = useAsync(() => api.getSkill(ns, name), [ns, name]);
  const versions = useAsync(() => api.listVersions(ns, name), [ns, name]);
  const members = useAsync(() => api.namespaceMembers(ns), [ns]);
  const me = useAsync(() => api.me(), []);
  const files = useAsync(() => api.listFiles(ns, name), [ns, name]);
  const displayFiles = useMemo(
    () => (files.data ?? []).filter((f) => shouldDisplaySkillFile(f.path)),
    [files.data],
  );
  const auditLogs = useAsync(
    () => api.listAuditLogs({ target: `${ns}/${name}`, limit: 100 }),
    [ns, name],
  );
  // Path of the file currently shown in the 文件 tab viewer. Defaults to
  // SKILL.md (or whatever is alphabetically first) once the list arrives.
  const [activePath, setActivePath] = useState<string | null>(null);
  // Metadata from the list response (has blobHash). Used to skip fetching
  // blob-backed binary files — their content endpoint returns octet-stream,
  // not JSON, so calling getFile on them would throw a parse error.
  const activeFileMeta = displayFiles.find((f) => f.path === activePath);
  const activeFile = useAsync(
    () => activePath && !activeFileMeta?.blobHash
      ? api.getFile(ns, name, activePath)
      : Promise.resolve(null),
    [ns, name, activePath, activeFileMeta?.blobHash],
  );
  // Pull SKILL.md content for the overview tab. We don't gate this on
  // tab === 'overview' because the same file is also what the 文件 tab
  // shows by default, and useAsync caches per-deps.
  const skillMd = displayFiles.find((f) => f.path.toLowerCase() === 'skill.md');
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
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [editMetaOpen, setEditMetaOpen] = useState(false);
  const [createDraftOpen, setCreateDraftOpen] = useState(false);
  async function toggleSubscribe() {
    if (subBusy) return;
    setSubBusy(true);
    try {
      const subbed = subState.data?.subscribed ?? false;
      if (subbed) await api.unsubscribeSkill(ns, name);
      else await api.subscribeSkill(ns, name);
      subState.reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubBusy(false);
    }
  }

  // Pick a sensible default file once the listing comes back. SKILL.md is
  // the primary surface so it wins over skill.yaml.
  // IMPORTANT: this must run BEFORE the early-return guards below so the
  // hook order stays stable between loading and loaded renders.
  useEffect(() => {
    if (!files.data || displayFiles.length === 0) return;
    if (activePath && displayFiles.some((f) => f.path === activePath)) return;
    const preferred = ['SKILL.md', 'skill.yaml'];
    const pick = preferred.find((pp) => displayFiles.some((f) => f.path === pp))
      ?? displayFiles[0].path;
    setActivePath(pick);
  }, [files.data, displayFiles, activePath]);

  if (skill.loading) return <div className="content-inner"><div className="card"><div className="card-body">{text('Loading...', '加载中...')}</div></div></div>;
  if (skill.error || !skill.data) return (
    <div className="content-inner"><div className="card"><div className="card-body" style={{ color: 'var(--red-text)' }}>
      {text('Skill not found: ', '未找到 Skill: ')}{skill.error?.message || `${ns}/${name}`}
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
    const reason = await prompt({
      title: text('Yank skill', '撤销 Skill'),
      message: text(
        'Enter a yank reason. The author will be notified.',
        '请输入撤销原因，将通知作者。',
      ),
      detail: text('A reason is required for yank.', '撤销操作必须填写原因。'),
      placeholder: text('e.g. CVE-2025-1234 — leaks tokens', '例如：CVE-2025-1234，存在敏感信息泄漏'),
      required: true,
      confirmLabel: text('Yank', '撤销'),
      cancelLabel: text('Cancel', '取消'),
      tone: 'danger',
    });
    if (reason === null || !reason.trim()) return;
    try {
      await api.yankSkill(p.ns, p.name, reason.trim());
      await skill.reload();
    } catch (e) {
      toast.error(text('Action failed: ', '操作失败：') + (e as Error).message);
    }
  }
  async function doDeprecate() {
    const reason = await prompt({
      title: text('Deprecate skill', '弃用 Skill'),
      message: text(
        `Mark ${p.ns}/${p.name} as deprecated? An optional reason will be shown to consumers.`,
        `确定将 ${p.ns}/${p.name} 标记为 deprecated？可选的原因会展示给使用方。`,
      ),
      placeholder: text('Optional — e.g. superseded by foo/bar v2', '可选 — 例如：已被 foo/bar v2 取代'),
      confirmLabel: text('Deprecate', '弃用'),
      cancelLabel: text('Cancel', '取消'),
      tone: 'danger',
    });
    if (reason === null) return;
    try {
      await api.deprecateSkill(p.ns, p.name, reason.trim());
      await skill.reload();
    } catch (e) {
      toast.error(text('Action failed: ', '操作失败：') + (e as Error).message);
    }
  }

  async function doRollback(targetVersion: string, reason: string) {
    try {
      await api.rollbackSkill(p.ns, p.name, targetVersion, reason);
      await skill.reload();
      await versions.reload();
      await distTags.reload();
      setRollbackOpen(false);
    } catch (e) {
      toast.error(text('Rollback failed: ', '回滚失败：') + (e as Error).message);
    }
  }

  // Bump a published / yanked / deprecated skill into a fresh draft so the
  // author can iterate. We let the user override the auto-bumped version
  // because patch-bumps don't always match intent (a major refactor wants
  // a minor or major bump).
  async function doCreateDraft(version: string) {
    await api.createSkillDraft(p.ns, p.name, version.trim());
    await skill.reload();
    setCreateDraftOpen(false);
    navigate(`/skills/${p.ns}/${p.name}/edit`);
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
        <SkillIcon ns={p.ns} name={p.name} icon={p.icon} iconClass={p.iconClass} size={56} borderRadius={12} fontSize={22} />
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
            <span><IconStar size={12} /> <strong style={{ color: 'var(--text)' }}>{p.rating || '—'}</strong> ({p.ratings} {text('ratings', '评分')})</span>
            <span style={{ color: 'var(--text-faint)' }}>·</span>
            <span><IconFire size={12} /> <strong style={{ color: 'var(--text)' }}>{p.activations.toLocaleString()}</strong> {text('activations/week', '激活/周')}</span>
            <span style={{ color: 'var(--text-faint)' }}>·</span>
            <span>
              {text('Maintained by ', '由 ')}<span className="mono">@{p.author}</span>{text(' · updated ', ' 维护 · 更新于 ')}
              {new Date(p.updatedAt).toLocaleDateString(locale)}
            </span>
            {(subState.data?.count ?? 0) > 0 && (
              <>
                <span style={{ color: 'var(--text-faint)' }}>·</span>
                <span>{subState.data!.count} {text('subscribers', '关注')}</span>
              </>
            )}
          </div>
          {(distTags.data ?? []).length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {distTags.data!.map((t) => (
                <span
                  key={t.tag}
                  className={`tag ${t.tag === 'latest' ? 'green' : t.tag === 'stable' ? 'indigo' : t.tag === 'beta' ? 'amber' : ''}`}
                  title={text(
                    `${t.tag} -> v${t.version} · updated ${new Date(t.updatedAt).toLocaleString(locale)} by @${t.updatedBy || 'system'}`,
                    `${t.tag} → v${t.version} · 更新于 ${new Date(t.updatedAt).toLocaleString(locale)} by @${t.updatedBy || 'system'}`,
                  )}
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
                  title={text('Manage dist tags (latest/stable/beta/...)', '管理 dist tags(latest/stable/beta/...)')}
                >{text('Edit', '编辑')}</button>
              )}
            </div>
          )}
        </div>
        <div className="detail-hero-actions">
          {/* Download bundle — available to everyone who can see the skill.
              The split button also exposes CLI commands (skillhub skill pull/get/activate). */}
          <DownloadMenu ns={p.ns} name={p.name} version={p.version} />

          {/* Subscribe: writes an in-app notification on every publish. */}
          <button
            className={`btn ${subState.data?.subscribed ? 'primary' : ''}`}
            onClick={toggleSubscribe}
            disabled={subBusy}
            title={subState.data?.subscribed
              ? text('Unfollow to stop receiving release notifications', '取消关注以停止接收发布通知')
              : text('Follow to receive new release notifications', '关注以接收新版本发布通知')}
          >
            {subState.data?.subscribed ? text('Following', '✓ 已关注') : text('Follow', '+ 关注')}
          </button>

          {canEdit ? (
            // The primary CTA depends on status: draft/review → continue
            // editing; published/yanked/deprecated → spawn a new draft.
            p.status === 'draft' || p.status === 'review' ? (
              <button
                className="btn primary"
                onClick={() => navigate(`/skills/${p.ns}/${p.name}/edit`)}
                title={isAuthor ? text('Edit your skill', '编辑你的 skill') : text(`Edit this skill as ${myRole}`, `以 ${myRole} 身份编辑此 skill`)}
              ><IconCode size={14} /> {text('Edit', '编辑')}</button>
            ) : (
              <button
                className="btn primary"
                onClick={() => setCreateDraftOpen(true)}
                title={text('Create an editable draft with a new version number', '以新版本号创建一个可编辑的草稿')}
              ><IconPlus size={14} /> {text('New Draft Version', '新建草稿版本')}</button>
            )
          ) : (
            <span
              className="tag"
              title={text('You are not the skill author or an owner/maintainer of this namespace', '你不是该 skill 的作者，也不是该命名空间的 owner/maintainer')}
              style={{ background: 'var(--bg-soft)', color: 'var(--text-faint)', fontWeight: 400 }}
            >{text('Read-only', '只读')}</span>
          )}
          {canEdit && (
            <button
              className="btn"
              onClick={() => setEditMetaOpen(true)}
              title={text('Update description, tags, classification, and other metadata', '修改描述、标签、密级等元数据')}
            >{text('Edit Info', '编辑信息')}</button>
          )}
          {showLifecycleButtons && (
            <>
              <button className="btn" onClick={doDeprecate} title={text('Mark as deprecated while keeping access', '标记为弃用，仍保留访问')}>{text('Deprecate', '弃用')}</button>
              <button className="btn" onClick={doYank} style={{ color: 'var(--red-text)' }} title={text('Yank this release and block new activations', '撤销发布，禁止再被激活')}>{text('Yank', '撤销')}</button>
            </>
          )}
          {canManageLifecycle
            && (p.status === 'published' || p.status === 'yanked' || p.status === 'deprecated')
            && (versions.data ?? []).filter((v) => v.status === 'published' && v.version !== p.version).length > 0 && (
              <button
                className="btn"
                onClick={() => setRollbackOpen(true)}
                title={text('Restore files, version, and latest tag to a selected published version', '把文件 / 版本号 / latest 标签恢复到指定的历史发布版本')}
              >{text('Rollback', '回滚')}</button>
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
            ? text('This skill has been yanked and cannot be activated. Contact the author or maintainer for details.', '此 Skill 已被撤销，无法激活。请联系作者或维护者了解详情。')
            : text('This skill has been deprecated. Consider migrating to an alternative.', '此 Skill 已被弃用，建议迁移到替代方案。')}
        </div>
      )}

      <div className="tabs">
        <div className={`tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>{text('Overview', '概览')}</div>
        <div className={`tab ${tab === 'files' ? 'active' : ''}`} onClick={() => setTab('files')}>
          {text('Files', '文件')}
          {displayFiles.length > 0 && (
            <span className="count" style={{ marginLeft: 6 }}>{displayFiles.length}</span>
          )}
        </div>
        <div className={`tab ${tab === 'versions' ? 'active' : ''}`} onClick={() => setTab('versions')}>{text('Versions', '版本')}</div>
        <div className={`tab ${tab === 'health' ? 'active' : ''}`} onClick={() => setTab('health')}>{text('Health', '健康度')}</div>
        <div className={`tab ${tab === 'audit' ? 'active' : ''}`} onClick={() => setTab('audit')}>{text('Audit', '审计')}</div>
      </div>

      <div className="detail-grid">
        <div>
          {tab === 'overview' && (
            <>
              <div className="card">
                <div className="card-body" style={{ padding: '22px 26px' }}>
                  <div className="readme">
                    <h2>{text('Overview', '概述')}</h2>
                    <p>
                      <code>{p.name}</code>{text(' is maintained by ', ' 由 ')}
                      <span className="mono">@{p.author}</span>
                      {text(`, belongs to the ${p.ns} namespace, and is classified ${p.classification}.`, ` 维护，属于 ${p.ns} 命名空间，密级 ${p.classification}。`)}
                    </p>
                    <p>{p.desc}</p>
                    {p.tags.length > 0 && (
                      <>
                        <h3>{text('Tags', '标签')}</h3>
                        <p>{p.tags.map((t) => <code key={t} style={{ marginRight: 6 }}>#{t}</code>)}</p>
                      </>
                    )}
                    {/* Prefer the real SKILL.md content over the
                        synthetic longDesc; fall back gracefully through:
                          1. fetched file content
                          2. legacy longDesc field (used by older seeds)
                          3. "no SKILL.md yet" hint */}
                    {skillMd && skillMdContent.loading && (
                      <p style={{ color: 'var(--text-faint)', fontSize: 12 }}>{text('Loading ', '正在加载 ')}{skillMd.path}...</p>
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
                          >{text('Browse all files ->', '浏览全部文件 →')}</a>
                        </div>
                        <div dangerouslySetInnerHTML={{ __html: renderMarkdown(skillMdContent.data.content) }} />
                      </>
                    ) : p.longDesc ? (
                      <div dangerouslySetInnerHTML={{ __html: renderMarkdown(p.longDesc) }} />
                    ) : (
                      <p style={{ color: 'var(--text-faint)', fontSize: 12 }}>
                        {text(
                          `The author has not written SKILL.md yet${canEdit ? '. Click "Edit" to add one.' : '.'}`,
                          `作者还没有撰写 SKILL.md${canEdit ? '。点击"编辑"可以补充。' : '。'}`,
                        )}
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
                    {files.loading && <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text-faint)' }}>{text('Loading...', '加载中...')}</div>}
                    {!files.loading && displayFiles.length === 0 && (
                      <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text-faint)' }}>{text('No files', '暂无文件')}</div>
                    )}
                    {displayFiles.map((f) => {
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
                      <div style={{ color: 'var(--text-faint)', fontSize: 13 }}>{text('Select a file on the left to view its contents.', '从左侧选择一个文件查看内容。')}</div>
                    )}
                    {activePath && activeFile.loading && (
                      <div style={{ color: 'var(--text-faint)', fontSize: 13 }}>{text('Loading ', '加载 ')}{activePath}...</div>
                    )}
                    {activePath && activeFile.error && (
                      <div style={{ color: 'var(--red-text)', fontSize: 13 }}>{text('Read failed: ', '读取失败：')}{activeFile.error.message}</div>
                    )}
                    {activePath && activeFileMeta?.blobHash && (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 12, color: 'var(--text-faint)' }}>
                          <IconFile size={12} />
                          <span className="mono" style={{ color: 'var(--text)', fontSize: 13 }}>{activePath}</span>
                          <span>·</span>
                          <span>{activeFileMeta.size} {text('bytes', '字节')}</span>
                          {activeFileMeta.updatedBy && (
                            <>
                              <span>·</span>
                              <span>@{activeFileMeta.updatedBy} {text('updated ', '更新于 ')}{fmtRelative(activeFileMeta.updatedAt)}</span>
                            </>
                          )}
                        </div>
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          color: 'var(--text-faint)', fontSize: 13, padding: '20px 0',
                        }}>
                          <IconFile size={14} />
                          <span>{text('Binary file — cannot preview in browser.', '二进制文件，无法在浏览器中预览。')}</span>
                          <span style={{ fontFamily: 'monospace', fontSize: 11 }}>sha256:{activeFileMeta.blobHash.slice(0, 12)}…</span>
                        </div>
                      </>
                    )}
                    {activePath && activeFile.data && (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 12, color: 'var(--text-faint)' }}>
                          <IconFile size={12} />
                          <span className="mono" style={{ color: 'var(--text)', fontSize: 13 }}>{activePath}</span>
                          <span>·</span>
                          <span>{activeFile.data.size} {text('bytes', '字节')}</span>
                          {activeFile.data.updatedBy && (
                            <>
                              <span>·</span>
                              <span>@{activeFile.data.updatedBy} {text('updated ', '更新于 ')}{fmtRelative(activeFile.data.updatedAt)}</span>
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
            <VersionExplorer
              ns={ns}
              name={name}
              versions={versions.data ?? []}
              latestVersion={p.version}
            />
          )}

          {tab === 'health' && (
            <div>
              <div className="stat-strip">
                <div className="stat"><div className="stat-label">{text('Activations / Week', '激活/周')}</div><div><span className="stat-value num">{p.activations.toLocaleString()}</span><span className={`stat-delta ${p.delta > 0 ? 'up' : p.delta < 0 ? 'down' : 'flat'}`}>
                  {p.delta > 0 ? <IconArrowUp size={11} /> : p.delta < 0 ? <IconArrowDown size={11} /> : null}
                  {Math.abs(p.delta)}%
                </span></div></div>
                <div className="stat"><div className="stat-label">{text('User Rating', '用户评分')}</div><div><span className="stat-value num">{p.rating || '—'}</span></div></div>
                <div className="stat"><div className="stat-label">{text('Rating Count', '评分数')}</div><div><span className="stat-value num">{p.ratings}</span></div></div>
                <div className="stat"><div className="stat-label">{text('Status', '状态')}</div><div style={{ marginTop: 6 }}><StatusPill status={p.status} /></div></div>
              </div>
              <div className="card" style={{ marginTop: 'var(--gap)' }}>
                <div className="card-header">
                  <h3 className="card-title">{text('Activation Trend', '激活趋势')} <span style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 400, marginLeft: 6 }}>{text('Last 30 days', '近 30 天')} · UTC</span></h3>
                </div>
                <div className="card-body">
                  {trend.loading && <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>{text('Loading...', '加载中...')}</div>}
                  {trend.error && <div style={{ fontSize: 12, color: 'var(--red-text)' }}>{text('Load failed: ', '加载失败: ')}{trend.error.message}</div>}
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
              { id: 'all',     label: text('All', '全部') },
              { id: 'release', label: text('Release', '发布') },
              { id: 'review',  label: text('Review', '评审') },
              { id: 'file',    label: text('File Edits', '文件编辑') },
              { id: 'other',   label: text('Other', '其它') },
            ];
            return (
              <div className="card">
                <div className="card-header" style={{ padding: '12px 16px' }}>
                  <h3 className="card-title">
                    {text('Audit Logs', '审计记录')}
                    {all.length > 0 && (
                      <span className="count-pill" style={{ marginLeft: 6 }}>{all.length}</span>
                    )}
                  </h3>
                  <a
                    style={{ fontSize: 12, color: 'var(--primary)', cursor: 'pointer' }}
                    onClick={() => navigate(`/audit?target=${encodeURIComponent(`${ns}/${name}`)}`)}
                  >{text('View global logs ->', '查看全局日志 →')}</a>
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
                  {auditLogs.loading && <div style={{ padding: 16, color: 'var(--text-subtle)', fontSize: 13 }}>{text('Loading...', '加载中...')}</div>}
                  {auditLogs.error && <div style={{ padding: 16, color: 'var(--red-text)', fontSize: 13 }}>{auditLogs.error.message}</div>}
                  {!auditLogs.loading && !auditLogs.error && filtered.length === 0 && (
                    <div style={{ padding: '28px 16px', color: 'var(--text-subtle)', textAlign: 'center', fontSize: 13 }}>
                      {all.length === 0 ? text('This skill has no audit records yet', '该 skill 还没有任何审计记录') : text('No records in this category', '暂无此类别记录')}
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
                        <span><span className={`tag ${AUDIT_ACTION_COLOR[e.action] || ''}`}>{auditActionLabel(e.action, isEnglish)}</span></span>
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
            <div className="card-header" style={{ padding: '12px 16px' }}><h3 className="card-title">{text('Metadata', '元数据')}</h3></div>
            <div className="card-body" style={{ padding: '14px 16px' }}>
              <div className="meta-list">
                <div className="meta-row"><span className="k">{text('Namespace', '命名空间')}</span><span className="v mono">{p.ns}</span></div>
                <div className="meta-row"><span className="k">{text('Current Version', '当前版本')}</span><span className="v mono">v{p.version}</span></div>
                <div className="meta-row"><span className="k">{text('Classification', '密级')}</span><span className="v"><ClassificationTag level={p.classification} /></span></div>
                <div className="meta-row"><span className="k">{text('Author', '作者')}</span><span className="v mono">@{p.author}</span></div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header" style={{ padding: '12px 16px' }}><h3 className="card-title">{text('Maintainers', '维护者')}</h3></div>
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
                  return <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-subtle)' }}>{text('Loading...', '加载中...')}</div>;
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
                        {m.username === p.author ? `${text('Author', '作者')} · ${m.role}` : m.role}
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

      {editMetaOpen && (
        <EditMetaModal
          skill={p}
          onClose={() => setEditMetaOpen(false)}
          onSaved={() => { setEditMetaOpen(false); skill.reload(); }}
        />
      )}

      {createDraftOpen && (
        <CreateDraftVersionModal
          ns={p.ns}
          name={p.name}
          currentVersion={p.version}
          suggestedVersion={bumpedPatch(p.version)}
          onClose={() => setCreateDraftOpen(false)}
          onSubmit={doCreateDraft}
        />
      )}

      {rollbackOpen && (
        <RollbackModal
          ns={p.ns}
          name={p.name}
          currentVersion={p.version}
          versions={(versions.data ?? []).filter((v) => v.status === 'published' && v.version !== p.version)}
          onClose={() => setRollbackOpen(false)}
          onSubmit={doRollback}
        />
      )}
      {promptEl}
    </div>
  );
}

// CreateDraftVersionModal replaces the old browser prompt so the lifecycle
// action feels like the rest of the Skill detail surface.
function CreateDraftVersionModal({
  ns, name, currentVersion, suggestedVersion, onClose, onSubmit,
}: {
  ns: string;
  name: string;
  currentVersion: string;
  suggestedVersion: string;
  onClose: () => void;
  onSubmit: (version: string) => Promise<void>;
}) {
  const { text } = useLocaleText();
  const [version, setVersion] = useState(suggestedVersion);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const trimmed = version.trim();
  const invalid = trimmed !== '' && !DRAFT_VERSION_RE.test(trimmed);
  const unchanged = trimmed !== '' && trimmed === currentVersion;

  async function submit() {
    setErr(null);
    if (invalid) {
      setErr(text('Version must be valid semver, such as 1.2.3 or 1.2.3-beta.1', '版本号需符合 semver, 如 1.2.3 或 1.2.3-beta.1'));
      return;
    }
    if (unchanged) {
      setErr(text('New version matches the current one. Bump it first.', '新版本号与当前一致,请先 bump'));
      return;
    }
    setBusy(true);
    try {
      await onSubmit(trimmed);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={() => { if (!busy) onClose(); }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(15,23,42,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); void submit(); }}
        style={{
          width: 500,
          maxWidth: '94vw',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          boxShadow: '0 20px 50px rgba(15,23,42,0.3)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'var(--primary-50)',
            color: 'var(--primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            <IconPlus size={16} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
              {text('New Draft Version', '新建草稿版本')}
            </h3>
            <div style={{ marginTop: 2, fontSize: 12, color: 'var(--text-subtle)' }}>
              <span className="mono">{ns}/{name}</span>
            </div>
          </div>
          <button
            type="button"
            className="btn sm ghost"
            onClick={onClose}
            disabled={busy}
            title={text('Close', '关闭')}
            style={{ padding: 6 }}
          >
            <IconX size={14} />
          </button>
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto 1fr',
            gap: 10,
            alignItems: 'center',
            padding: 12,
            border: '1px solid var(--border)',
            borderRadius: 8,
            background: 'var(--bg-soft)',
          }}>
            <div>
              <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginBottom: 3 }}>{text('Current', '当前')}</div>
              <div className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>v{currentVersion}</div>
            </div>
            <span style={{ color: 'var(--text-faint)' }}>→</span>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginBottom: 3 }}>{text('Suggested', '建议')}</div>
              <div className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary)' }}>v{suggestedVersion}</div>
            </div>
          </div>

          <label style={{ display: 'block' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}>{text('New Version', '新版本号')}</span>
              <button
                type="button"
                className="btn sm ghost"
                onClick={() => setVersion(suggestedVersion)}
                disabled={busy || version === suggestedVersion}
                style={{ fontSize: 11, padding: '2px 8px' }}
              >
                {text('Use Suggested', '使用建议值')}
              </button>
            </div>
            <input
              className="input"
              autoFocus
              value={version}
              onChange={(e) => {
                setVersion(e.target.value);
                if (err) setErr(null);
              }}
              placeholder={suggestedVersion}
              disabled={busy}
              style={{ width: '100%', fontFamily: "'JetBrains Mono', monospace" }}
            />
            <div style={{ marginTop: 6, fontSize: 11.5, color: invalid || unchanged ? 'var(--red-text)' : 'var(--text-faint)' }}>
              {invalid
                ? text('Not a valid semver format', '不是合法 semver 格式')
                : unchanged
                  ? text('Choose a version newer than the current one', '请选择不同于当前版本的版本号')
                  : text('Leave blank to let the server use the default patch bump.', '留空则由服务端使用默认 patch bump。')}
            </div>
          </label>

          <div style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            background: 'var(--bg-muted)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '9px 10px',
            lineHeight: 1.55,
          }}>
            {text(
              'A new editable draft will be created from the currently published files. The published version stays available until this draft is reviewed and published.',
              '系统会基于当前已发布文件创建一个可编辑草稿。当前发布版本会继续可用,直到该草稿审批并发布。',
            )}
          </div>

          {err && <div style={{ color: 'var(--red-text)', fontSize: 12.5 }}>{err}</div>}
        </div>

        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>{text('Cancel', '取消')}</button>
          <button type="submit" className="btn primary" disabled={busy || invalid || unchanged}>
            {busy ? text('Creating...', '创建中...') : text('Create Draft', '创建草稿')}
          </button>
        </div>
      </form>
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
  const { text, locale } = useLocaleText();
  const [confirm, confirmEl] = useConfirm();
  const [tagInput, setTagInput] = useState('stable');
  const [versionInput, setVersionInput] = useState(versions[0] ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function applySet() {
    setErr(null);
    if (!tagInput.trim() || !versionInput.trim()) {
      setErr(text('Tag and version are required', 'tag 与 version 必填')); return;
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
    const ok = await confirm({
      title: text('Delete tag', '删除 tag'),
      message: text(`Delete tag "${tag}"?`, `确定删除 tag "${tag}"?`),
      detail: text(
        'Consumers pinning this tag will stop receiving updates until it is repointed.',
        '锁定该 tag 的使用方将停止收到更新，除非 tag 被重新指向新版本。',
      ),
      confirmLabel: text('Delete', '删除'),
      cancelLabel: text('Cancel', '取消'),
      tone: 'danger',
    });
    if (!ok) return;
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
    <>
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--bg)', borderRadius: 10, width: 520, maxWidth: '92vw', boxShadow: '0 20px 50px rgba(15,23,42,0.25)', border: '1px solid var(--border)' }}
      >
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 600 }}>{text('Manage Dist Tags', '管理 Dist Tags')}</div>
          <button className="btn sm ghost" onClick={onClose}>{text('Close', '关闭')}</button>
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ fontSize: 12.5, color: 'var(--text-subtle)', marginBottom: 8 }}>{text('Existing tags', '现有 tags')}</div>
            {tags.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>{text('None', '暂无')}</div>
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
                      by @{t.updatedBy || 'system'} · {new Date(t.updatedAt).toLocaleString(locale)}
                    </span>
                    <button
                      className="btn sm ghost"
                      disabled={busy || t.tag === 'latest'}
                      onClick={() => applyDelete(t.tag)}
                      title={t.tag === 'latest'
                        ? text('latest is maintained automatically by the publish flow and cannot be deleted manually', 'latest 由发布流程自动维护,不可手动删除')
                        : text('Delete this tag', '删除该 tag')}
                      style={{ color: t.tag === 'latest' ? 'var(--text-faint)' : 'var(--red-text)' }}
                    >{text('Delete', '删除')}</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <div style={{ fontSize: 12.5, color: 'var(--text-subtle)', marginBottom: 8 }}>{text('Add / Update', '新增 / 修改')}</div>
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
                {versions.length === 0 && <option value="">{text('(no versions)', '(no versions)')}</option>}
                {versions.map((v) => <option key={v} value={v}>v{v}</option>)}
              </select>
              <button className="btn primary sm" disabled={busy} onClick={applySet}>
                {busy ? '...' : text('Apply', '应用')}
              </button>
            </div>
            {tagInput.trim() === 'latest' && (
              <div style={{ fontSize: 11, color: 'var(--amber-text)', marginTop: 6 }}>
                {text('Tip: latest is usually managed by the publish flow. Manual changes can be used for rollback.', '提示:latest 通常由发布流程自动管理,手动修改可作为回滚使用。')}
              </div>
            )}
            {err && <div style={{ fontSize: 11.5, color: 'var(--red-text)', marginTop: 6 }}>{err}</div>}
          </div>
        </div>
      </div>
    </div>
    {confirmEl}
    </>
  );
}

// ---------------------------------------------------------------------------
// EditMetaModal — edit skill metadata (desc, tags, classification, etc.)
// ---------------------------------------------------------------------------
function EditMetaModal({
  skill,
  onClose,
  onSaved,
}: {
  skill: import('../api/types').Skill;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { text } = useLocaleText();
  const [desc, setDesc] = useState(skill.desc);
  const [classification, setClassification] = useState<'L1' | 'L2' | 'L3'>(skill.classification);
  const [tagsRaw, setTagsRaw] = useState(skill.tags.join(', '));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true); setErr(null);
    try {
      const tags = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean);
      await api.patchSkillMeta(skill.ns, skill.name, { desc, classification, tags });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg)', borderRadius: 10, width: 640, maxWidth: '94vw', boxShadow: '0 20px 50px rgba(15,23,42,0.3)', border: '1px solid var(--border)' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{text('Edit Skill Info', '编辑 Skill 信息')}</h3>
          <button className="btn sm ghost" onClick={onClose} disabled={busy}>✕</button>
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={{ display: 'block' }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 4 }}>{text('Description', '描述')}</div>
            <textarea
              className="input"
              rows={5}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              style={{ width: '100%', minHeight: 118, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.55 }}
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={{ display: 'block' }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 4 }}>{text('Classification', '密级')}</div>
              <select
                className="input"
                value={classification}
                onChange={(e) => setClassification(e.target.value as 'L1' | 'L2' | 'L3')}
                style={{ width: '100%' }}
              >
                <option value="L1">{text('L1 · Public', 'L1 · 公开')}</option>
                <option value="L2">{text('L2 · Internal', 'L2 · 内部')}</option>
                <option value="L3">{text('L3 · Sensitive', 'L3 · 敏感')}</option>
              </select>
            </label>
            <div style={{
              border: '1px solid var(--border)',
              borderRadius: 6,
              background: 'var(--bg-soft)',
              padding: '8px 10px',
            }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 4 }}>{text('Current Version', '当前版本')}</div>
              <div className="mono" style={{ fontSize: 13, color: 'var(--text)' }}>v{skill.version}</div>
              <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--text-faint)', lineHeight: 1.45 }}>
                {text('Version changes are handled through draft review and publish flow.', '版本号只能通过草稿审批和发布流程变更。')}
              </div>
            </div>
          </div>
          <label style={{ display: 'block' }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 4 }}>{text('Tags (comma-separated)', '标签（逗号分隔）')}</div>
            <input
              className="input"
              value={tagsRaw}
              onChange={(e) => setTagsRaw(e.target.value)}
              placeholder="sql, review, backend"
              style={{ width: '100%' }}
            />
          </label>
          {err && <div style={{ color: 'var(--red-text)', fontSize: 12.5 }}>{err}</div>}
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" onClick={onClose} disabled={busy}>{text('Cancel', '取消')}</button>
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? text('Saving...', '保存中...') : text('Save', '保存')}
          </button>
        </div>
      </div>
    </div>
  );
}

// RollbackModal: pick a previously published version + provide a reason,
// then hand off to the parent's onSubmit which calls the backend. The
// parent owns the actual API call so it can also reload skill / versions /
// dist tags after success.
function RollbackModal({
  ns, name, currentVersion, versions, onClose, onSubmit,
}: {
  ns: string;
  name: string;
  currentVersion: string;
  versions: import('../api/types').SkillVersion[];
  onClose: () => void;
  onSubmit: (target: string, reason: string) => Promise<void>;
}) {
  const { text } = useLocaleText();
  const [target, setTarget] = useState<string>(versions[0]?.version ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!target) { setErr(text('Select a target version', '请选择目标版本')); return; }
    if (!reason.trim()) { setErr(text('Enter a rollback reason', '请填写回滚原因')); return; }
    setBusy(true);
    setErr(null);
    try {
      await onSubmit(target, reason.trim());
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
        style={{ background: 'var(--bg)', borderRadius: 10, width: 480, maxWidth: '92vw', boxShadow: '0 20px 50px rgba(15,23,42,0.25)', border: '1px solid var(--border)' }}
      >
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{text('Rollback', '回滚')} {ns}/{name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            {text(
              `Restore the skill files, version, and latest tag to a selected published version. Current v${currentVersion}.`,
              `将 skill 的文件、版本号和 latest 标签恢复到指定的历史发布版本。当前 v${currentVersion}。`,
            )}
          </div>
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'block' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{text('Target Version', '目标版本')}</div>
            <select
              className="input"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              style={{ width: '100%' }}
            >
              {versions.length === 0 && <option value="">{text('No historical versions available for rollback', '没有可回滚的历史版本')}</option>}
              {versions.map((v) => (
                <option key={v.version} value={v.version}>
                  v{v.version}
                  {v.author ? ` · @${v.author}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'block' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
              {text('Rollback Reason (required; saved to audit logs and subscriber notifications)', '回滚原因（必填，将进入审计日志和订阅者通知）')}
            </div>
            <textarea
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={text('Example: v1.2.0 introduced a bug, roll back to v1.1.3 first', '例如：v1.2.0 引入了 bug，需要先回滚到 v1.1.3 止血')}
              rows={3}
              style={{ width: '100%', resize: 'vertical' }}
            />
          </label>
          <div style={{
            fontSize: 12, color: 'var(--text-muted)',
            background: 'var(--bg-muted)',
            border: '1px solid var(--border)',
            borderRadius: 6, padding: 10, lineHeight: 1.6,
          }}>
            {text(
              `Warning: rollback will overwrite all current skill files with the target version, including draft edits. The original v${currentVersion} snapshot stays in the version list and can be restored again.`,
              `⚠️ 回滚会用目标版本的文件覆盖当前所有 skill 文件（包括草稿编辑中的内容）。原版本 v${currentVersion} 的快照仍保留在版本列表里，可重新回滚。`,
            )}
          </div>
          {err && <div style={{ color: 'var(--red-text)', fontSize: 12.5 }}>{err}</div>}
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" onClick={onClose} disabled={busy}>{text('Cancel', '取消')}</button>
          <button className="btn primary" onClick={submit} disabled={busy || !target || !reason.trim()}>
            {busy ? text('Rolling back...', '回滚中…') : text('Confirm Rollback', '确认回滚')}
          </button>
        </div>
      </div>
    </div>
  );
}
