import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { DiffEditor } from '@monaco-editor/react';
import {
  IconChevronRight, IconChat, IconXCircle, IconCheckCircle, IconAlertTriangle,
} from '../components/Icons';
import { api } from '../api/client';
import { useAsync } from '../api/useAsync';
import { languageFor } from '../lib/files';
import type { ReviewFile } from '../api/types';

// Visual mapping for the change-kind sidebar badge. Kept tight so the
// sidebar can be narrow without truncating.
const KIND_TAG: Record<ReviewFile['changeKind'], { letter: string; color: string; label: string }> = {
  added:     { letter: 'A', color: 'var(--green-text)', label: '新增' },
  modified:  { letter: 'M', color: 'var(--amber-text)', label: '修改' },
  deleted:   { letter: 'D', color: 'var(--red-text)',   label: '删除' },
  unchanged: { letter: '·', color: 'var(--text-faint)', label: '未变' },
};

export function ReviewDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'overview' | 'changes'>('overview');

  const review = useAsync(() => api.getReview(id), [id]);
  const comments = useAsync(() => api.listComments(id), [id]);
  const files = useAsync(() => api.listReviewFiles(id), [id]);
  const me = useAsync(() => api.me(), []);
  const [newComment, setNewComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const submit = async () => {
    if (!newComment.trim()) return;
    setPosting(true);
    try {
      await api.addComment(id, newComment.trim());
      setNewComment('');
      comments.reload();
    } catch (e) {
      setActionMsg(`评论失败: ${(e as Error).message}`);
    } finally {
      setPosting(false);
    }
  };

  const decide = async (decision: 'approve' | 'reject' | 'request_changes', note?: string) => {
    try {
      await api.decideReview(id, decision, note);
      setActionMsg(
        decision === 'approve' ? '已批准并发布。'
          : decision === 'reject' ? '已驳回。'
          : '已要求作者修改,Skill 已回到 draft。'
      );
      review.reload();
      // Broadcast so the sidebar badge and Workspace 待我审批 feed reload
      // immediately rather than waiting for their 30s poll.
      window.dispatchEvent(new CustomEvent('reviews:changed'));
    } catch (e) {
      setActionMsg(`操作失败: ${(e as Error).message}`);
    }
  };

  const requestChanges = () => {
    const note = window.prompt('请简要说明需要修改的内容(将通知作者):', '');
    if (note === null) return;
    decide('request_changes', note);
  };

  if (review.loading) return <div className="content-inner"><div className="card"><div className="card-body">加载中...</div></div></div>;
  if (review.error || !review.data) return <div className="content-inner"><div className="card"><div className="card-body" style={{ color: 'var(--red-text)' }}>未找到审批: {review.error?.message}</div></div></div>;

  const r = review.data;
  const statusLabel = r.status === 'pending' ? '待审批'
    : r.status === 'approved' ? '已批准'
    : r.status === 'rejected' ? '已驳回'
    : '需修改';
  const statusCls = r.status === 'pending' ? 'amber'
    : r.status === 'approved' ? 'green'
    : r.status === 'rejected' ? 'red'
    : 'amber';

  // Pre-compute the count of "real" changes (anything but unchanged) to
  // surface in the tab badge — that's what reviewers actually need to look at.
  const changeCount = (files.data ?? []).filter((f) => f.changeKind !== 'unchanged').length;

  // Mirror the backend's authorisation rules (api.go:decideReview) so the
  // buttons reflect reality instead of letting the user click and then
  // showing an error toast. We compute one shared reason string and use it
  // as the tooltip on every disabled button — that way the user
  // understands *why* the action is blocked.
  const myName = me.data?.username ?? '';
  const isAuthor = myName !== '' && r.author === myName;
  const isReviewer = myName !== '' && r.reviewers.includes(myName);
  const isClosed = r.status !== 'pending';
  const canDecide = !isClosed && !isAuthor && isReviewer;
  const disabledReason = isClosed ? '该审批已结束'
    : isAuthor ? '不能审批自己提交的请求'
    : !isReviewer ? '你不是这条审批的指派 reviewer'
    : '';

  return (
    <div className="content-inner">
      <div onClick={() => navigate('/reviews')}
        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-subtle)', marginBottom: 14, cursor: 'pointer' }}>
        <IconChevronRight size={14} style={{ transform: 'rotate(180deg)' }} />
        <span>返回审批中心</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            审批 #{r.id}
            <span className={`tag ${statusCls}`}><span className="dot"></span>{statusLabel}</span>
          </h1>
          <p className="page-subtitle">
            <span className="mono">{r.ns}/{r.name}</span> v{r.version} · 由 <span className="mono">@{r.author}</span> 提交于 {new Date(r.submittedAt).toLocaleString()}
          </p>
        </div>
        <div className="page-actions">
          <button
            className="btn"
            disabled={!canDecide}
            title={canDecide ? '驳回该审批' : disabledReason}
            style={canDecide
              ? { color: 'var(--red-text)', borderColor: 'var(--red-bg)' }
              : { opacity: 0.5, cursor: 'not-allowed' }}
            onClick={() => decide('reject')}
          >
            <IconXCircle size={14} /> 驳回
          </button>
          <button
            className="btn"
            disabled={!canDecide}
            title={canDecide ? '要求作者修改' : disabledReason}
            style={canDecide
              ? { color: 'var(--amber-text)', borderColor: 'var(--amber-bg)' }
              : { opacity: 0.5, cursor: 'not-allowed' }}
            onClick={requestChanges}
          >
            <IconAlertTriangle size={14} /> 要求修改
          </button>
          <button
            className="btn primary"
            disabled={!canDecide}
            title={canDecide ? '批准并发布' : disabledReason}
            style={canDecide ? undefined : { opacity: 0.5, cursor: 'not-allowed' }}
            onClick={() => decide('approve')}
          >
            <IconCheckCircle size={14} /> 批准并发布
          </button>
        </div>
      </div>

      {/* Author / non-reviewer banner explains why the decision controls are
          locked. We only show it while the review is still open — once
          closed, the status pill in the header is enough context. */}
      {!isClosed && !canDecide && disabledReason && (
        <div className="card" style={{ marginBottom: 'var(--gap)', borderLeft: '3px solid var(--text-faint)' }}>
          <div className="card-body" style={{ fontSize: 13, color: 'var(--text-subtle)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconAlertTriangle size={14} style={{ color: 'var(--text-faint)' }} />
            <span>{disabledReason}。{isAuthor ? '请等待指派的 reviewer 审批。' : ''}</span>
          </div>
        </div>
      )}

      {actionMsg && (
        <div className="card" style={{ marginBottom: 'var(--gap)', borderLeft: '3px solid var(--primary)' }}>
          <div className="card-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13 }}>{actionMsg}</span>
            <button className="btn sm ghost" onClick={() => setActionMsg(null)}>关闭</button>
          </div>
        </div>
      )}

      <div className="tabs">
        <div className={`tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>
          概览
          {comments.data && comments.data.length > 0 && (
            <span className="count">{comments.data.length}</span>
          )}
        </div>
        <div className={`tab ${tab === 'changes' ? 'active' : ''}`} onClick={() => setTab('changes')}>
          变更
          {changeCount > 0 && <span className="count">{changeCount}</span>}
        </div>
      </div>

      {tab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 'var(--gap)' }}>
          <div>
            <div className="card" style={{ marginBottom: 'var(--gap)' }}>
              <div className="card-header"><h3 className="card-title">提交说明</h3></div>
              <div className="card-body" style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55 }}>
                {r.note || <em style={{ color: 'var(--text-faint)' }}>(无)</em>}
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h3 className="card-title">讨论 <span className="count-pill" style={{ marginLeft: 6 }}>{comments.data?.length ?? 0}</span></h3></div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {comments.data?.length === 0 && <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>暂无评论</div>}
                {comments.data?.map((c, i) => (
                  <div key={c.id} style={{ display: 'flex', gap: 10 }}>
                    <div className={`avatar sm bg-${(i % 5) + 1}`} style={{ width: 30, height: 30, fontSize: 13, flexShrink: 0 }}>{c.author[0]?.toUpperCase()}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, marginBottom: 2 }}>
                        <span className="mono" style={{ fontWeight: 600 }}>@{c.author}</span>
                        <span style={{ color: 'var(--text-faint)', marginLeft: 6 }}>· {new Date(c.createdAt).toLocaleString()}</span>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>{c.body}</div>
                    </div>
                  </div>
                ))}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, display: 'flex', gap: 10 }}>
                  <div className="avatar sm bg-1" style={{ width: 30, height: 30, fontSize: 13, flexShrink: 0 }}>
                    {(me.data?.display ?? me.data?.username ?? '?').slice(0, 1).toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <textarea className="input" placeholder="发表评论..." style={{ padding: '8px 12px', height: 60, resize: 'vertical', width: '100%' }}
                      value={newComment} onChange={(e) => setNewComment(e.target.value)} />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                      <button className="btn sm primary" disabled={posting || !newComment.trim()} onClick={submit}>
                        <IconChat size={12} /> {posting ? '发表中...' : '发表'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <div className="card" style={{ marginBottom: 'var(--gap)' }}>
              <div className="card-header"><h3 className="card-title">SLA</h3></div>
              <div className="card-body" style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: r.urgency === 'overdue' ? 'var(--red)' : 'var(--text)' }} className="num">{r.sla}</div>
                <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 4 }}>距离截止时间</div>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h3 className="card-title">参与者</h3></div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[{ u: r.author, role: '作者' }, ...r.reviewers.map((u) => ({ u, role: 'Reviewer' }))].map((p, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className={`avatar sm bg-${(i % 5) + 1}`} style={{ width: 28, height: 28, fontSize: 12 }}>{p.u[0]?.toUpperCase()}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }} className="mono">@{p.u}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>{p.role}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'changes' && (
        <ChangesView files={files} />
      )}
    </div>
  );
}

// ChangesView is the diff browser. Left rail lists every snapshot row with a
// status letter; right pane shows a Monaco diff editor for the selected file.
// We take an `useAsync` result instead of raw data so we can surface load /
// error states inline.
function ChangesView({ files }: { files: ReturnType<typeof useAsync<ReviewFile[]>> }) {
  const list = files.data ?? [];
  // Auto-pick the first non-unchanged file once data lands. Falls back to the
  // first file overall if everything is unchanged (rare but possible).
  const defaultPath = useMemo(() => {
    const first = list.find((f) => f.changeKind !== 'unchanged');
    return first?.path ?? list[0]?.path ?? null;
  }, [list]);
  const [activePath, setActivePath] = useState<string | null>(null);
  useEffect(() => {
    if (!activePath && defaultPath) setActivePath(defaultPath);
  }, [defaultPath, activePath]);

  const active = list.find((f) => f.path === activePath) ?? null;

  if (files.loading) {
    return <div className="card"><div className="card-body" style={{ color: 'var(--text-subtle)' }}>加载变更...</div></div>;
  }
  if (files.error) {
    return <div className="card"><div className="card-body" style={{ color: 'var(--red-text)' }}>加载失败: {files.error.message}</div></div>;
  }
  if (list.length === 0) {
    return (
      <div className="card">
        <div className="card-body" style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-subtle)' }}>
          <div style={{ fontSize: 14, marginBottom: 4 }}>没有文件快照</div>
          <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
            该审批可能在 review_files 表加入之前提交。新的提交会自动记录文件 diff。
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '260px minmax(0,1fr)', minHeight: 500 }}>
        {/* File list */}
        <div style={{ borderRight: '1px solid var(--border)', overflowY: 'auto', maxHeight: 600 }}>
          <div style={{
            padding: '10px 14px', borderBottom: '1px solid var(--border)',
            fontSize: 11, color: 'var(--text-muted)', fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.05em',
            display: 'flex', justifyContent: 'space-between',
          }}>
            <span>变更文件</span>
            <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>{list.length}</span>
          </div>
          {list.map((f) => {
            const tag = KIND_TAG[f.changeKind];
            const isActive = f.path === activePath;
            return (
              <div
                key={f.path}
                onClick={() => setActivePath(f.path)}
                title={`${tag.label} · ${f.path}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 14px', cursor: 'pointer',
                  fontSize: 12.5, color: isActive ? 'var(--text)' : 'var(--text-muted)',
                  background: isActive ? 'var(--bg-soft)' : 'transparent',
                  borderLeft: isActive ? '2px solid var(--primary)' : '2px solid transparent',
                }}
              >
                <span style={{
                  display: 'inline-flex', justifyContent: 'center', alignItems: 'center',
                  width: 16, height: 16, borderRadius: 3,
                  background: 'var(--bg-muted)', color: tag.color,
                  fontSize: 10, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
                  flexShrink: 0,
                }}>{tag.letter}</span>
                <span className="mono" style={{
                  flex: 1, minWidth: 0,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  textDecoration: f.changeKind === 'deleted' ? 'line-through' : 'none',
                }}>{f.path}</span>
              </div>
            );
          })}
        </div>

        {/* Diff editor pane */}
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {active ? (
            <>
              <div style={{
                padding: '10px 14px', borderBottom: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', gap: 10,
                background: 'var(--bg)',
              }}>
                <span style={{ color: KIND_TAG[active.changeKind].color, fontSize: 11, fontWeight: 600 }}>
                  {KIND_TAG[active.changeKind].label}
                </span>
                <span className="mono" style={{ fontSize: 12.5, fontWeight: 500 }}>{active.path}</span>
                <div style={{ flex: 1 }} />
                <DiffStat base={active.baseContent} next={active.newContent} />
              </div>
              <div style={{ flex: 1, minHeight: 480, background: '#1e1e1e' }}>
                <DiffEditor
                  key={active.path}
                  height="100%"
                  language={languageFor(active.path)}
                  theme="vs-dark"
                  original={active.baseContent}
                  modified={active.newContent}
                  options={{
                    readOnly: true,
                    renderSideBySide: true,
                    minimap: { enabled: false },
                    fontSize: 12.5,
                    automaticLayout: true,
                    renderWhitespace: 'selection',
                    scrollBeyondLastLine: false,
                  }}
                />
              </div>
            </>
          ) : (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-faint)' }}>
              选择左侧文件查看 diff
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// DiffStat shows "+N -M" — a coarse line-count delta computed locally so we
// don't have to ship a real diff to the client. Good enough for the header.
function DiffStat({ base, next }: { base: string; next: string }) {
  const baseLines = base ? base.split('\n').length : 0;
  const nextLines = next ? next.split('\n').length : 0;
  const added = Math.max(0, nextLines - baseLines);
  const removed = Math.max(0, baseLines - nextLines);
  return (
    <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
      <span style={{ color: 'var(--green-text)' }}>+{added}</span>
      <span style={{ color: 'var(--text-faint)' }}> / </span>
      <span style={{ color: 'var(--red-text)' }}>-{removed}</span>
    </span>
  );
}
