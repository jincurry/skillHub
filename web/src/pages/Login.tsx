import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { api } from '../api/client';
import { getToken, setStoredUser, setToken } from '../api/auth';

export function Login() {
  const nav = useNavigate();
  const loc = useLocation();
  const [username, setUsername] = useState('alice');
  const [password, setPassword] = useState('password');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (getToken()) {
    const to = (loc.state as { from?: string } | null)?.from || '/workspace';
    return <Navigate to={to} replace />;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await api.login(username.trim(), password);
      setToken(res.token);
      setStoredUser(res.user);
      const to = (loc.state as { from?: string } | null)?.from || '/workspace';
      nav(to, { replace: true });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', padding: 24,
    }}>
      <form onSubmit={submit} style={{
        width: 360, padding: 32, borderRadius: 12, background: 'var(--surface)',
        border: '1px solid var(--border)', boxShadow: '0 8px 24px rgba(0,0,0,.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div className="logo-mark" style={{ width: 32, height: 32, fontSize: 18 }}>s</div>
          <div className="logo-text" style={{ fontSize: 20 }}>skill<em>Hub</em></div>
        </div>
        <h2 style={{ margin: '0 0 6px', fontSize: 18 }}>登录</h2>
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 18 }}>
          种子用户:alice / bob / charlie / diana / frank。默认密码 <code>password</code>。
        </div>

        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>用户名</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus
               style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 12 }} />

        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>密码</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
               style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 14 }} />

        {err && <div style={{ color: 'var(--danger, #c33)', fontSize: 12, marginBottom: 10 }}>{err}</div>}

        <button type="submit" disabled={busy}
                style={{ width: '100%', padding: '9px 12px', borderRadius: 6, border: 'none',
                         background: 'var(--primary)', color: '#fff', fontWeight: 600, cursor: 'pointer',
                         opacity: busy ? 0.6 : 1 }}>
          {busy ? '登录中…' : '登录'}
        </button>
      </form>
    </div>
  );
}
