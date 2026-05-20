import { useState } from 'react';
import { api } from '../api/client';
import { useAsync } from '../api/useAsync';
import type { Namespace, NamespaceMember } from '../api/types';
import { useLocaleText } from '../i18n/useLocaleText';

const ROLES: NamespaceMember['role'][] = ['owner', 'maintainer', 'reviewer', 'member'];

const roleTagClass: Record<string, string> = {
  owner: 'red',
  maintainer: 'amber',
  reviewer: 'indigo',
  member: 'green',
};

// MembersPanel powers Admin → 成员 tab. It owns:
//   - the namespace picker (top-right select)
//   - inline role changes (dropdown per row)
//   - delete (× button per row, refuses to drop the last owner)
//   - an add-member form at the bottom of the list
//
// `members` is hoisted from Admin.tsx so its useAsync state survives tab
// switches (and re-renders the row count badge in the tab header).
export function MembersPanel({
  ns,
  namespaces,
  onChangeNs,
  members,
}: {
  ns: string;
  namespaces: Namespace[];
  onChangeNs: (next: string) => void;
  members: ReturnType<typeof useAsync<NamespaceMember[]>>;
}) {
  const { text } = useLocaleText();
  const [busyOn, setBusyOn] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [addUser, setAddUser] = useState('');
  const [addRole, setAddRole] = useState<NamespaceMember['role']>('member');
  const [adding, setAdding] = useState(false);

  async function changeRole(username: string, role: string) {
    setBusyOn(username);
    setErr(null);
    try {
      const next = await api.updateNamespaceMemberRole(ns, username, role);
      members.set(next);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyOn(null);
    }
  }

  async function remove(username: string) {
    if (!window.confirm(text(`Remove @${username} from ${ns}?`, `确认把 @${username} 从 ${ns} 移除？`))) return;
    setBusyOn(username);
    setErr(null);
    try {
      const next = await api.removeNamespaceMember(ns, username);
      members.set(next);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyOn(null);
    }
  }

  async function add() {
    const username = addUser.trim().replace(/^@/, '');
    if (!username) { setErr(text('Enter a username', '请输入用户名')); return; }
    setAdding(true);
    setErr(null);
    try {
      const next = await api.addNamespaceMember(ns, { username, role: addRole });
      members.set(next);
      setAddUser('');
      setAddRole('member');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="card">
      <div className="card-header" style={{ alignItems: 'center', gap: 10 }}>
        <h3 className="card-title">{text('Namespace Members & Roles', '命名空间成员 & 角色')}</h3>
        <select
          value={ns}
          onChange={(e) => onChangeNs(e.target.value)}
          style={{ marginLeft: 'auto', padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6 }}
        >
          {namespaces.map((n) => (
            <option key={n.id} value={n.id}>{n.id}</option>
          ))}
        </select>
      </div>

      {err && (
        <div style={{ padding: '10px 16px', background: 'var(--red-bg)', color: 'var(--red-text)', fontSize: 12.5 }}>
          {err}
        </div>
      )}

      <div className="card-body flush table-wrap">
        {members.loading && <div style={{ padding: 16, fontSize: 12, color: 'var(--text-subtle)' }}>{text('Loading...', '加载中...')}</div>}
        {members.error && <div style={{ padding: 16, fontSize: 12, color: 'var(--red-text)' }}>{members.error.message}</div>}
        {members.data && (
          <table className="tbl">
            <thead>
              <tr>
                <th>{text('User', '用户')}</th>
                <th>{text('Role', '角色')}</th>
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {members.data.map((m) => {
                const busy = busyOn === m.username;
                return (
                  <tr key={m.username} style={busy ? { opacity: 0.55 } : undefined}>
                    <td><span className="mono">@{m.username}</span></td>
                    <td>
                      <select
                        value={m.role}
                        disabled={busy}
                        onChange={(e) => changeRole(m.username, e.target.value)}
                        style={{
                          padding: '2px 6px',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          fontSize: 12,
                          background: 'var(--bg)',
                          color: `var(--${roleTagClass[m.role]}-text, var(--text))`,
                          fontWeight: 500,
                        }}
                      >
                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn sm ghost"
                        disabled={busy}
                        title={text(`Remove @${m.username}`, `移除 @${m.username}`)}
                        onClick={() => remove(m.username)}
                        style={{
                          padding: '2px 6px', minWidth: 24, color: 'var(--text-faint)',
                          fontSize: 14, lineHeight: 1,
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--red-text)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-faint)'; }}
                      >×</button>
                    </td>
                  </tr>
                );
              })}
              {members.data.length === 0 && (
                <tr><td colSpan={3} style={{ color: 'var(--text-faint)', fontSize: 12, padding: 12 }}>{text('No members', '无成员')}</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <div style={{
        padding: '12px 16px', borderTop: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      }}>
        <div style={{ fontSize: 12, color: 'var(--text-subtle)', flexShrink: 0 }}>{text('Add Member', '添加成员')}</div>
        <input
          value={addUser}
          onChange={(e) => setAddUser(e.target.value)}
          placeholder={text('Username', '用户名')}
          disabled={adding}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }}
          style={{
            flex: '1 1 160px', minWidth: 120, padding: '4px 8px',
            border: '1px solid var(--border)', borderRadius: 6, fontSize: 12.5,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        />
        <select
          value={addRole}
          onChange={(e) => setAddRole(e.target.value as NamespaceMember['role'])}
          disabled={adding}
          style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12.5 }}
        >
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button className="btn sm primary" onClick={add} disabled={adding || !addUser.trim()}>
          {adding ? text('Adding...', '添加中...') : text('Add', '添加')}
        </button>
      </div>
    </div>
  );
}
