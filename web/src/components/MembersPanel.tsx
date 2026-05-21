import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { useAsync } from '../api/useAsync';
import type { AdminUser, Namespace, NamespaceMember } from '../api/types';
import { useLocaleText } from '../i18n/useLocaleText';
import { useConfirm } from './useConfirm';

const ROLES: NamespaceMember['role'][] = ['owner', 'maintainer', 'reviewer', 'member'];

const roleTagClass: Record<string, string> = {
  owner: 'red',
  maintainer: 'amber',
  reviewer: 'indigo',
  member: 'green',
};

// Map a user's free-text profile role (e.g. "Senior Maintainer", "DBA Lead",
// "Security Reviewer") to a namespace permission role. Profile role is just
// a label on the user card; the namespace role is the actual permission
// scope. We use this only to pre-select a sensible default in the add-member
// form — admins can always override before clicking Add.
function suggestNamespaceRole(profileRole: string): NamespaceMember['role'] {
  const r = (profileRole ?? '').toLowerCase();
  if (!r) return 'member';
  if (r.includes('owner')) return 'owner';
  if (r.includes('review')) return 'reviewer';
  if (r.includes('maintain') || r.includes('admin') || r.includes('lead')) return 'maintainer';
  return 'member';
}

// MembersPanel powers Admin → 成员 tab. It owns:
//   - the namespace picker (top-right select)
//   - inline role changes (dropdown per row)
//   - delete (× button per row, refuses to drop the last owner)
//   - an add-member combobox at the bottom of the list (searches platform
//     users from /admin/users; hides disabled accounts and members already
//     in the current namespace)
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
  const [confirm, confirmEl] = useConfirm();
  const [busyOn, setBusyOn] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [addRole, setAddRole] = useState<NamespaceMember['role']>('member');
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<AdminUser | null>(null);
  // Track whether the admin manually overrode the suggested namespace role.
  // If they have, we stop auto-pre-selecting on subsequent picks so we don't
  // wipe their explicit choice.
  const [roleEdited, setRoleEdited] = useState(false);

  // When a user is picked from the combobox, pre-select the namespace role
  // based on their profile role label. The admin can still change it before
  // hitting Add. If they've already overridden the role manually for this
  // session, leave it alone.
  function handlePick(u: AdminUser | null) {
    setPicked(u);
    if (u && !roleEdited) {
      setAddRole(suggestNamespaceRole(u.role));
    }
  }

  // Pull the platform user list once; the panel is admin-only so the call
  // is always allowed. Cheap enough to leave unfiltered.
  const allUsers = useAsync(() => api.listAdminUsers(), []);

  const memberSet = useMemo(
    () => new Set((members.data ?? []).map((m) => m.username)),
    [members.data],
  );
  const candidates = useMemo(() => {
    return (allUsers.data ?? [])
      .filter((u) => !u.isDisabled && !memberSet.has(u.username))
      .sort((a, b) => a.username.localeCompare(b.username));
  }, [allUsers.data, memberSet]);

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
    const ok = await confirm({
      title: text('Remove member', '移除成员'),
      message: text(`Remove @${username} from ${ns}?`, `确认把 @${username} 从 ${ns} 移除？`),
      detail: text(
        'They will lose access to this namespace immediately. The user account itself is kept.',
        '将立即解除其在该命名空间的权限。用户账号本身保留。',
      ),
      confirmLabel: text('Remove', '移除'),
      cancelLabel: text('Cancel', '取消'),
      tone: 'danger',
    });
    if (!ok) return;
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
    if (!picked) { setErr(text('Pick a user first', '请先选择用户')); return; }
    setAdding(true);
    setErr(null);
    try {
      const next = await api.addNamespaceMember(ns, { username: picked.username, role: addRole });
      members.set(next);
      setPicked(null);
      setAddRole('member');
      // Reset the manual-override flag so the next picked user gets a fresh
      // suggestion based on their profile role.
      setRoleEdited(false);
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
        <UserCombobox
          users={candidates}
          loading={allUsers.loading}
          value={picked}
          onChange={handlePick}
          disabled={adding}
          onSubmit={() => { void add(); }}
          emptyHint={
            allUsers.data && candidates.length === 0
              ? text(
                  'All platform users are already members. Create new accounts in the Users tab first.',
                  '所有平台用户都已是成员。请先到「用户」tab 新建账号。',
                )
              : undefined
          }
        />
        <select
          value={addRole}
          onChange={(e) => {
            setAddRole(e.target.value as NamespaceMember['role']);
            setRoleEdited(true);
          }}
          disabled={adding}
          title={text(
            'Namespace permission role (controls approval, yank, member management). Auto-suggested from the user profile.',
            '命名空间权限角色（决定审批 / yank / 成员管理）。已根据用户档案自动推荐。',
          )}
          style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12.5 }}
        >
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button className="btn sm primary" onClick={add} disabled={adding || !picked}>
          {adding ? text('Adding...', '添加中...') : text('Add', '添加')}
        </button>
      </div>
      {confirmEl}
    </div>
  );
}

