import { useState } from 'react';
import { IconPlus, IconXCircle } from './Icons';
import { api } from '../api/client';
import { useAsync } from '../api/useAsync';
import type { AdminUser } from '../api/types';

function fmtDate(iso: string) {
  return iso ? new Date(iso).toLocaleDateString() : '—';
}

export function UsersPanel() {
  const users = useAsync(() => api.listAdminUsers(), []);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);

  return (
    <div className="card">
      <div className="card-header">
        <h3 className="card-title">用户管理</h3>
        <button className="btn sm primary" onClick={() => setShowCreate(true)}>
          <IconPlus size={12} /> 新建用户
        </button>
      </div>
      <div className="card-body flush table-wrap">
        {users.loading && (
          <div style={{ padding: 16, fontSize: 12, color: 'var(--text-subtle)' }}>加载中...</div>
        )}
        {users.error && (
          <div style={{ padding: 16, fontSize: 12, color: 'var(--red-text)' }}>{users.error.message}</div>
        )}
        {users.data && (
          <table className="tbl">
            <thead>
              <tr>
                <th>用户名</th>
                <th>显示名</th>
                <th>角色 / 团队</th>
                <th>邮箱</th>
                <th>状态</th>
                <th>加入时间</th>
                <th style={{ width: 160, textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.data.map((u) => (
                <tr key={u.username} style={{ opacity: u.isDisabled ? 0.5 : 1 }}>
                  <td>
                    <span className="mono" style={{ fontWeight: 600 }}>@{u.username}</span>
                    {u.isAdmin && <span className="tag amber" style={{ fontSize: 10, marginLeft: 6 }}>管理员</span>}
                  </td>
                  <td>{u.display || '—'}</td>
                  <td>
                    <div style={{ fontSize: 12.5 }}>{u.role || '—'}</div>
                    {u.team && <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>{u.team}</div>}
                  </td>
                  <td style={{ fontSize: 12.5 }}>{u.email || '—'}</td>
                  <td>
                    {u.isDisabled
                      ? <span className="tag" style={{ fontSize: 10, background: 'var(--red-bg)', color: 'var(--red-text)' }}>已禁用</span>
                      : <span className="tag green" style={{ fontSize: 10 }}>正常</span>}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-subtle)' }}>{fmtDate(u.joinedAt)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn sm" onClick={() => setEditing(u)}>编辑</button>
                    <button
                      className="btn sm"
                      style={{ marginLeft: 6, color: u.isDisabled ? 'var(--green-text)' : 'var(--red-text)' }}
                      onClick={async () => {
                        try {
                          await api.adminUpdateUser(u.username, { isDisabled: !u.isDisabled });
                          users.reload();
                        } catch (e) {
                          alert((e as Error).message);
                        }
                      }}
                    >{u.isDisabled ? '启用' : '禁用'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); users.reload(); }}
        />
      )}

      {editing && (
        <EditUserModal
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); users.reload(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create user modal
// ---------------------------------------------------------------------------
function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [username, setUsername] = useState('');
  const [display, setDisplay] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('');
  const [team, setTeam] = useState('');
  const [email, setEmail] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!username.trim() || !password) { setErr('用户名和密码必填'); return; }
    if (password.length < 6) { setErr('密码至少 6 位'); return; }
    setBusy(true); setErr(null);
    try {
      await api.createAdminUser({ username: username.trim(), display: display.trim(), password, role, team, email, isAdmin });
      onCreated();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="新建用户" onClose={onClose} busy={busy} onConfirm={submit} confirmLabel="创建">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="用户名 *">
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)}
            placeholder="john.doe" style={{ width: '100%', fontFamily: 'monospace' }} autoFocus />
        </Field>
        <Field label="显示名">
          <input className="input" value={display} onChange={(e) => setDisplay(e.target.value)}
            placeholder="John Doe" style={{ width: '100%' }} />
        </Field>
        <Field label="初始密码 *">
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="至少 6 位" style={{ width: '100%' }} autoComplete="new-password" />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="角色">
            <input className="input" value={role} onChange={(e) => setRole(e.target.value)}
              placeholder="Maintainer" style={{ width: '100%' }} />
          </Field>
          <Field label="团队">
            <input className="input" value={team} onChange={(e) => setTeam(e.target.value)}
              placeholder="backend-team" style={{ width: '100%' }} />
          </Field>
        </div>
        <Field label="邮箱">
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="john@example.com" style={{ width: '100%' }} />
        </Field>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
          <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
          设为平台管理员（可访问 Admin 后台全部功能）
        </label>
        {err && <div style={{ color: 'var(--red-text)', fontSize: 12.5 }}>{err}</div>}
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Edit user modal
// ---------------------------------------------------------------------------
function EditUserModal({ user, onClose, onSaved }: { user: AdminUser; onClose: () => void; onSaved: () => void }) {
  const [display, setDisplay] = useState(user.display);
  const [role, setRole] = useState(user.role);
  const [team, setTeam] = useState(user.team);
  const [email, setEmail] = useState(user.email);
  const [isAdmin, setIsAdmin] = useState(user.isAdmin);
  const [resetPwd, setResetPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (resetPwd && resetPwd.length < 6) { setErr('新密码至少 6 位'); return; }
    setBusy(true); setErr(null);
    try {
      const body: import('../api/types').AdminUpdateUserRequest = { display, role, team, email, isAdmin };
      if (resetPwd) body.password = resetPwd;
      await api.adminUpdateUser(user.username, body);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title={`编辑 @${user.username}`} onClose={onClose} busy={busy} onConfirm={submit} confirmLabel="保存">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="显示名">
          <input className="input" value={display} onChange={(e) => setDisplay(e.target.value)} style={{ width: '100%' }} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="角色">
            <input className="input" value={role} onChange={(e) => setRole(e.target.value)} style={{ width: '100%' }} />
          </Field>
          <Field label="团队">
            <input className="input" value={team} onChange={(e) => setTeam(e.target.value)} style={{ width: '100%' }} />
          </Field>
        </div>
        <Field label="邮箱">
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%' }} />
        </Field>
        <Field label="重置密码（留空则不修改）">
          <input className="input" type="password" value={resetPwd} onChange={(e) => setResetPwd(e.target.value)}
            placeholder="新密码，至少 6 位" style={{ width: '100%' }} autoComplete="new-password" />
        </Field>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
          <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
          平台管理员
        </label>
        {err && <div style={{ color: 'var(--red-text)', fontSize: 12.5 }}>{err}</div>}
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

function ModalShell({ title, children, onClose, busy, onConfirm, confirmLabel }: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  busy: boolean;
  onConfirm: () => void;
  confirmLabel: string;
}) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg)', borderRadius: 10, width: 480, maxWidth: '94vw', boxShadow: '0 20px 50px rgba(15,23,42,0.25)', border: '1px solid var(--border)' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{title}</h3>
          <button className="btn sm ghost" onClick={onClose} disabled={busy}><IconXCircle size={14} /></button>
        </div>
        <div style={{ padding: 18 }}>{children}</div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" onClick={onClose} disabled={busy}>取消</button>
          <button className="btn primary" onClick={onConfirm} disabled={busy}>
            {busy ? '处理中...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
