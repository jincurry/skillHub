import { useNavigate } from 'react-router-dom';
import { Sparkline } from '../components/Sparkline';
import { StatusPill, ClassificationTag } from '../components/Tags';
import {
  IconPlus, IconArrowUp, IconArrowDown, IconCheckCircle,
  IconAlertTriangle, IconXCircle, IconCode, IconRocket,
  IconCheck, IconBell, IconChat, IconChevronRight, IconMore,
} from '../components/Icons';
import { api } from '../api/client';
import { useAsync } from '../api/useAsync';
import { openCreateSkill } from '../components/CreateSkillModal';
import { fmtRelative, notifTargetUrl, filterAndSort, type NotifFilter } from '../lib/notify';
import { markAllReadOptimistic, markOneReadOptimistic, useNotifStore } from '../lib/notifStore';
import { useEffect, useRef, useState } from 'react';
import type { Notification, Review, Skill, ValidationReport } from '../api/types';

const DRAFT_CHECKS_FALLBACK = [
  { severity: 'ok' as const, label: 'Schema' },
];

// Minimal styled menu row used inside DraftCard's kebab popover. Keeping
// these as plain inline-styled spans avoids spinning up a new CSS class
// for what is essentially a one-off list.
function DraftMenuItem({
  onClick, disabled, danger, title, children,
}: {
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  const color = disabled
    ? 'var(--text-faint)'
    : danger ? 'var(--red-text)' : 'var(--text)';
  return (
    <div
      role="menuitem"
      title={title}
      onClick={() => { if (!disabled) onClick(); }}
      style={{
        padding: '7px 12px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        color,
        opacity: disabled ? 0.6 : 1,
        userSelect: 'none',
      }}
      onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-soft)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
    >
      {children}
    </div>
  );
}

function DraftMenuDivider() {
  return <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />;
}

function DraftCard({ d, meName, onChanged }: {
  d: Skill;
  meName: string;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const v = useAsync<ValidationReport>(() => api.validate(d.ns, d.name), [d.ns, d.name]);
  const checks = v.data?.checks ?? DRAFT_CHECKS_FALLBACK;
  const blocked = (v.data?.checks ?? []).some((c) => c.severity === 'err');
  const editPath = `/skills/${d.ns}/${d.name}/edit`;
  const isAuthor = meName !== '' && meName === d.author;

  // Kebab menu — closed by default, click-outside dismisses. We use a ref
  // on the wrapper and only close when the click target lives outside it,
  // otherwise the capture-phase handler would fire before the menu-item's
  // bubble-phase onClick and make every row feel dead.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    // Defer attach so the click that opened the menu isn't counted as
    // "outside" on the same tick.
    const t = window.setTimeout(() => document.addEventListener('mousedown', onDocClick), 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('mousedown', onDocClick);
    };
  }, [menuOpen]);

  async function copyRef() {
    try {
      await navigator.clipboard.writeText(`${d.ns}/${d.name}`);
    } catch {
      // Fallback: synthesize a textarea so users on insecure contexts still
      // get something. Silent swallow if even that fails.
      const ta = document.createElement('textarea');
      ta.value = `${d.ns}/${d.name}`;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
    }
  }

  async function downloadBundle() {
    try { await api.downloadBundle(d.ns, d.name); }
    catch (e) { window.alert('下载失败: ' + (e as Error).message); }
  }

  async function deleteDraft() {
    if (!isAuthor) return;
    if (!window.confirm(
      `确定删除草稿 ${d.ns}/${d.name}?\n\n该操作会同时清掉文件、版本、评论、通知等附属数据,且无法恢复。`,
    )) return;
    try {
      await api.deleteDraftSkill(d.ns, d.name);
      onChanged();
    } catch (e) {
      window.alert('删除失败: ' + (e as Error).message);
    }
  }

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
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            className="icon-btn"
            style={{ width: 28, height: 28 }}
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="更多操作"
            aria-expanded={menuOpen}
          ><IconMore size={16} /></button>
          {menuOpen && (
            <div
              role="menu"
              style={{
                position: 'absolute', top: 32, right: 0, zIndex: 20,
                background: 'var(--bg)', border: '1px solid var(--border)',
                borderRadius: 8, boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
                minWidth: 180, padding: '4px 0', fontSize: 13,
              }}
            >
              {/* Every action self-closes the popover via `pick()` so the
                  user doesn't have to click elsewhere to dismiss. */}
              <DraftMenuItem onClick={() => { setMenuOpen(false); navigate(`/skills/${d.ns}/${d.name}`); }}>
                预览公开页
              </DraftMenuItem>
              <DraftMenuItem onClick={() => { setMenuOpen(false); navigate(editPath); }}>
                继续编辑
              </DraftMenuItem>
              <DraftMenuDivider />
              <DraftMenuItem onClick={() => { setMenuOpen(false); void copyRef(); }}>
                复制 ns/name
              </DraftMenuItem>
              <DraftMenuItem onClick={() => { setMenuOpen(false); void downloadBundle(); }}>
                下载 bundle
              </DraftMenuItem>
              <DraftMenuItem
                onClick={() => { setMenuOpen(false); v.reload(); }}
                disabled={v.loading}
              >
                {v.loading ? '校验中…' : '重新校验'}
              </DraftMenuItem>
              <DraftMenuDivider />
              <DraftMenuItem
                onClick={() => { setMenuOpen(false); void deleteDraft(); }}
                disabled={!isAuthor}
                title={isAuthor ? '永久删除此草稿' : '只有作者可以删除自己的草稿'}
                danger
              >
                🗑 删除草稿
              </DraftMenuItem>
            </div>
          )}
        </div>
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

