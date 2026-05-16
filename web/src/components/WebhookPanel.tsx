import { useState } from 'react';
import { api } from '../api/client';
import type { Webhook, WebhookDelivery, CreateWebhookRequest } from '../api/types';
import { useAsync } from '../api/useAsync';

const ALL_EVENTS = ['skill.published', 'skill.yanked', 'skill.deprecated'];

interface Props {
  /** Scope: "" = admin global view, or a specific namespace slug. */
  ns?: string;
}

export function WebhookPanel({ ns = '' }: Props) {
  const { data: hooks, loading, error, reload } = useAsync(() => api.listWebhooks(ns || undefined), [ns]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CreateWebhookRequest>({
    ns,
    url: '',
    secret: '',
    events: ['skill.published'],
    enabled: true,
  });
  const [saveError, setSaveError] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [deliveries, setDeliveries] = useState<Record<number, WebhookDelivery[]>>({});
  const [pingResult, setPingResult] = useState<Record<number, string>>({});

  async function handleCreate() {
    setSaveError('');
    try {
      await api.createWebhook(form);
      setCreating(false);
      setForm({ ns, url: '', secret: '', events: ['skill.published'], enabled: true });
      reload();
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleToggle(hook: Webhook) {
    await api.updateWebhook(hook.id, { enabled: !hook.enabled });
    reload();
  }

  async function handleDelete(id: number) {
    if (!confirm('确定删除这个 Webhook？')) return;
    await api.deleteWebhook(id);
    reload();
  }

  async function handleExpand(hook: Webhook) {
    if (expanded === hook.id) { setExpanded(null); return; }
    setExpanded(hook.id);
    if (!deliveries[hook.id]) {
      const d = await api.listWebhookDeliveries(hook.id);
      setDeliveries(prev => ({ ...prev, [hook.id]: d }));
    }
  }

  async function handlePing(hook: Webhook) {
    setPingResult(prev => ({ ...prev, [hook.id]: '发送中…' }));
    try {
      const r = await api.pingWebhook(hook.id);
      const msg = r.statusCode >= 200 && r.statusCode < 300
        ? `✓ ${r.statusCode}  (${r.durationMs}ms)`
        : `✗ ${r.statusCode || 'error'}  ${r.error}  (${r.durationMs}ms)`;
      setPingResult(prev => ({ ...prev, [hook.id]: msg }));
    } catch (e: unknown) {
      setPingResult(prev => ({ ...prev, [hook.id]: `✗ ${e instanceof Error ? e.message : String(e)}` }));
    }
  }

  function toggleEvent(ev: string) {
    setForm(f => ({
      ...f,
      events: f.events?.includes(ev) ? f.events.filter(e => e !== ev) : [...(f.events ?? []), ev],
    }));
  }

  if (loading) return <div className="text-sm text-gray-500">加载中…</div>;
  if (error) return <div className="text-sm text-red-500">{String(error.message ?? error)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">
          Webhooks{ns ? ` · ${ns}` : ' (全局)'}
        </h3>
        <button
          onClick={() => setCreating(c => !c)}
          className="text-xs px-3 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700"
        >
          + 新建
        </button>
      </div>

      {creating && (
        <div className="border rounded-lg p-4 space-y-3 bg-gray-50 dark:bg-gray-800">
          <div>
            <label className="block text-xs font-medium mb-1">Endpoint URL *</label>
            <input
              className="w-full border rounded px-2 py-1 text-sm"
              placeholder="https://your-system.example.com/hooks/skillhub"
              value={form.url}
              onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              签名密钥 <span className="text-gray-400">(可选，用于 HMAC-SHA256 验签)</span>
            </label>
            <input
              className="w-full border rounded px-2 py-1 text-sm font-mono"
              placeholder="my-webhook-secret"
              value={form.secret}
              onChange={e => setForm(f => ({ ...f, secret: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">触发事件</label>
            <div className="flex gap-3">
              {ALL_EVENTS.map(ev => (
                <label key={ev} className="flex items-center gap-1 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.events?.includes(ev) ?? false}
                    onChange={() => toggleEvent(ev)}
                  />
                  {ev}
                </label>
              ))}
            </div>
          </div>
          {saveError && <p className="text-xs text-red-500">{saveError}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!form.url || !form.events?.length}
              className="text-xs px-3 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              保存
            </button>
            <button
              onClick={() => { setCreating(false); setSaveError(''); }}
              className="text-xs px-3 py-1 rounded border hover:bg-gray-100"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {!hooks?.length && !creating && (
        <p className="text-sm text-gray-400">暂无 Webhook，点击"新建"添加第一个。</p>
      )}

      <div className="space-y-2">
        {(hooks ?? []).map(hook => (
          <div key={hook.id} className="border rounded-lg overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${hook.enabled ? 'bg-green-500' : 'bg-gray-300'}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-mono truncate">{hook.url}</p>
                <p className="text-xs text-gray-400">
                  {hook.events.join(', ')}
                  {hook.ns ? ` · ${hook.ns}` : ' · 全局'}
                  {hook.hasSecret ? ' · 已签名' : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {pingResult[hook.id] && (
                  <span className={`text-xs px-2 py-0.5 rounded font-mono ${
                    pingResult[hook.id].startsWith('✓') ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'
                  }`}>
                    {pingResult[hook.id]}
                  </span>
                )}
                <button onClick={() => handlePing(hook)} className="text-xs text-gray-500 hover:text-indigo-600">测试</button>
                <button onClick={() => handleToggle(hook)} className="text-xs text-gray-500 hover:text-indigo-600">
                  {hook.enabled ? '停用' : '启用'}
                </button>
                <button onClick={() => handleExpand(hook)} className="text-xs text-gray-500 hover:text-indigo-600">
                  {expanded === hook.id ? '收起' : '日志'}
                </button>
                <button onClick={() => handleDelete(hook.id)} className="text-xs text-red-400 hover:text-red-600">删除</button>
              </div>
            </div>

            {expanded === hook.id && (
              <div className="border-t bg-gray-50 dark:bg-gray-900 px-4 py-3">
                <p className="text-xs font-medium mb-2">最近投递记录</p>
                {!deliveries[hook.id]?.length ? (
                  <p className="text-xs text-gray-400">暂无投递记录</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500">
                        <th className="text-left font-normal pb-1">事件</th>
                        <th className="text-left font-normal pb-1">状态</th>
                        <th className="text-left font-normal pb-1">耗时</th>
                        <th className="text-left font-normal pb-1">时间</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {deliveries[hook.id].map(d => (
                        <tr key={d.id}>
                          <td className="py-1 font-mono">{d.event}</td>
                          <td className="py-1">
                            <span className={`px-1.5 py-0.5 rounded text-xs ${
                              d.statusCode >= 200 && d.statusCode < 300
                                ? 'bg-green-100 text-green-700'
                                : 'bg-red-100 text-red-700'
                            }`}>
                              {d.statusCode || d.error || '—'}
                            </span>
                          </td>
                          <td className="py-1 text-gray-500">{d.durationMs}ms</td>
                          <td className="py-1 text-gray-400">{new Date(d.deliveredAt).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
