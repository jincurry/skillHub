import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { AIProvider } from '../api/types';
import { IconX } from './Icons';

interface Props {
  open: boolean;
  /** Pass an existing provider to enter edit mode; omit for create. */
  editing?: AIProvider | null;
  onClose: () => void;
  onSaved: () => void;
}

// Preset URL hints help users recognise common OpenAI-compatible endpoints
// without making them think about the format.
const URL_HINTS = [
  { label: 'OpenAI',     url: 'https://api.openai.com/v1' },
  { label: 'DeepSeek',   url: 'https://api.deepseek.com/v1' },
  { label: 'Moonshot',   url: 'https://api.moonshot.cn/v1' },
  { label: 'DashScope',  url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { label: 'Ollama',     url: 'http://localhost:11434/v1' },
];

export function AIProviderModal({ open, editing, onClose, onSaved }: Props) {
  const isEdit = !!editing;
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [isDefault, setIsDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Result of the last "test connection" click. Reset every time the user
  // edits the form so a stale "ok" can't lull them into a false sense of
  // success after they changed the key/url.
  const [testResult, setTestResult] = useState<null | { ok: true } | { error: string }>(null);

  // Reset state every time the modal (re)opens — otherwise switching between
  // "create" and "edit X" leaves the old form in place.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setBaseUrl(editing.baseUrl);
      setModel(editing.model);
      setApiKey('');
      setEnabled(editing.enabled);
      setIsDefault(editing.isDefault);
    } else {
      setName('');
      setBaseUrl('');
      setModel('');
      setApiKey('');
      setEnabled(true);
      setIsDefault(false);
    }
    setShowKey(false);
    setBusy(false);
    setErr(null);
    setTestResult(null);
  }, [open, editing]);

  if (!open) return null;

  // We only require a key when creating; on edit, leaving it blank means
  // "keep the existing one" which the server enforces.
  function validate(): string | null {
    if (!name.trim()) return '名称必填';
    if (!baseUrl.trim()) return 'Base URL 必填';
    if (!model.trim()) return 'Model 必填';
    if (!isEdit && !apiKey.trim()) return 'API Key 必填';
    if (!/^https?:\/\//.test(baseUrl.trim())) return 'Base URL 必须以 http:// 或 https:// 开头';
    return null;
  }

  async function submit() {
    const v = validate();
    if (v) { setErr(v); return; }
    setBusy(true);
    setErr(null);
    try {
      if (isEdit && editing) {
        const patch: {
          name?: string; baseUrl?: string; model?: string;
          apiKey?: string; enabled?: boolean; isDefault?: boolean;
        } = {
          name: name.trim(), baseUrl: baseUrl.trim(), model: model.trim(),
          enabled, isDefault,
        };
        // Only include apiKey when the user actually typed a new one — the
        // server treats an empty string as "trying to clear" and 400s.
        if (apiKey.trim()) patch.apiKey = apiKey.trim();
        await api.updateAIProvider(editing.id, patch);
      } else {
        await api.createAIProvider({
          name: name.trim(), baseUrl: baseUrl.trim(), model: model.trim(),
          apiKey: apiKey.trim(), enabled, isDefault,
        });
      }
      onSaved();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Test only works on saved providers — for a brand new entry the user has to
  // save first. Editing an existing provider with a fresh apiKey requires
  // saving as well (test runs against the server-stored encrypted key).
  async function runTest() {
    if (!editing) return;
    setBusy(true);
    setTestResult(null);
    try {
      await api.testAIProvider(editing.id);
      setTestResult({ ok: true });
    } catch (e) {
      setTestResult({ error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={busy ? undefined : onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg)', borderRadius: 10, width: 560, maxWidth: '94vw',
          boxShadow: '0 20px 50px rgba(15,23,42,0.25)', border: '1px solid var(--border)',
          maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
              {isEdit ? '编辑 AI 模型' : '新增 AI 模型'}
            </h3>
            <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 2 }}>
              支持任何 OpenAI 兼容协议（DeepSeek / Moonshot / Qwen / Azure / Ollama 等）
            </div>
          </div>
          <button className="btn sm ghost" onClick={onClose} disabled={busy} title="关闭">
            <IconX size={14} />
          </button>
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
          <Field label="名称" hint="给这个模型起个易记的别名">
            <input
              className="input"
              value={name}
              onChange={(e) => { setName(e.target.value); setTestResult(null); }}
              placeholder="如：公司 GPT-4o-mini"
              style={{ width: '100%' }}
            />
          </Field>

          <Field label="Base URL" hint="OpenAI 兼容的 v1 入口（不要带 /chat/completions）">
            <input
              className="input"
              value={baseUrl}
              onChange={(e) => { setBaseUrl(e.target.value); setTestResult(null); }}
              placeholder="https://api.deepseek.com/v1"
              style={{ width: '100%', fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
              {URL_HINTS.map((h) => (
                <button
                  key={h.label}
                  type="button"
                  onClick={() => { setBaseUrl(h.url); setTestResult(null); }}
                  style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 4,
                    border: '1px solid var(--border)', background: 'var(--bg-soft)',
                    color: 'var(--text-muted)', cursor: 'pointer',
                  }}
                >{h.label}</button>
              ))}
            </div>
          </Field>

          <Field label="Model" hint="API 请求里发给上游的 model 字段">
            <input
              className="input"
              value={model}
              onChange={(e) => { setModel(e.target.value); setTestResult(null); }}
              placeholder="如：deepseek-chat / gpt-4o-mini / qwen-plus"
              style={{ width: '100%', fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}
            />
          </Field>

          <Field
            label={isEdit ? 'API Key（留空则保留原 key）' : 'API Key'}
            hint="加密存储，永不返回前端"
          >
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="input"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setTestResult(null); }}
                placeholder={isEdit && editing?.hasKey ? '已配置（不变请留空）' : 'sk-...'}
                style={{ flex: 1, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}
              />
              <button
                type="button"
                className="btn sm"
                onClick={() => setShowKey((v) => !v)}
              >{showKey ? '隐藏' : '显示'}</button>
            </div>
          </Field>

          <div style={{ display: 'flex', gap: 18 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              启用
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
              />
              设为默认
            </label>
          </div>

          {testResult && 'ok' in testResult && (
            <div style={{ fontSize: 12, color: 'var(--green-text)', background: 'var(--green-bg)', padding: '6px 10px', borderRadius: 6 }}>
              ✓ 连通成功
            </div>
          )}
          {testResult && 'error' in testResult && (
            <div style={{ fontSize: 12, color: 'var(--red-text)', background: 'var(--red-bg)', padding: '6px 10px', borderRadius: 6, lineHeight: 1.5 }}>
              连通失败：{testResult.error}
            </div>
          )}
          {err && (
            <div style={{ fontSize: 12.5, color: 'var(--red-text)' }}>{err}</div>
          )}
        </div>

        <div style={{
          padding: '12px 18px', borderTop: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', gap: 8,
        }}>
          <div>
            {isEdit && (
              <button className="btn sm" onClick={runTest} disabled={busy}>
                测试连通
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={onClose} disabled={busy}>取消</button>
            <button className="btn primary" onClick={submit} disabled={busy}>
              {busy ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 5 }}>
        {label}
      </div>
      {children}
      {hint && (
        <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>{hint}</div>
      )}
    </div>
  );
}
