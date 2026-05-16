import { useState } from 'react';
import { api } from '../api/client';
import type { APIToken } from '../api/types';
import { useAsync } from '../api/useAsync';

export function TokensPanel() {
  const { data: tokens, loading, error, reload } = useAsync(() => api.listAPITokens(), []);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [expiresIn, setExpiresIn] = useState('');
  const [newToken, setNewToken] = useState('');
  const [saveError, setSaveError] = useState('');

  async function handleCreate() {
    setSaveError('');
    try {
      const res = await api.createAPIToken({ name, expiresIn });
      setNewToken(res.token);
      setCreating(false);
      setName('');
      setExpiresIn('');
      reload();
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDelete(tok: APIToken) {
    if (!confirm(`确定吊销 "${tok.name}"？吊销后使用该 Token 的系统将立即失去访问权限。`)) return;
    await api.deleteAPIToken(tok.id);
    reload();
  }

  if (loading) return <div className="text-sm text-gray-500">加载中…</div>;
  if (error) return <div className="text-sm text-red-500">{String(error.message ?? error)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">API Token (PAT)</h3>
        <button
          onClick={() => { setCreating(c => !c); setNewToken(''); }}
          className="text-xs px-3 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700"
        >
          + 新建 Token
        </button>
      </div>

      {newToken && (
        <div className="border border-yellow-400 rounded-lg p-4 bg-yellow-50 dark:bg-yellow-900/20 space-y-2">
          <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
            ⚠️ 请立即复制此 Token，关闭后将无法再次查看
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-white dark:bg-gray-900 border rounded px-2 py-1.5 font-mono break-all">
              {newToken}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(newToken)}
              className="text-xs px-2 py-1 border rounded hover:bg-gray-100 flex-shrink-0"
            >
              复制
            </button>
          </div>
          <button
            onClick={() => setNewToken('')}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            已复制，关闭
          </button>
        </div>
      )}

      {creating && (
        <div className="border rounded-lg p-4 space-y-3 bg-gray-50 dark:bg-gray-800">
          <div>
            <label className="block text-xs font-medium mb-1">Token 名称 *</label>
            <input
              className="w-full border rounded px-2 py-1 text-sm"
              placeholder="如：my-ci-pipeline"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">有效期</label>
            <select
              className="border rounded px-2 py-1 text-sm"
              value={expiresIn}
              onChange={e => setExpiresIn(e.target.value)}
            >
              <option value="">永不过期</option>
              <option value="30d">30 天</option>
              <option value="90d">90 天</option>
              <option value="365d">365 天</option>
            </select>
          </div>
          {saveError && <p className="text-xs text-red-500">{saveError}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!name.trim()}
              className="text-xs px-3 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              生成
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

      {!tokens?.length && !creating && (
        <p className="text-sm text-gray-400">暂无 API Token。创建后可用于外部系统访问 SkillHub API。</p>
      )}

      {!!tokens?.length && (
        <div className="border rounded-lg divide-y overflow-hidden">
          {tokens.map(tok => (
            <div key={tok.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{tok.name}</p>
                <p className="text-xs text-gray-400">
                  创建于 {new Date(tok.createdAt).toLocaleDateString()}
                  {tok.expiresAt ? ` · 过期 ${new Date(tok.expiresAt).toLocaleDateString()}` : ' · 永不过期'}
                  {tok.lastUsed ? ` · 最后使用 ${new Date(tok.lastUsed).toLocaleDateString()}` : ''}
                </p>
              </div>
              <button
                onClick={() => handleDelete(tok)}
                className="text-xs text-red-400 hover:text-red-600 flex-shrink-0"
              >
                吊销
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-4 text-xs text-blue-700 dark:text-blue-300 space-y-1">
        <p className="font-medium">使用方式</p>
        <p>在请求头中携带 Token：</p>
        <code className="block bg-white dark:bg-gray-900 rounded px-2 py-1 font-mono">
          Authorization: Bearer skillhub_&lt;your-token&gt;
        </code>
        <p className="text-gray-500">Token 格式以 <code>skillhub_</code> 开头，与普通登录 JWT 区分。</p>
      </div>
    </div>
  );
}
