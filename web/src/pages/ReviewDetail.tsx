import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  IconChevronRight, IconChat, IconXCircle, IconCheckCircle, IconPlus, IconAlertTriangle,
} from '../components/Icons';
import { api } from '../api/client';
import { useAsync } from '../api/useAsync';

export function ReviewDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const review = useAsync(() => api.getReview(id), [id]);
  const comments = useAsync(() => api.listComments(id), [id]);
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
          <button className="btn" disabled={r.status !== 'pending'} style={r.status !== 'pending' ? { opacity: 0.5, cursor: 'not-allowed' } : { color: 'var(--red-text)', borderColor: 'var(--red-bg)' }} onClick={() => decide('reject')}>
            <IconXCircle size={14} /> 驳回
          </button>
          <button className="btn" disabled={r.status !== 'pending'} style={r.status !== 'pending' ? { opacity: 0.5, cursor: 'not-allowed' } : { color: 'var(--amber-text)', borderColor: 'var(--amber-bg)' }} onClick={requestChanges}>
            <IconAlertTriangle size={14} /> 要求修改
          </button>
          <button className="btn primary" disabled={r.status !== 'pending'} style={r.status !== 'pending' ? { opacity: 0.5, cursor: 'not-allowed' } : {}} onClick={() => decide('approve')}>
            <IconCheckCircle size={14} /> 批准并发布
          </button>
        </div>
      </div>

      {actionMsg && (
        <div className="card" style={{ marginBottom: 'var(--gap)', borderLeft: '3px solid var(--primary)' }}>
          <div className="card-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13 }}>{actionMsg}</span>
            <button className="btn sm ghost" onClick={() => setActionMsg(null)}>关闭</button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 'var(--gap)' }}>
        <div>
          <div className="card" style={{ marginBottom: 'var(--gap)' }}>
            <div className="card-header"><h3 className="card-title">提交说明</h3></div>
            <div className="card-body" style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55 }}>
              {r.note || <em style={{ color: 'var(--text-faint)' }}>(无)</em>}
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3 className="card-title">讨论 <span className="tag outline" style={{ marginLeft: 6 }}>{comments.data?.length ?? 0}</span></h3></div>
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
                <div className="avatar sm bg-1" style={{ width: 30, height: 30, fontSize: 13, flexShrink: 0 }}>A</div>
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
              <button className="btn sm" style={{ marginTop: 6 }}><IconPlus size={12} /> 添加审批人</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