const NOTIF_ICON: Record<Notification['kind'], { bg: string; color: string; el: JSX.Element; bar: string }> = {
  review:  { bg: 'var(--primary-50)', color: 'var(--primary)',     el: <IconCheckCircle size={14} />,    bar: 'var(--primary)' },
  comment: { bg: 'var(--blue-bg)',    color: 'var(--blue-text)',   el: <IconChat size={14} />,           bar: 'var(--blue-text, #2563eb)' },
  publish: { bg: 'var(--green-bg)',   color: 'var(--green-text)',  el: <IconRocket size={14} />,         bar: 'var(--green)' },
  warn:    { bg: 'var(--amber-bg)',   color: 'var(--amber-text)',  el: <IconAlertTriangle size={14} />,  bar: 'var(--amber)' },
};

function NotificationItem({ n, onClick, onMarkRead }: {
  n: Notification;
  onClick: (n: Notification) => void;
  onMarkRead: (n: Notification) => void;
}) {
  const ic = NOTIF_ICON[n.kind] ?? NOTIF_ICON.comment;
  const url = notifTargetUrl(n);
  return (
    <div
      className={`feed-item ${n.unread ? 'unread' : ''}`}
      onClick={() => onClick(n)}
      title={url ? `点击打开 ${url}` : undefined}
      style={{
        cursor: url ? 'pointer' : 'default',
        position: 'relative',
        transition: 'background 0.12s',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = ''; }}
    >
      {n.unread && (
        <span style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, background: ic.bar, borderRadius: '0 2px 2px 0' }} />
      )}
      <div className="feed-icon" style={{ background: ic.bg, color: ic.color }}>{ic.el}</div>
      <div className="feed-content">
        <div style={{ fontWeight: n.unread ? 600 : 400 }}>{n.body}</div>
        <div className="feed-time" title={new Date(n.createdAt).toLocaleString()}>{fmtRelative(n.createdAt)}</div>
      </div>
      {n.unread && (
        <button
          onClick={(e) => { e.stopPropagation(); onMarkRead(n); }}
          title="标为已读"
          style={{
            border: 'none', background: 'transparent', cursor: 'pointer',
            color: 'var(--text-faint)', fontSize: 11, padding: '2px 6px',
            alignSelf: 'flex-start', marginLeft: 4, borderRadius: 4,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-muted)'; e.currentTarget.style.color = 'var(--text)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-faint)'; }}
        >✓</button>
      )}
    </div>
  );
}

