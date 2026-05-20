import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  IconDownload, IconSearch, IconClock,
} from '../components/Icons';
import { api } from '../api/client';
import { AUDIT_ACTION_COLOR, auditActionLabel } from '../lib/audit';
import type { AuditLog } from '../api/types';
import { useLocaleText } from '../i18n/useLocaleText';

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function exportCSV(rows: AuditLog[]) {
  const header = 'time,actor,action,target,version,ip';
  const body = rows
    .map((r) =>
      [
        new Date(r.createdAt).toISOString(),
        r.actor,
        r.action,
        r.target,
        r.version,
        r.ip,
      ].map(csvEscape).join(','),
    )
    .join('\n');
  const blob = new Blob([header + '\n' + body + '\n'], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `skillhub-audit-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function Audit() {
  const { isEnglish, text, locale } = useLocaleText();
  const [params] = useSearchParams();
  const initialTarget = params.get('target') ?? '';
  const [q, setQ] = useState(initialTarget);
  const [debounced, setDebounced] = useState(initialTarget);
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [data, setData] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    api
      .listAuditLogs({
        q: debounced || undefined,
        actor: actor.trim() || undefined,
        action: action.trim() || undefined,
        limit: 200,
      })
      .then((rows) => {
        if (!cancelled) setData(rows ?? []);
      })
      .catch((e: Error) => { if (!cancelled) setErr(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [debounced, actor, action]);

  const actionOptions = Array.from(new Set(data.map((d) => d.action))).sort();
  const actorOptions = Array.from(new Set(data.map((d) => d.actor))).sort();

  return (
    <div className="content-inner">
      <div className="page-header">
        <div>
          <h1 className="page-title">{text('Audit Log', '审计日志')}</h1>
          <p className="page-subtitle">{text('Records every skill lifecycle and review action. Search by user, action, or keyword. Read-only.', '记录所有 skill 生命周期与审批动作，可按用户 / 动作 / 关键字检索。仅读，不可修改。')}</p>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => exportCSV(data)} disabled={data.length === 0}>
            <IconDownload size={14} /> {text('Export CSV', '导出 CSV')}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="input-wrap" style={{ maxWidth: 320 }}>
          <span className="icon-left"><IconSearch size={15} /></span>
          <input
            className="input with-icon"
            placeholder={text('Search skill / user / action...', '搜索 skill / 用户 / 动作...')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select
          className="input"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          style={{ height: 36, maxWidth: 200 }}
        >
          <option value="">{text('All actions', '所有动作')}</option>
          {actionOptions.map((a) => <option key={a} value={a}>{auditActionLabel(a, isEnglish)}</option>)}
        </select>
        <select
          className="input"
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          style={{ height: 36, maxWidth: 200 }}
        >
          <option value="">{text('All users', '所有用户')}</option>
          {actorOptions.map((a) => <option key={a} value={a}>@{a}</option>)}
        </select>
        {(q || actor || action) && (
          <button
            className="btn sm ghost"
            onClick={() => { setQ(''); setActor(''); setAction(''); }}
          >{text('Clear', '清空')}</button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--text-subtle)' }}>
          <IconClock size={12} /> {text(`${data.length} rows`, `${data.length} 条`)}
        </span>
      </div>

      <div className="card">
        <div style={{ display: 'grid', gridTemplateColumns: '180px 110px 150px 1fr 130px', gap: 14, padding: '10px 16px', fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid var(--border)', background: 'var(--bg-soft)', fontWeight: 500 }}>
          <span>{text('Time', '时间')}</span>
          <span>{text('User', '用户')}</span>
          <span>{text('Action', '动作')}</span>
          <span>{text('Target', '对象')}</span>
          <span style={{ textAlign: 'right' }}>{text('Source IP', '来源 IP')}</span>
        </div>
        <div className="card-body flush">
          {loading && <div style={{ padding: 16, color: 'var(--text-subtle)' }}>{text('Loading...', '加载中...')}</div>}
          {err && <div style={{ padding: 16, color: 'var(--red-text)' }}>{err}</div>}
          {!loading && !err && data.length === 0 && (
            <div style={{ padding: 24, color: 'var(--text-subtle)', textAlign: 'center' }}>{text('No matching records', '无匹配记录')}</div>
          )}
          {data.map((e) => (
            <div key={e.id} className="log-row">
              <span className="ts">{new Date(e.createdAt).toLocaleString(locale)}</span>
              <span><span className="mono" style={{ fontSize: 11.5, color: e.actor === 'system' ? 'var(--text-faint)' : 'var(--primary)' }}>@{e.actor}</span></span>
              <span><span className={`tag ${AUDIT_ACTION_COLOR[e.action] || ''}`}>{auditActionLabel(e.action, isEnglish)}</span></span>
              <span><span className="target">{e.target}</span> <span className="mono" style={{ color: 'var(--text-faint)', fontSize: 11 }}>{e.version}</span></span>
              <span className="ip">{e.ip}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