// Lightweight searchable user picker. Renders a text input with a dropdown
// of matching users (filtered by username + display). Selecting a user
// stores the full AdminUser object on the parent; clearing the input wipes
// the selection so the parent can disable the Add button.
function UserCombobox({
  users,
  loading,
  value,
  onChange,
  disabled,
  onSubmit,
  emptyHint,
}: {
  users: AdminUser[];
  loading: boolean;
  value: AdminUser | null;
  onChange: (u: AdminUser | null) => void;
  disabled?: boolean;
  onSubmit: () => void;
  emptyHint?: string;
}) {
  const { text } = useLocaleText();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  // Popup uses fixed positioning so it isn't clipped by .card { overflow:
  // hidden }. We recompute the rect whenever the dropdown opens, the page
  // scrolls, or the window resizes.
  const [popRect, setPopRect] = useState<{ left: number; top: number; width: number } | null>(null);

  // When the parent clears the picked user, also clear the visible query.
  useEffect(() => {
    if (!value) setQuery('');
    else setQuery(`@${value.username}`);
  }, [value]);

  // Close the dropdown on outside click. The popup is rendered outside the
  // wrap element (it's position: fixed at the document root visually), so
  // we also need to treat clicks inside it as "inside".
  useEffect(() => {
    if (!open) return;
    function handleDown(e: MouseEvent) {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (popRef.current?.contains(target)) return;
      setOpen(false);
    }
    window.addEventListener('mousedown', handleDown);
    return () => window.removeEventListener('mousedown', handleDown);
  }, [open]);

  // Track the input rect so the fixed-position popup follows it on scroll
  // and resize. Without this, scrolling the admin page would leave the
  // popup floating in place.
  useEffect(() => {
    if (!open) { setPopRect(null); return; }
    function recompute() {
      const el = inputRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPopRect({ left: r.left, top: r.bottom + 4, width: r.width });
    }
    recompute();
    window.addEventListener('scroll', recompute, true);
    window.addEventListener('resize', recompute);
    return () => {
      window.removeEventListener('scroll', recompute, true);
      window.removeEventListener('resize', recompute);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().replace(/^@/, '').toLowerCase();
    if (!q) return users.slice(0, 50);
    return users
      .filter((u) =>
        u.username.toLowerCase().includes(q)
        || (u.display ?? '').toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [users, query]);

  // Keep the highlight index inside the filtered range whenever it shrinks.
  useEffect(() => {
    setHighlight((h) => Math.min(h, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  function pick(u: AdminUser) {
    onChange(u);
    setOpen(false);
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: '1 1 240px', minWidth: 200 }}>
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          // Treat free typing as "no selection" until the user picks again.
          if (value) onChange(null);
        }}
        onFocus={() => setOpen(true)}
        placeholder={loading ? text('Loading users...', '加载用户中...') : text('Search by username or name', '搜索用户名或显示名')}
        disabled={disabled || loading}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setHighlight((h) => Math.min(h + 1, Math.max(0, filtered.length - 1)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (open && filtered[highlight]) {
              pick(filtered[highlight]);
            } else if (value) {
              onSubmit();
            }
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        style={{
          width: '100%', padding: '6px 10px',
          border: '1px solid var(--border)', borderRadius: 6, fontSize: 12.5,
          fontFamily: "'JetBrains Mono', monospace",
        }}
      />
      {open && popRect && (
        <div
          ref={popRef}
          // position: fixed so the popup escapes the parent .card's
          // overflow: hidden clip. Width tracks the input; minimum 280
          // keeps it readable even on narrow inputs.
          style={{
            position: 'fixed',
            top: popRect.top,
            left: popRect.left,
            width: Math.max(popRect.width, 280),
            background: 'var(--bg-elevated, var(--bg))',
            border: '1px solid var(--border)', borderRadius: 8,
            boxShadow: '0 16px 40px rgba(15,23,42,0.18)', zIndex: 1000,
            maxHeight: 320, overflowY: 'auto', fontSize: 13,
          }}
        >
          {filtered.length === 0 && (
            <div style={{ padding: '12px 14px', color: 'var(--text-faint)' }}>
              {emptyHint ?? text('No matching users', '没有匹配的用户')}
            </div>
          )}
          {filtered.map((u, idx) => {
            const active = idx === highlight;
            return (
              <div
                key={u.username}
                onMouseDown={(e) => { e.preventDefault(); pick(u); }}
                onMouseEnter={() => setHighlight(idx)}
                style={{
                  padding: '8px 12px', cursor: 'pointer',
                  background: active ? 'var(--bg-soft, var(--bg-hover))' : 'transparent',
                  display: 'flex', alignItems: 'center', gap: 10,
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="mono" style={{ fontWeight: 600 }}>@{u.username}</span>
                    {u.display && (
                      <span style={{ color: 'var(--text-subtle)', fontSize: 12 }}>{u.display}</span>
                    )}
                  </div>
                  {(u.role || u.team) && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 2, fontSize: 11, color: 'var(--text-faint)' }}>
                      {u.role && <span>{u.role}</span>}
                      {u.role && u.team && <span>·</span>}
                      {u.team && <span className="mono">{u.team}</span>}
                    </div>
                  )}
                </div>
                {u.isAdmin && (
                  <span className="tag amber" style={{ fontSize: 10, marginLeft: 'auto', flexShrink: 0 }}>{text('Admin', '管理员')}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
