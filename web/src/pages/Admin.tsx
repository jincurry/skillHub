import { useState } from 'react';
import { ClassificationTag } from '../components/Tags';
import {
  IconExternal, IconRocket, IconArrowUp, IconPlus, IconMore,
} from '../components/Icons';
import { api } from '../api/client';
import { useAsync } from '../api/useAsync';

export function Admin() {
  const [tab, setTab] = useState<'overview' | 'namespaces' | 'members' | 'policies' | 'integrations'>('overview');
  const namespaces = useAsync(() => api.namespaces(), []);
  const skills = useAsync(() => api.listSkills(), []);
  const [memberNs, setMemberNs] = useState<string>('platform-team');
  const members = useAsync(() => api.namespaceMembers(memberNs), [memberNs]);

  const totalSkills = skills.data?.length ?? 0;
  const totalActivations = (skills.data ?? []).reduce((acc, s) => acc + s.activations, 0);

  return (
    <div className="content-inner">
      <div className="page-header">
        <div>
          <h1 className="page-title">管理后台</h1>
          <p className="page-subtitle">仅限平台管理员可见。配置全局策略、命名空间、配额与集成。</p>
        </div>
        <div className="page-actions">
          <button className="btn"><IconExternal size={14} /> Runbook</button>
          <button className="btn primary"><IconRocket size={14} /> 全局公告</button>
        </div>
      </div>

      <div className="tabs">
        <div className={`tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>概览</div>
        <div className={`tab ${tab === 'namespaces' ? 'active' : ''}`} onClick={() => setTab('namespaces')}>命名空间 <span className="count">{namespaces.data?.length ?? 0}</span></div>
        <div className={`tab ${tab === 'members' ? 'active' : ''}`} onClick={() => setTab('members')}>成员 & 角色</div>
        <div className={`tab ${tab === 'policies' ? 'active' : ''}`} onClick={() => setTab('policies')}>策略</div>
        <div className={`tab ${tab === 'integrations' ? 'active' : ''}`} onClick={() => setTab('integrations')}>集成</div>
      </div>

      {tab === 'overview' && (
        <div>
          <div className="stat-strip">
            <div className="stat"><div className="stat-label">活跃 Skills</div><div><span className="stat-value num">{totalSkills}</span><span className="stat-delta up"><IconArrowUp size={11} />4</span></div></div>
            <div className="stat"><div className="stat-label">月活用户</div><div><span className="stat-value num">1,284</span><span className="stat-delta up"><IconArrowUp size={11} />9.2%</span></div></div>
            <div className="stat"><div className="stat-label">本月调用</div><div><span className="stat-value num">{totalActivations.toLocaleString()}</span><span className="stat-delta up"><IconArrowUp size={11} />12.4%</span></div></div>
            <div className="stat"><div className="stat-label">全局成功率</div><div><span className="stat-value num">99.2%</span><span className="stat-delta flat">±0.0pp</span></div></div>
          </div>

          <div className="admin-grid">
            <div className="card">
              <div className="card-header"><h3 className="card-title">配额使用情况</h3><span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>本月</span></div>
              <div className="card-body">
                {[
                  { n: '调用次数', used: 487, total: 1000, unit: 'K', pct: 48.7 },
                  { n: '存储', used: 14.2, total: 50, unit: 'GB', pct: 28 },
                  { n: '出口流量', used: 88.4, total: 100, unit: 'GB', pct: 88, level: 'warn' },
                  { n: '审批 SLA 容量', used: 42, total: 50, unit: '件/日', pct: 84, level: 'warn' },
                ].map((q, i) => (
                  <div key={i} style={{ marginBottom: i < 3 ? 14 : 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                      <span style={{ fontWeight: 500 }}>{q.n}</span>
                      <span className="num" style={{ color: 'var(--text-subtle)', fontSize: 12.5 }}>{q.used}{q.unit} / {q.total}{q.unit}</span>
                    </div>
                    <div className="quota-bar">
                      <div className={`quota-fill ${q.level || ''}`} style={{ width: q.pct + '%' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h3 className="card-title">系统健康</h3></div>
              <div className="card-body">
                {[
                  { n: 'API Gateway', status: 'ok', uptime: '99.99%', latency: '42ms' },
                  { n: 'Skill Registry', status: 'ok', uptime: '100%', latency: '18ms' },
                  { n: 'Validation Engine', status: 'ok', uptime: '99.95%', latency: '320ms' },
                  { n: 'Audit Stream', status: 'warn', uptime: '99.2%', latency: '1.2s', note: 'backlog 上升' },
                  { n: 'SBOM Scanner', status: 'ok', uptime: '99.8%', latency: '4.1s' },
                ].map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < 4 ? '1px solid var(--border)' : 'none' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.status === 'ok' ? 'var(--green)' : 'var(--amber)' }} />
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{s.n}</span>
                    {s.note && <span style={{ fontSize: 11, color: 'var(--amber-text)' }}>{s.note}</span>}
                    <span className="num" style={{ fontSize: 12, color: 'var(--text-subtle)', minWidth: 60, textAlign: 'right' }}>{s.uptime}</span>
                    <span className="num mono" style={{ fontSize: 11, color: 'var(--text-faint)', minWidth: 60, textAlign: 'right' }}>{s.latency}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'namespaces' && (
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">命名空间</h3>
            <button className="btn sm primary"><IconPlus size={12} /> 新建命名空间</button>
          </div>
          <div className="card-body flush table-wrap">
            <table className="tbl">
              <thead><tr><th>命名空间</th><th>Owner</th><th style={{ textAlign: 'right' }}>Skills</th><th></th></tr></thead>
              <tbody>
                {namespaces.data?.map((ns) => (
                  <tr key={ns.id}>
                    <td><span className="mono" style={{ fontWeight: 600 }}>{ns.id}</span></td>
                    <td><span className="mono">@{ns.owner}</span></td>
                    <td className="num" style={{ textAlign: 'right', fontWeight: 500 }}>{ns.count}</td>
                    <td><button className="btn sm ghost"><IconMore size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'members' && (
        <div className="card" style={{ maxWidth: 760 }}>
          <div className="card-header" style={{ alignItems: 'center', gap: 10 }}>
            <h3 className="card-title">命名空间成员 & 角色</h3>
            <select
              value={memberNs}
              onChange={(e) => setMemberNs(e.target.value)}
              style={{ marginLeft: 'auto', padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6 }}
            >
              {(namespaces.data ?? []).map((n) => (
                <option key={n.id} value={n.id}>{n.id}</option>
              ))}
            </select>
          </div>
          <div className="card-body flush table-wrap">
            {members.loading && <div style={{ padding: 16, fontSize: 12, color: 'var(--text-subtle)' }}>加载中...</div>}
            {members.error && <div style={{ padding: 16, fontSize: 12, color: 'var(--red-text)' }}>{members.error.message}</div>}
            {members.data && (
              <table className="tbl">
                <thead><tr><th>用户</th><th>角色</th></tr></thead>
                <tbody>
                  {members.data.map((m) => {
                    const cls = m.role === 'owner' ? 'red' : m.role === 'maintainer' ? 'amber'
                      : m.role === 'reviewer' ? 'indigo' : 'green';
                    return (
                      <tr key={m.username}>
                        <td><span className="mono">@{m.username}</span></td>
                        <td><span className={`tag ${cls}`}>{m.role}</span></td>
                      </tr>
                    );
                  })}
                  {members.data.length === 0 && (
                    <tr><td colSpan={2} style={{ color: 'var(--text-faint)', fontSize: 12, padding: 12 }}>无成员</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'policies' && (
        <div style={{ maxWidth: 760 }}>
          <div className="card">
            <div className="card-header"><h3 className="card-title">发布策略</h3></div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { n: 'L3 密级强制双人审批', d: 'L3 必须 2 个 maintainer 批准才能发布', on: true },
                { n: '自动撤回失败率高的版本', d: '24h 内成功率 < 80% 自动 yank', on: true },
                { n: '禁止外部网络出口', d: '沙盒禁用 egress 除非显式声明', on: true },
                { n: 'Secret 扫描阻塞发布', d: '检测到 high-confidence secret 时阻止发布', on: true },
                { n: '包大小上限 5MB', d: '超过 5MB 的 skill 包需要平台管理员审批', on: true },
              ].map((p, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '4px 0' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500 }}>{p.n}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>{p.d}</div>
                  </div>
                  <div className={`toggle ${p.on ? 'on' : ''}`} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'integrations' && (
        <div className="admin-grid">
          {[
            { n: 'GitHub', d: 'PR 触发 / Action 调用 skill', on: true, ic: 'GH' },
            { n: 'Slack', d: '审批通知 / 错误告警推送', on: true, ic: 'SL' },
            { n: 'Jira', d: '发布事件创建 issue', on: false, ic: 'JR' },
            { n: 'PagerDuty', d: '严重错误触发 incident', on: true, ic: 'PD' },
            { n: 'Datadog', d: '健康度指标导出', on: true, ic: 'DD' },
            { n: 'Snowflake', d: '审计日志数仓同步', on: false, ic: 'SF' },
          ].map((it, i) => (
            <div key={i} className="card" style={{ padding: 18, display: 'flex', alignItems: 'center', gap: 14 }}>
              <div className={`skill-icon ${['blue', 'violet', 'amber', 'red', 'violet', 'green'][i]}`} style={{ width: 40, height: 40, fontSize: 14 }}>{it.ic}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{it.n}</div>
                <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>{it.d}</div>
              </div>
              <div className={`toggle ${it.on ? 'on' : ''}`} />
              <button className="btn sm">配置</button>
            </div>
          ))}
        </div>
      )}

      {/* keep ClassificationTag import alive in case future use */}
      <span style={{ display: 'none' }}><ClassificationTag level="L1" /></span>
    </div>
  );
}
