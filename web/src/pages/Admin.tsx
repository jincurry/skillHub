import { useState } from 'react';
import {
  IconPlus, IconMore, IconXCircle, IconRocket,
} from '../components/Icons';
import { api } from '../api/client';
import { useAsync } from '../api/useAsync';
import { AIProviderModal } from '../components/AIProviderModal';
import type { AIProvider } from '../api/types';

function Placeholder({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="card">
      <div className="card-body" style={{ padding: '40px 28px', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 10px', borderRadius: 999, background: 'var(--amber-bg)', color: 'var(--amber-text)', fontSize: 11.5, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          P1 · 待实现
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, marginTop: 12 }}>{title}</div>
        <div style={{ fontSize: 13, color: 'var(--text-subtle)', marginTop: 6, maxWidth: 480, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.55 }}>{hint}</div>
      </div>
    </div>
  );
}

export function Admin() {
  const [tab, setTab] = useState<'namespaces' | 'members' | 'overview' | 'policies' | 'ai'>('namespaces');
  const aiProviders = useAsync(() => api.listAIProviders(), []);
  const [aiModalOpen, setAIModalOpen] = useState(false);
  const [aiEditing, setAIEditing] = useState<AIProvider | null>(null);
  const [aiTesting, setAITesting] = useState<number | null>(null);
  const [aiTestResult, setAITestResult] = useState<Record<number, 'ok' | string>>({});
  const namespaces = useAsync(() => api.namespaces(), []);
  const [memberNs, setMemberNs] = useState<string>('');
  // Derived: fall back to the first namespace returned by the API until the
  // user picks one explicitly. Avoid setState during render.
  const fallbackNs = namespaces.data?.[0]?.id ?? '';
  const effectiveNs = memberNs || fallbackNs;
  const members = useAsync(
    () => effectiveNs ? api.namespaceMembers(effectiveNs) : Promise.resolve([]),
    [effectiveNs],
  );
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="content-inner">
      <div className="page-header">
        <div>
          <h1 className="page-title">管理后台</h1>
          <p className="page-subtitle">仅限平台管理员可见。当前已实现命名空间与成员管理；其余模块标注为 P1 待实现。</p>
        </div>
      </div>

      <div className="tabs">
        <div className={`tab ${tab === 'namespaces' ? 'active' : ''}`} onClick={() => setTab('namespaces')}>命名空间 <span className="count">{namespaces.data?.length ?? 0}</span></div>
        <div className={`tab ${tab === 'members' ? 'active' : ''}`} onClick={() => setTab('members')}>成员 &amp; 角色</div>
        <div className={`tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>概览</div>
        <div className={`tab ${tab === 'policies' ? 'active' : ''}`} onClick={() => setTab('policies')}>策略</div>
        <div className={`tab ${tab === 'ai' ? 'active' : ''}`} onClick={() => setTab('ai')}>
          AI 模型
          {aiProviders.data && aiProviders.data.length > 0 && (
            <span className="count">{aiProviders.data.length}</span>
          )}
        </div>
      </div>

      {tab === 'overview' && (
        <Placeholder
          title="平台健康度与配额监控"
          hint="将展示真实的系统组件状态、调用量、存储/流量配额、SLA 容量等指标。当前后端尚未提供对应的 metrics 接口。"
        />
      )}

      {tab === 'namespaces' && (
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">命名空间</h3>
            <button className="btn sm primary" onClick={() => setShowCreate(true)}>
              <IconPlus size={12} /> 新建命名空间
            </button>
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
        <div className="card">
          <div className="card-header" style={{ alignItems: 'center', gap: 10 }}>
            <h3 className="card-title">命名空间成员 &amp; 角色</h3>
            <select
              value={effectiveNs}
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
        <Placeholder
          title="发布策略与合规规则"
          hint="将提供 L3 密级双人审批、失败率自动撤回、Secret 扫描、包大小限制等可配置策略。当前仅支持后端代码内置的固定规则。"
        />
      )}

      {tab === 'ai' && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">AI 模型供应商</h3>
              <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 2 }}>
                仅支持 OpenAI 兼容协议。API Key 以 AES-GCM 加密存储，不会返回前端。
              </div>
            </div>
            <button
              className="btn sm primary"
              onClick={() => { setAIEditing(null); setAIModalOpen(true); }}
            >
              <IconPlus size={12} /> 新增模型
            </button>
          </div>
          <div className="card-body flush table-wrap">
            {aiProviders.loading && (
              <div style={{ padding: 16, fontSize: 12, color: 'var(--text-subtle)' }}>加载中...</div>
            )}
            {aiProviders.error && (
              <div style={{ padding: 16, fontSize: 12, color: 'var(--red-text)' }}>
                {aiProviders.error.message}
              </div>
            )}
            {aiProviders.data && aiProviders.data.length === 0 && (
              <div style={{ padding: '32px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
                  还没有配置模型
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginBottom: 14 }}>
                  配置后任何登录用户都能在 Skill 编辑器里调用 AI 助手。
                </div>
                <button className="btn sm primary" onClick={() => { setAIEditing(null); setAIModalOpen(true); }}>
                  <IconPlus size={12} /> 新增第一个模型
                </button>
              </div>
            )}
            {aiProviders.data && aiProviders.data.length > 0 && (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>Endpoint</th>
                    <th>Model</th>
                    <th>状态</th>
                    <th style={{ width: 220, textAlign: 'right' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {aiProviders.data.map((p) => {
                    const test = aiTestResult[p.id];
                    return (
                      <tr key={p.id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontWeight: 600 }}>{p.name}</span>
                            {p.isDefault && <span className="tag amber" style={{ fontSize: 10 }}>默认</span>}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                            {p.hasKey ? '✓ 已配置 key' : '⚠ 未配置 key'}
                          </div>
                        </td>
                        <td>
                          <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                            {p.baseUrl}
                          </span>
                        </td>
                        <td>
                          <span className="mono" style={{ fontSize: 11.5 }}>{p.model}</span>
                        </td>
                        <td>
                          {p.enabled
                            ? <span className="tag green" style={{ fontSize: 10 }}>启用中</span>
                            : <span className="tag" style={{ fontSize: 10, background: 'var(--bg-soft)', color: 'var(--text-subtle)' }}>已禁用</span>}
                          {test === 'ok' && (
                            <span style={{ fontSize: 10.5, color: 'var(--green-text)', marginLeft: 6 }}>✓ 连通</span>
                          )}
                          {test && test !== 'ok' && (
                            <span style={{ fontSize: 10.5, color: 'var(--red-text)', marginLeft: 6 }} title={test}>⚠ 错误</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="btn sm"
                            disabled={aiTesting === p.id}
                            onClick={async () => {
                              setAITesting(p.id);
                              setAITestResult((m) => { const n = { ...m }; delete n[p.id]; return n; });
                              try {
                                await api.testAIProvider(p.id);
                                setAITestResult((m) => ({ ...m, [p.id]: 'ok' }));
                              } catch (e) {
                                setAITestResult((m) => ({ ...m, [p.id]: (e as Error).message }));
                              } finally {
                                setAITesting(null);
                              }
                            }}
                          >
                            {aiTesting === p.id ? '测试中...' : '测试'}
                          </button>
                          <button
                            className="btn sm"
                            style={{ marginLeft: 6 }}
                            onClick={() => { setAIEditing(p); setAIModalOpen(true); }}
                          >编辑</button>
                          <button
                            className="btn sm"
                            style={{ marginLeft: 6, color: 'var(--red-text)' }}
                            onClick={async () => {
                              if (!confirm(`确定删除 “${p.name}”？已使用该模型的会话不受影响。`)) return;
                              try {
                                await api.deleteAIProvider(p.id);
                                aiProviders.reload();
                              } catch (e) {
                                alert('删除失败：' + (e as Error).message);
                              }
                            }}
                          >删除</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {showCreate && (
        <CreateNamespaceModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); namespaces.reload(); setTab('namespaces'); }}
        />
      )}

      <AIProviderModal
        open={aiModalOpen}
        editing={aiEditing}
        onClose={() => setAIModalOpen(false)}
        onSaved={() => aiProviders.reload()}
      />
    </div>
  );
}

function CreateNamespaceModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    const trimmed = id.trim();
    if (!trimmed) { setErr('命名空间 id 必填'); return; }
    setBusy(true); setErr(null);
    try {
      await api.createNamespace({ id: trimmed });
      onCreated();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg)', borderRadius: 10, width: 420, maxWidth: '92vw', boxShadow: '0 20px 50px rgba(15,23,42,0.25)', border: '1px solid var(--border)' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>新建命名空间</h3>
          <button className="btn sm ghost" onClick={onClose} disabled={busy}><IconXCircle size={14} /></button>
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'block' }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 4 }}>ID</div>
            <input
              className="input"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="qa-team"
              style={{ width: '100%', fontFamily: "'JetBrains Mono', monospace" }}
              autoFocus
            />
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
              小写字母、数字、连字符。你将自动成为 owner。
            </div>
          </label>
          {err && <div style={{ color: 'var(--red-text)', fontSize: 12.5 }}>{err}</div>}
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" onClick={onClose} disabled={busy}>取消</button>
          <button className="btn primary" onClick={submit} disabled={busy || !id.trim()}>
            <IconRocket size={13} /> {busy ? '创建中...' : '创建'}
          </button>
        </div>
      </div>
    </div>
  );
}