const FILTER_LABELS: Record<NotifFilter, string> = {
  all: '全部',
  unread: '未读',
  review: '审批',
  comment: '评论',
};

function PendingReviewItem({ r }: { r: Review }) {
  const navigate = useNavigate();
  const ucol = ({
    overdue: { color: 'var(--red-text)', dot: 'var(--red)' },
    soon: { color: 'var(--amber-text)', dot: 'var(--amber)' },
    ok: { color: 'var(--green-text)', dot: 'var(--green)' },
    done: { color: 'var(--green-text)', dot: 'var(--green)' },
    rejected: { color: 'var(--text-subtle)', dot: 'var(--text-faint)' },
    changes: { color: 'var(--amber-text)', dot: 'var(--amber)' },
    hot:     { color: 'var(--red-text)', dot: 'var(--red)' },
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
          {r.isHotfix && (
            <span
              className="tag"
              style={{ background: 'var(--red-bg)', color: 'var(--red-text)', fontSize: 10, fontWeight: 600 }}
              title={`Hotfix: ${r.hotfixReason || '未填写原因'}`}
            >
              ⚡ HOTFIX
            </span>
          )}
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
  // Notifications come from the shared store (see lib/notifStore.ts) so the
  // Workspace feed, topbar bell and sidebar badge stay in lockstep.
  const notifStore = useNotifStore();
  const pending = useAsync(() => api.listReviews('pending'), []);

  // Keep the pending review list fresh: 30s polling + reviews:changed
  // window event for instant updates when a decision is made anywhere.
  // Without this, deciding a review in ReviewDetail leaves the
  // 待我审批 feed and stat showing stale rows until full page reload.
  useEffect(() => {
    const t = window.setInterval(() => pending.reload(), 30_000);
    const onChange = () => pending.reload();
    window.addEventListener('reviews:changed', onChange);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('reviews:changed', onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filter the platform-wide pending queue down to "things I can act on".
  // Authoring my own request shouldn't count as 待我审批 — I can't approve
  // my own work. The greeting / stat / feed all key off this filtered list.
  const myName = me.data?.username ?? '';
  const myPendingReviews = (pending.data ?? []).filter(
    (r) => myName !== '' && r.reviewers.includes(myName),
  );

  const draftCount = drafts.data?.length ?? 0;
  const pendingCount = myPendingReviews.length;
  const hour = new Date().getHours();
  const greetWord = hour < 5 ? '夜深了' : hour < 12 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
  const greeting = me.data ? `${greetWord},${me.data.display.split(' ')[0]} 👋` : `${greetWord} 👋`;

  // Live KPIs derived from data we already have. No fabricated numbers.
  const myPublished = (mySkills.data ?? []).filter((s) => s.status === 'published');
  const totalActivations = (mySkills.data ?? []).reduce((acc, s) => acc + s.activations, 0);
  const ratedSkills = (mySkills.data ?? []).filter((s) => s.ratings > 0);
  const avgRating = ratedSkills.length
    ? ratedSkills.reduce((a, s) => a + s.rating, 0) / ratedSkills.length
    : 0;
  const overdueReviews = myPendingReviews.filter((r) => r.urgency === 'overdue').length;

  const [notifFilter, setNotifFilter] = useState<NotifFilter>('all');
  const filteredNotifs = filterAndSort(notifStore.items, notifFilter);
  const unreadCount = notifStore.items.reduce((n, x) => n + (x.unread ? 1 : 0), 0);

  function clickNotif(n: Notification) {
    const url = notifTargetUrl(n);
    if (n.unread) void markOneReadOptimistic(n.id);
    if (url) navigate(url);
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
            </div>
            {drafts.loading && <div className="card"><div className="card-body" style={{ color: 'var(--text-subtle)' }}>加载中...</div></div>}
            {drafts.error && <div className="card"><div className="card-body" style={{ color: 'var(--red-text)' }}>加载失败: {drafts.error.message}</div></div>}
            {drafts.data?.length === 0 && <div className="card"><div className="card-body" style={{ color: 'var(--text-subtle)' }}>暂无草稿</div></div>}
            {drafts.data?.map((d) => (
              <DraftCard
                key={d.id}
                d={d}
                meName={me.data?.username ?? ''}
                onChanged={() => drafts.reload()}
              />
            ))}
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="card-title">我发布的 Skills <span className="count-pill" style={{ marginLeft: 6 }}>{mySkills.data?.length ?? 0}</span></h3>
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
              <div className="qa-text"><span className="qa-title">创建新 Skill</span><span className="qa-desc">从空白开始</span></div>
            </div>
            <div className="quick-action" onClick={() => navigate('/skills')}>
              <div className="qa-icon" style={{ background: 'var(--green-bg)', color: 'var(--green-text)' }}><IconRocket size={16} /></div>
              <div className="qa-text"><span className="qa-title">浏览现有 Skills</span><span className="qa-desc">查看全部 {draftCount > 0 ? '可参考' : ''} skill</span></div>
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
              {myPendingReviews.length === 0 && (
                <div style={{ padding: 18, fontSize: 13, color: 'var(--text-subtle)', textAlign: 'center' }}>
                  暂无待你处理的审批 🎉
                </div>
              )}
              {myPendingReviews.map((r) => <PendingReviewItem key={r.id} r={r} />)}
            </div>
          </div>

          <div className="card">
            <div className="card-header" style={{ padding: '12px 16px' }}>
              <h3 className="card-title">
                <IconBell size={14} />
                需要我关注
                {unreadCount > 0 && (
                  <span className="count-pill" style={{ marginLeft: 4 }}>{unreadCount}</span>
                )}
              </h3>
              <a
                style={{ fontSize: 12, color: unreadCount > 0 ? 'var(--primary)' : 'var(--text-faint)', cursor: unreadCount > 0 ? 'pointer' : 'default' }}
                onClick={() => void markAllReadOptimistic()}
              >全部已读</a>
            </div>
            <div style={{ display: 'flex', gap: 6, padding: '8px 16px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-soft)' }}>
              {(Object.keys(FILTER_LABELS) as NotifFilter[]).map((f) => {
                const isActive = notifFilter === f;
                return (
                  <button
                    key={f}
                    onClick={() => setNotifFilter(f)}
                    style={{
                      padding: '3px 10px', fontSize: 12, borderRadius: 999,
                      border: '1px solid ' + (isActive ? 'var(--primary)' : 'var(--border)'),
                      background: isActive ? 'var(--primary)' : 'transparent',
                      color: isActive ? 'white' : 'var(--text-subtle)',
                      cursor: 'pointer', fontWeight: isActive ? 500 : 400,
                      transition: 'all 0.12s',
                    }}
                  >{FILTER_LABELS[f]}</button>
                );
              })}
            </div>
            <div className="card-body flush feed">
              {notifStore.loading && notifStore.items.length === 0 && (
                <div style={{ padding: 14, fontSize: 13, color: 'var(--text-subtle)' }}>加载中...</div>
              )}
              {notifStore.error && (
                <div style={{ padding: 14, fontSize: 13, color: 'var(--red-text)' }}>{notifStore.error}</div>
              )}
              {!notifStore.loading && filteredNotifs.map((n) => (
                <NotificationItem key={n.id} n={n} onClick={clickNotif} onMarkRead={(x) => void markOneReadOptimistic(x.id)} />
              ))}
              {!notifStore.loading && filteredNotifs.length === 0 && (
                <div style={{ padding: '28px 16px', fontSize: 13, color: 'var(--text-subtle)', textAlign: 'center' }}>
                  {notifFilter === 'all' ? '🎉 你现在没有待办，好棒' : `暂无${FILTER_LABELS[notifFilter]}通知`}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
