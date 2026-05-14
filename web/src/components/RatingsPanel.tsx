import { useState } from 'react';
import { IconStar } from './Icons';
import { api } from '../api/client';
import { useAsync } from '../api/useAsync';
import type { RatingsResponse } from '../api/types';

function Stars({ value, onPick, size = 18, interactive = false }: {
  value: number; onPick?: (n: number) => void; size?: number; interactive?: boolean;
}) {
  const [hover, setHover] = useState(0);
  const display = hover || value;
  return (
    <span style={{ display: 'inline-flex', gap: 2, color: 'var(--amber)', cursor: interactive ? 'pointer' : 'default' }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n}
          onMouseEnter={() => interactive && setHover(n)}
          onMouseLeave={() => interactive && setHover(0)}
          onClick={() => interactive && onPick?.(n)}
          style={{ opacity: n <= display ? 1 : 0.25, lineHeight: 1 }}>
          <IconStar size={size} />
        </span>
      ))}
    </span>
  );
}

export function RatingsPanel({ ns, name }: { ns: string; name: string }) {
  const ratings = useAsync<RatingsResponse>(() => api.listRatings(ns, name), [ns, name]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (stars: number) => {
    setBusy(true); setErr(null);
    try {
      await api.rateSkill(ns, name, stars, comment.trim());
      setComment('');
      ratings.reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const summary = ratings.data?.summary;
  const items = ratings.data?.items ?? [];
  const mine = summary?.mine ?? 0;

  return (
    <div className="card" style={{ marginTop: 'var(--gap)' }}>
      <div className="card-header">
        <h3 className="card-title">用户评分 <span className="count-pill" style={{ marginLeft: 6 }}>{summary?.count ?? 0}</span></h3>
        {summary && summary.count > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <Stars value={Math.round(summary.average)} size={14} />
            <strong className="num">{summary.average.toFixed(1)}</strong>
            <span style={{ color: 'var(--text-faint)' }}>/ 5</span>
          </div>
        )}
      </div>
      <div className="card-body">
        <div style={{ padding: '8px 0 14px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
            {mine > 0 ? <>你已评分 <strong>{mine}</strong> 星 — 重新选择以更新</> : <>给这个 skill 评分:</>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <Stars value={mine} onPick={submit} size={22} interactive />
            <input className="input" placeholder="可选评论..." value={comment}
              onChange={(e) => setComment(e.target.value)}
              style={{ flex: 1, minWidth: 200 }} />
          </div>
          {busy && <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 6 }}>提交中...</div>}
          {err && <div style={{ fontSize: 12, color: 'var(--red-text)', marginTop: 6 }}>{err}</div>}
        </div>

        <div style={{ paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {ratings.loading && <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>加载中...</div>}
          {!ratings.loading && items.length === 0 && (
            <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>还没有用户评论 — 成为第一个吧</div>
          )}
          {items.map((r, i) => (
            <div key={r.username + r.createdAt} style={{ display: 'flex', gap: 10 }}>
              <div className={`avatar sm bg-${(i % 5) + 1}`} style={{ width: 30, height: 30, fontSize: 13, flexShrink: 0 }}>
                {r.username[0]?.toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <span className="mono" style={{ fontWeight: 600, fontSize: 12.5 }}>@{r.username}</span>
                  <Stars value={r.stars} size={11} />
                  <span style={{ color: 'var(--text-faint)', fontSize: 11.5 }}>· {new Date(r.createdAt).toLocaleString()}</span>
                </div>
                {r.comment && (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>{r.comment}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
