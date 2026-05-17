import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { DiffEditor } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import {
  IconChevronRight, IconChat, IconXCircle, IconCheckCircle, IconAlertTriangle,
} from '../components/Icons';
import { api } from '../api/client';
import { useAsync } from '../api/useAsync';
import { languageFor } from '../lib/files';
import type { ReviewFile, Comment, Me } from '../api/types';

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
  // Member list of the skill's namespace — used to populate the
  // 添加审批人 dropdown. Fetched lazily because most viewers won't open
  // the picker. We pass the ns explicitly once review.data loads so the
  // first call doesn't fire with `undefined`.
  const reviewNs = review.data?.ns;
  const nsMembers = useAsync(
    () => (reviewNs ? api.namespaceMembers(reviewNs) : Promise.resolve([])),
    [reviewNs],
  );
  const [newComment, setNewComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [reviewerPick, setReviewerPick] = useState('');
  const [reviewerFreeForm, setReviewerFreeForm] = useState('');
  const [reviewerBusy, setReviewerBusy] = useState(false);

  // Comment edit/delete state (shared between overview and inline comments)
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editingBody, setEditingBody] = useState('');

  const startEdit = (c: Comment) => {
    setEditingCommentId(c.id);
    setEditingBody(c.body);
  };

  const cancelEdit = () => {
    setEditingCommentId(null);
    setEditingBody('');
  };

  const saveEdit = async (id: number) => {
    if (!editingBody.trim()) return;
    try {
      await api.patchComment(id, editingBody.trim());
      setEditingCommentId(null);
      setEditingBody('');
      comments.reload();
    } catch (e) {
      setActionMsg(`编辑失败: ${(e as Error).message}`);
    }
  };

  const deleteComment = async (id: number) => {
    if (!window.confirm('确定删除此评论?')) return;
    try {
      await api.deleteComment(id);
      comments.reload();
    } catch (e) {
      setActionMsg(`删除失败: ${(e as Error).message}`);
    }
  };

  const addReviewer = async (username: string) => {
    const u = username.trim();
    if (!u) return;
    setReviewerBusy(true);
    try {
      await api.addReviewer(id, u);
      setReviewerPick('');
      setReviewerFreeForm('');
      review.reload();
      window.dispatchEvent(new CustomEvent('reviews:changed'));
    } catch (e) {
      setActionMsg(`添加失败: ${(e as Error).message}`);
    } finally {
      setReviewerBusy(false);
    }
  };

  const removeReviewer = async (username: string) => {
    if (!window.confirm(`将 @${username} 从此审批移除?`)) return;
    setReviewerBusy(true);
    try {
      await api.removeReviewer(id, username);
      review.reload();
      window.dispatchEvent(new CustomEvent('reviews:changed'));
    } catch (e) {
      setActionMsg(`移除失败: ${(e as Error).message}`);
    } finally {
      setReviewerBusy(false);
    }
  };

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
  const isAdmin = me.data?.isAdmin === true;
  const isClosed = r.status !== 'pending';
  const canDecide = !isClosed && !isAuthor && isReviewer;
  // Mirrors server canManageReviewers: author, an existing reviewer, or an
  // admin may add/remove reviewers. (Backend additionally allows ns
  // owner/maintainer — we can't tell that without an extra fetch, so we let
  // the server enforce the rest and just hide the UI for users we know are
  // disqualified.)
  const canManageReviewers = !isClosed && (isAuthor || isReviewer || isAdmin);
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
            {r.isHotfix && (
              <span className="tag" style={{ background: 'var(--red-bg)', color: 'var(--red-text)', fontWeight: 600 }}>
                ⚡ HOTFIX
              </span>
            )}
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

      {r.isHotfix && (
        <div
          className="card"
          style={{
            marginBottom: 'var(--gap)',
            borderLeft: '3px solid var(--red)',
            background: 'var(--red-bg)',
          }}
        >
          <div className="card-body" style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <IconAlertTriangle size={18} style={{ color: 'var(--red-text)', flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: 13, lineHeight: 1.55 }}>
              <div style={{ fontWeight: 600, color: 'var(--red-text)', marginBottom: 2 }}>
                Hotfix 紧急通道 · SLA 4h · 仅需 1 名审批人
              </div>
              <div style={{ color: 'var(--text-muted)' }}>
                原因: {r.hotfixReason || '(未填写)'}
              </div>
            </div>
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
                {comments.data?.map((c, i) => {
                  const isMyComment = c.author === myName;
                  const canEdit = isMyComment || isAdmin;
                  const isEditing = editingCommentId === c.id;
                  return (
                    <div key={c.id} style={{ display: 'flex', gap: 10 }}>
                      <div className={`avatar sm bg-${(i % 5) + 1}`} style={{ width: 30, height: 30, fontSize: 13, flexShrink: 0 }}>{c.author[0]?.toUpperCase()}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="mono" style={{ fontWeight: 600 }}>@{c.author}</span>
                          <span style={{ color: 'var(--text-faint)' }}>· {new Date(c.createdAt).toLocaleString()}</span>
                          {c.filePath && (
                            <span className="mono" style={{ fontSize: 11, padding: '1px 5px', borderRadius: 3, background: 'var(--bg-muted)', color: 'var(--text-subtle)' }}>
                              {c.filePath}:{c.lineNo} ({c.side})
                            </span>
                          )}
                          {canEdit && !isEditing && (
                            <span style={{ marginLeft: 'auto' }}>
                              <button className="btn sm" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => startEdit(c)}>编辑</button>
                              <button className="btn sm" style={{ padding: '2px 8px', fontSize: 11, marginLeft: 4, color: 'var(--red-text)' }} onClick={() => deleteComment(c.id)}>删除</button>
                            </span>
                          )}
                        </div>
                        {isEditing ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <textarea
                              className="input"
                              style={{ padding: '6px 10px', height: 60, resize: 'vertical', width: '100%', fontSize: 13 }}
                              value={editingBody}
                              onChange={(e) => setEditingBody(e.target.value)}
                            />
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                              <button className="btn sm" onClick={cancelEdit}>取消</button>
                              <button className="btn sm primary" onClick={() => saveEdit(c.id)}>保存</button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>{c.body}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
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

            {/* Frozen policy snapshot — shows the rules that were in effect at
                submission time so reviewers don't see surprises if a ns
                admin changed the policy mid-review. */}
            {r.policySnapshot && (
              <div className="card" style={{ marginBottom: 'var(--gap)' }}>
                <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h3 className="card-title">策略快照</h3>
                  <span className="tag" title="提交时已冻结,后续策略变更不影响此审批" style={{ fontSize: 10, color: 'var(--text-subtle)' }}>
                    🔒 已冻结
                  </span>
                </div>
                <div className="card-body" style={{ fontSize: 12.5, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div>
                    <span className="tag indigo">{r.policySnapshot.classification}</span>{' '}
                    {r.policySnapshot.mode === 'parallel' ? '并行' : '串行'} · SLA{' '}
                    <span className="mono">{r.policySnapshot.slaHours}h</span>
                  </div>
                  <div>
                    {r.policySnapshot.slots.map((s, i) => (
                      <div key={i} style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
                        Slot {i + 1}: {s.count} × {s.roles.join(' / ')}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="card">
              <div className="card-header"><h3 className="card-title">参与者</h3></div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Author row first — never removable. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="avatar sm bg-1" style={{ width: 28, height: 28, fontSize: 12 }}>
                    {r.author[0]?.toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }} className="mono">@{r.author}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>作者</div>
                  </div>
                </div>

                {r.reviewers.map((u, i) => (
                  <div key={u} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className={`avatar sm bg-${((i + 1) % 5) + 1}`} style={{ width: 28, height: 28, fontSize: 12 }}>
                      {u[0]?.toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }} className="mono">@{u}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>Reviewer</div>
                    </div>
                    {canManageReviewers && (
                      <button
                        onClick={() => removeReviewer(u)}
                        disabled={reviewerBusy}
                        title={`移除 @${u}`}
                        style={{
                          border: 'none', background: 'transparent', cursor: 'pointer',
                          color: 'var(--text-faint)', padding: '2px 6px', borderRadius: 4,
                          fontSize: 14, lineHeight: 1,
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--red-text)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-faint)'; }}
                      >×</button>
                    )}
                  </div>
                ))}

                {canManageReviewers && (() => {
                  // Candidates = ns members minus author, current reviewers, and
                  // the system bot. We don't filter by ns_role on purpose —
                  // sometimes the right reviewer is a 'member' or 'reviewer'
                  // tier user, not a maintainer.
                  const taken = new Set<string>([r.author, ...r.reviewers, 'system']);
                  const candidates = (nsMembers.data ?? [])
                    .filter((m) => !taken.has(m.username))
                    .map((m) => m.username);
                  return (
                    <div style={{
                      marginTop: 6, paddingTop: 10, borderTop: '1px solid var(--border)',
                      display: 'flex', flexDirection: 'column', gap: 6,
                    }}>
                      <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>添加审批人</div>
                      {candidates.length > 0 && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <select
                            className="input"
                            value={reviewerPick}
                            onChange={(e) => setReviewerPick(e.target.value)}
                            disabled={reviewerBusy}
                            style={{ flex: 1, fontSize: 12.5 }}
                          >
                            <option value="">— 选择 {r.ns} 成员 —</option>
                            {candidates.map((u) => (
                              <option key={u} value={u}>@{u}</option>
                            ))}
                          </select>
                          <button
                            className="btn sm primary"
                            onClick={() => addReviewer(reviewerPick)}
                            disabled={reviewerBusy || !reviewerPick}
                          >添加</button>
                        </div>
                      )}
                      {candidates.length === 0 && !nsMembers.loading && (
                        <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
                          {r.ns} 内已无可邀请成员
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input
                          className="input"
                          placeholder="或输入跨团队用户名..."
                          value={reviewerFreeForm}
                          onChange={(e) => setReviewerFreeForm(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && reviewerFreeForm.trim()) {
                              e.preventDefault();
                              void addReviewer(reviewerFreeForm);
                            }
                          }}
                          disabled={reviewerBusy}
                          style={{ flex: 1, fontSize: 12.5, fontFamily: "'JetBrains Mono', monospace" }}
                        />
                        <button
                          className="btn sm"
                          onClick={() => addReviewer(reviewerFreeForm)}
                          disabled={reviewerBusy || !reviewerFreeForm.trim()}
                        >添加</button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'changes' && (
        <ChangesView
          files={files}
          comments={comments}
          reviewId={id}
          me={me}
          editingCommentId={editingCommentId}
          editingBody={editingBody}
          setEditingBody={setEditingBody}
          startEdit={startEdit}
          cancelEdit={cancelEdit}
          saveEdit={saveEdit}
          deleteComment={deleteComment}
          myName={myName}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
}

// ChangesView is the diff browser. Left rail lists every snapshot row with a
// status letter; right pane shows a Monaco diff editor for the selected file.
// Inline comments for the active file are shown below the editor with an input
// to add new ones.
interface ChangesViewProps {
  files: ReturnType<typeof useAsync<ReviewFile[]>>;
  comments: ReturnType<typeof useAsync<Comment[]>>;
  reviewId: string;
  me: ReturnType<typeof useAsync<Me>>;
  editingCommentId: number | null;
  editingBody: string;
  setEditingBody: (body: string) => void;
  startEdit: (c: Comment) => void;
  cancelEdit: () => void;
  saveEdit: (id: number) => void;
  deleteComment: (id: number) => void;
  myName: string;
  isAdmin: boolean;
}

function ChangesView({ files, comments, reviewId, me, editingCommentId, editingBody, setEditingBody, startEdit, cancelEdit, saveEdit, deleteComment, myName, isAdmin }: ChangesViewProps) {
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

  // Inline comments for the active file, sorted by line number.
  const fileComments = useMemo(() => {
    if (!activePath || !comments.data) return [];
    return comments.data
      .filter((c) => c.filePath === activePath)
      .sort((a, b) => (a.lineNo ?? 0) - (b.lineNo ?? 0));
  }, [activePath, comments.data]);

  // Comment count per file for the sidebar badge.
  const commentCountByFile = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of comments.data ?? []) {
      if (c.filePath) map[c.filePath] = (map[c.filePath] ?? 0) + 1;
    }
    return map;
  }, [comments.data]);

  // Inline comment form state.
  const [inlineBody, setInlineBody] = useState('');
  const [inlineLine, setInlineLine] = useState('');
  const [inlineSide, setInlineSide] = useState<'base' | 'head'>('head');
  const [inlinePosting, setInlinePosting] = useState(false);

  // Editor refs for click-to-comment
  const originalEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const modifiedEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const handleEditorMount = (editor: editor.IStandaloneDiffEditor) => {
    originalEditorRef.current = editor;
    const orig = editor.getOriginalEditor();
    const mod = editor.getModifiedEditor();

    // Click on original (base) side -> set side='base' and line number
    orig.onMouseDown((e) => {
      const viewLine = orig.getTargetAtClientPoint(e.event.posx, e.event.posy)?.position?.lineNumber ?? 0;
      if (viewLine > 0) {
        setInlineLine(String(viewLine));
        setInlineSide('base');
      }
    });

    // Click on modified (head) side -> set side='head' and line number
    mod.onMouseDown((e) => {
      const viewLine = mod.getTargetAtClientPoint(e.event.posx, e.event.posy)?.position?.lineNumber ?? 0;
      if (viewLine > 0) {
        setInlineLine(String(viewLine));
        setInlineSide('head');
      }
    });
  };

  const submitInline = async () => {
    const lineNo = parseInt(inlineLine, 10);
    if (!inlineBody.trim() || !activePath || isNaN(lineNo) || lineNo <= 0) return;
    setInlinePosting(true);
    try {
      await api.addComment(reviewId, inlineBody.trim(), { filePath: activePath, lineNo, side: inlineSide });
      setInlineBody('');
      setInlineLine('');
      comments.reload();
    } finally {
      setInlinePosting(false);
    }
  };

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
            const cc = commentCountByFile[f.path] ?? 0;
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
                {cc > 0 && (
                  <span style={{
                    fontSize: 10, background: 'var(--primary)', color: '#fff',
                    borderRadius: 8, padding: '1px 5px', fontWeight: 600, flexShrink: 0,
                  }}>{cc}</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Diff editor pane + inline comments */}
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
              <div style={{ flex: 1, minHeight: 400, background: '#1e1e1e' }}>
                <DiffEditor
                  key={active.path}
                  height="100%"
                  language={languageFor(active.path)}
                  theme="vs-dark"
                  original={active.baseContent}
                  modified={active.newContent}
                  onMount={handleEditorMount}
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

              {/* Inline comments section */}
              <div style={{ borderTop: '1px solid var(--border)', padding: '12px 14px', background: 'var(--bg)' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                  行内评论 {fileComments.length > 0 && <span className="count-pill" style={{ marginLeft: 4 }}>{fileComments.length}</span>}
                </div>

                {fileComments.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 10 }}>该文件暂无行内评论</div>
                )}

                {fileComments.map((c) => {
                  const isMyComment = c.author === myName;
                  const canEdit = isMyComment || isAdmin;
                  const isEditing = editingCommentId === c.id;
                  return (
                    <div key={c.id} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                      <div className="avatar sm bg-2" style={{ width: 24, height: 24, fontSize: 11, flexShrink: 0 }}>
                        {c.author[0]?.toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="mono" style={{ fontWeight: 600 }}>@{c.author}</span>
                          <span style={{ color: 'var(--text-faint)', marginLeft: 6 }}>L{c.lineNo} · {c.side}</span>
                          <span style={{ color: 'var(--text-faint)', marginLeft: 6 }}>· {new Date(c.createdAt).toLocaleString()}</span>
                          {canEdit && !isEditing && (
                            <span style={{ marginLeft: 'auto' }}>
                              <button className="btn sm" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => startEdit(c)}>编辑</button>
                              <button className="btn sm" style={{ padding: '2px 8px', fontSize: 11, marginLeft: 4, color: 'var(--red-text)' }} onClick={() => deleteComment(c.id)}>删除</button>
                            </span>
                          )}
                        </div>
                        {isEditing ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <textarea
                              className="input"
                              style={{ padding: '6px 10px', height: 60, resize: 'vertical', width: '100%', fontSize: 12 }}
                              value={editingBody}
                              onChange={(e) => setEditingBody(e.target.value)}
                            />
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                              <button className="btn sm" onClick={cancelEdit}>取消</button>
                              <button className="btn sm primary" onClick={() => saveEdit(c.id)}>保存</button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 2 }}>{c.body}</div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Add inline comment form */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: fileComments.length > 0 ? 6 : 0, paddingTop: fileComments.length > 0 ? 10 : 0, borderTop: fileComments.length > 0 ? '1px solid var(--border)' : 'none' }}>
                  <div className="avatar sm bg-1" style={{ width: 24, height: 24, fontSize: 11, flexShrink: 0 }}>
                    {(me.data?.display ?? me.data?.username ?? '?').slice(0, 1).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        className="input"
                        type="number"
                        min={1}
                        placeholder="行号"
                        value={inlineLine}
                        onChange={(e) => setInlineLine(e.target.value)}
                        style={{ width: 70, fontSize: 12 }}
                      />
                      <select
                        className="input"
                        value={inlineSide}
                        onChange={(e) => setInlineSide(e.target.value as 'base' | 'head')}
                        style={{ width: 80, fontSize: 12 }}
                      >
                        <option value="head">head</option>
                        <option value="base">base</option>
                      </select>
                    </div>
                    <textarea
                      className="input"
                      placeholder="添加行内评论..."
                      value={inlineBody}
                      onChange={(e) => setInlineBody(e.target.value)}
                      style={{ padding: '6px 10px', height: 48, resize: 'vertical', width: '100%', fontSize: 12 }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        className="btn sm primary"
                        disabled={inlinePosting || !inlineBody.trim() || !inlineLine || parseInt(inlineLine) <= 0}
                        onClick={submitInline}
                      >
                        <IconChat size={11} /> {inlinePosting ? '发表中...' : '发表'}
                      </button>
                    </div>
                  </div>
                </div>
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
