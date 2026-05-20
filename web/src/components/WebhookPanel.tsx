import { useState } from 'react';
import { api } from '../api/client';
import type { Webhook, WebhookDelivery, CreateWebhookRequest } from '../api/types';
import { useAsync } from '../api/useAsync';
import { useLocaleText } from '../i18n/useLocaleText';

const ALL_EVENTS = ['skill.published', 'skill.yanked', 'skill.deprecated'];

interface Props {
  /** Scope: "" = admin global view, or a specific namespace slug. */
  ns?: string;
}

export function WebhookPanel({ ns = '' }: Props) {
  const { text, locale } = useLocaleText();
  const { data: hooks, loading, error, reload } = useAsync(() => api.listWebhooks(ns || undefined), [ns]);
  const [creating, setCreating] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
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
    if (!confirm(text('Delete this webhook?', '确定删除这个 Webhook？'))) return;
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
    setPingResult(prev => ({ ...prev, [hook.id]: text('Sending...', '发送中…') }));
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

  if (loading) return <div className="card"><div className="card-body" style={{ color: 'var(--text-muted)' }}>{text('Loading...', '加载中…')}</div></div>;
  if (error) return <div className="card"><div className="card-body" style={{ color: 'var(--red-text)' }}>{String(error.message ?? error)}</div></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
          Webhooks{ns ? ` · ${ns}` : ` (${text('Global', '全局')})`}
        </h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setShowHelp(h => !h)}
            className="btn sm ghost"
            style={{ fontSize: 12 }}
          >
            {showHelp ? text('Hide Help', '收起帮助') : text('Usage Guide', '使用说明')}
          </button>
          <button
            onClick={() => setCreating(c => !c)}
            className="btn sm"
          >
            {text('+ New', '+ 新建')}
          </button>
        </div>
      </div>

      {showHelp && (
        <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--bg-soft)' }}>
          <h4 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{text('What is a Webhook?', '什么是 Webhook？')}</h4>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--text-subtle)' }}>
            {text('A webhook is an HTTP callback. When selected events happen, such as a skill being published, yanked, or deprecated, SkillHub sends a POST request to your configured URL.', 'Webhook 是一种 HTTP 回调机制。当特定事件发生时（如 skill 发布、下架、废弃），SkillHub 会自动向您配置的 URL 发送 POST 请求，通知您的系统。')}
          </p>

          <h4 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{text('How to use it', '如何使用？')}</h4>
          <ol style={{ margin: 0, fontSize: 12, paddingLeft: 16, lineHeight: 1.8, color: 'var(--text-subtle)' }}>
            <li>{text('Click the "New" button in the upper right to create a webhook', '点击右上角"新建"按钮创建 Webhook')}</li>
            <li>{text('Enter your receiving endpoint URL (HTTPS required)', '输入您的接收端点 URL（必须支持 HTTPS）')}</li>
            <li>{text('Optionally set a signing secret to verify the request origin', '（可选）设置签名密钥用于验证请求来源')}</li>
            <li>{text('Choose the event types that should trigger it', '选择需要触发的事件类型')}</li>
            <li>{text('Click "Test" to verify the configuration', '点击"测试"按钮验证配置是否正确')}</li>
          </ol>

          <h4 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{text('Event Types', '事件类型')}</h4>
          <ul style={{ margin: 0, fontSize: 12, paddingLeft: 16, lineHeight: 1.8, color: 'var(--text-subtle)' }}>
            <li><code style={{ background: 'var(--bg)', padding: '2px 6px', borderRadius: 4 }}>skill.published</code>{text(': triggered when a skill is published', ': skill 被发布时触发')}</li>
            <li><code style={{ background: 'var(--bg)', padding: '2px 6px', borderRadius: 4 }}>skill.yanked</code>{text(': triggered when a skill is yanked', ': skill 被下架时触发')}</li>
            <li><code style={{ background: 'var(--bg)', padding: '2px 6px', borderRadius: 4 }}>skill.deprecated</code>{text(': triggered when a skill is deprecated', ': skill 被标记为废弃时触发')}</li>
          </ul>

          <h4 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{text('Request Format', '请求格式')}</h4>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--text-subtle)' }}>
            {text('Method: ', '请求方法：')}<code style={{ background: 'var(--bg)', padding: '2px 6px', borderRadius: 4 }}>POST</code><br/>
            Content-Type：<code style={{ background: 'var(--bg)', padding: '2px 6px', borderRadius: 4 }}>application/json</code>
          </p>

          <h4 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{text('Signature Verification', '签名验证')}</h4>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--text-subtle)' }}>
            {text('If a signing secret is configured, the request header includes ', '如果配置了签名密钥，请求头会包含 ')}<code style={{ background: 'var(--bg)', padding: '2px 6px', borderRadius: 4 }}>X-Webhook-Signature</code>{text(', with the hex-encoded value of HMAC-SHA256(request_body, secret). Your server can use the same algorithm to verify the request origin.', '，值为 HMAC-SHA256(request_body, secret) 的十六进制表示。您的服务端可以用相同算法验证请求来源。')}
          </p>

          <h4 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{text('Retry Behavior', '重试机制')}</h4>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--text-subtle)' }}>
            {text('If the receiver returns a non-2xx status or times out, the system retries automatically. Delivery logs are available in the webhook details.', '如果接收端返回非 2xx 状态码或超时，系统会自动重试。您可以在 webhook 详情中查看投递日志。')}
          </p>
        </div>
      )}

      {creating && (
        <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 6 }}>Endpoint URL *</label>
            <input
              className="input"
              placeholder="https://your-system.example.com/hooks/skillhub"
              value={form.url}
              onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 6 }}>
              {text('Signing Secret', '签名密钥')} <span style={{ color: 'var(--text-faint)' }}>{text('(optional, for HMAC-SHA256 signature verification)', '(可选，用于 HMAC-SHA256 验签)')}</span>
            </label>
            <input
              className="input mono"
              placeholder="my-webhook-secret"
              value={form.secret}
              onChange={e => setForm(f => ({ ...f, secret: e.target.value }))}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 6 }}>{text('Trigger Events', '触发事件')}</label>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {ALL_EVENTS.map(ev => (
                <label key={ev} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
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
          {saveError && <p style={{ fontSize: 12, color: 'var(--red-text)' }}>{saveError}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleCreate}
              disabled={!form.url || !form.events?.length}
              className="btn sm primary"
              style={{ opacity: (!form.url || !form.events?.length) ? 0.4 : 1 }}
            >
              {text('Save', '保存')}
            </button>
            <button
              onClick={() => { setCreating(false); setSaveError(''); }}
              className="btn sm"
            >
              {text('Cancel', '取消')}
            </button>
          </div>
        </div>
      )}

      {!hooks?.length && !creating && (
        <p style={{ fontSize: 13, color: 'var(--text-faint)' }}>{text('No webhooks yet. Click "New" to add the first one.', '暂无 Webhook，点击"新建"添加第一个。')}</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(hooks ?? []).map(hook => (
          <div key={hook.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12 }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                background: hook.enabled ? 'var(--green)' : 'var(--text-faint)'
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="mono" style={{ margin: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hook.url}</p>
                <p style={{ marginTop: 2, marginBottom: 0, fontSize: 12, color: 'var(--text-faint)' }}>
                  {hook.events.join(', ')}
                  {hook.ns ? ` · ${hook.ns}` : ` · ${text('Global', '全局')}`}
                  {hook.hasSecret ? ` · ${text('Signed', '已签名')}` : ''}
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {pingResult[hook.id] && (
                  <span style={{
                    fontSize: 12, padding: '2px 6px', borderRadius: 4,
                    background: pingResult[hook.id].startsWith('✓') ? 'var(--green-bg)' : 'var(--red-bg)',
                    color: pingResult[hook.id].startsWith('✓') ? 'var(--green-text)' : 'var(--red-text)',
                  }}>
                    {pingResult[hook.id]}
                  </span>
                )}
                <button onClick={() => handlePing(hook)} className="btn sm ghost" style={{ fontSize: 12 }}>{text('Test', '测试')}</button>
                <button onClick={() => handleToggle(hook)} className="btn sm ghost" style={{ fontSize: 12 }}>
                  {hook.enabled ? text('Disable', '停用') : text('Enable', '启用')}
                </button>
                <button onClick={() => handleExpand(hook)} className="btn sm ghost" style={{ fontSize: 12 }}>
                  {expanded === hook.id ? text('Collapse', '收起') : text('Logs', '日志')}
                </button>
                <button onClick={() => handleDelete(hook.id)} className="btn sm ghost" style={{ fontSize: 12, color: 'var(--red-text)' }}>{text('Delete', '删除')}</button>
              </div>
            </div>

            {expanded === hook.id && (
              <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-soft)', padding: 12 }}>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 500, marginBottom: 8 }}>{text('Recent Deliveries', '最近投递记录')}</p>
                {!deliveries[hook.id]?.length ? (
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>{text('No deliveries yet', '暂无投递记录')}</p>
                ) : (
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ color: 'var(--text-subtle)' }}>
                        <th style={{ textAlign: 'left', fontWeight: 400, paddingBottom: 6 }}>{text('Event', '事件')}</th>
                        <th style={{ textAlign: 'left', fontWeight: 400, paddingBottom: 6 }}>{text('Status', '状态')}</th>
                        <th style={{ textAlign: 'left', fontWeight: 400, paddingBottom: 6 }}>{text('Duration', '耗时')}</th>
                        <th style={{ textAlign: 'left', fontWeight: 400, paddingBottom: 6 }}>{text('Time', '时间')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deliveries[hook.id].map(d => (
                        <tr key={d.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: 6, fontFamily: 'monospace' }}>{d.event}</td>
                          <td style={{ padding: 6 }}>
                            <span style={{
                              padding: '2px 6px', borderRadius: 4, fontSize: 11,
                              background: d.statusCode >= 200 && d.statusCode < 300
                                ? 'var(--green-bg)'
                                : 'var(--red-bg)',
                              color: d.statusCode >= 200 && d.statusCode < 300
                                ? 'var(--green-text)'
                                : 'var(--red-text)',
                            }}>
                              {d.statusCode || d.error || '—'}
                            </span>
                          </td>
                          <td style={{ padding: 6, color: 'var(--text-subtle)' }}>{d.durationMs}ms</td>
                          <td style={{ padding: 6, color: 'var(--text-faint)' }}>{new Date(d.deliveredAt).toLocaleString(locale)}</td>
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
