import {
  IconDownload, IconExternal, IconSearch, IconChevronDown, IconClock,
} from '../components/Icons';
import { api } from '../api/client';
import { useAsync } from '../api/useAsync';

const ACTION_COLOR: Record<string, string> = {
  publish: 'green', yank: 'red', approve_review: 'green', reject_review: 'red',
  submit_review: 'blue', create_draft: 'blue', add_maintainer: 'indigo',
  remove_maintainer: 'amber', activate: '', update_settings: 'amber', rotate_key: 'amber',
};

export function Audit() {
  const logs = useAsync(() => api.listAuditLogs(200), []);
  const data = logs.data ?? [];

  return (
    <div className="content-inner">
      <div className="page-header">
        <div>
          <h1 className="page-title">审计日志</h1>
          <p className="page-subtitle">所有 skill 操作的不可变记录,默认保留 90 天,合规事件保留 7 年。</p>
        </div>
        <div className="page-actions">
          <button className="btn"><IconDownload size={14} /> 导出 CSV</button>
          <button className="btn primary"><IconExternal size={14} /> SIEM 接入</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="input-wrap" style={{ maxWidth: 320 }}>
          <span className="icon-left"><IconSearch size={15} /></span>
          <input className="input with-icon" placeholder="搜索 skill / 用户 / 动作..." />
        </div>
        <button className="dropdown" style={{ height: 36 }}>动作: <strong style={{ color: 'var(--text)' }}>全部</strong> <IconChevronDown size={12} /></button>
        <button className="dropdown" style={{ height: 36 }}>用户: <strong style={{ color: 'var(--text)' }}>全部</strong> <IconChevronDown size={12} /></button>
        <button className="dropdown" style={{ height: 36 }}>命名空间: <strong style={{ color: 'var(--text)' }}>全部</strong> <IconChevronDown size={12} /></button>
        <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--text-subtle)' }}>
          <IconClock size={12} /> 实时 · {data.length} 条
        </span>
      </div>

      <div className="card">
        <div style={{ display: 'grid', gridTemplateColumns: '180px 90px 130px 1fr 130px', gap: 14, padding: '10px 16px', fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid var(--border)', background: 'var(--bg-soft)', fontWeight: 500 }}>
          <span>时间</span>
          <span>用户</span>
          <span>动作</span>
          <span>对象</span>
          <span style={{ textAlign: 'right' }}>来源 IP</span>
        </div>
        <div className="card-body flush">
          {logs.loading && <div style={{ padding: 16, color: 'var(--text-subtle)' }}>加载中...</div>}
          {logs.error && <div style={{ padding: 16, color: 'var(--red-text)' }}>{logs.error.message}</div>}
          {data.map((e) => (
            <div key={e.id} className="log-row">
              <span className="ts">{new Date(e.createdAt).toLocaleString()}</span>
              <span><span className="mono" style={{ fontSize: 11.5, color: e.actor === 'system' ? 'var(--text-faint)' : 'var(--primary)' }}>@{e.actor}</span></span>
              <span><span className={`tag ${ACTION_COLOR[e.action] || ''}`}>{e.action}</span></span>
              <span><span className="target">{e.target}</span> <span className="mono" style={{ color: 'var(--text-faint)', fontSize: 11 }}>{e.version}</span></span>
              <span className="ip">{e.ip}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
