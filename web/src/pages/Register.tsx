import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { getToken, setStoredUser, setToken } from '../api/auth';
import { useLocaleText } from '../i18n/useLocaleText';

export function Register() {
  const nav = useNavigate();
  const { text } = useLocaleText();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [display, setDisplay] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (getToken()) {
    return <Navigate to="/workspace" replace />;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setErr(text('Passwords do not match', '两次输入的密码不一致'));
      return;
    }
    if (password.length < 6) {
      setErr(text('Password must be at least 6 characters', '密码至少 6 位'));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await api.register({
        username: username.trim(),
        password,
        display: display.trim(),
        email: email.trim(),
      });
      setToken(res.token);
      setStoredUser(res.user);
      nav('/workspace', { replace: true });
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
        <h2 style={{ margin: '0 0 6px', fontSize: 18 }}>{text('Register', '注册')}</h2>
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 18 }}>
          {text('The first registered user becomes an admin automatically.', '首位注册用户将自动成为管理员。')}
        </div>

        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{text('Username', '用户名')}</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required minLength={2} maxLength={32}
               style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 12 }} />

        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{text('Display Name (optional)', '显示名（可选）')}</label>
        <input value={display} onChange={(e) => setDisplay(e.target.value)} maxLength={80}
               style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 12 }} />

        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{text('Email (optional)', '邮箱（可选）')}</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200}
               style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 12 }} />

        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{text('Password (at least 6 characters)', '密码（至少 6 位）')}</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6}
               style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 12 }} />

        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{text('Confirm Password', '确认密码')}</label>
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={6}
               style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 14 }} />

        {err && <div style={{ color: 'var(--danger, #c33)', fontSize: 12, marginBottom: 10 }}>{err}</div>}

        <button type="submit" disabled={busy}
                style={{ width: '100%', padding: '9px 12px', borderRadius: 6, border: 'none',
                         background: 'var(--primary)', color: '#fff', fontWeight: 600, cursor: 'pointer',
                         opacity: busy ? 0.6 : 1 }}>
          {busy ? text('Registering...', '注册中…') : text('Register', '注册')}
        </button>

        <div style={{ marginTop: 14, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
          {text('Already have an account? ', '已有账号？')}<Link to="/login" style={{ color: 'var(--primary)' }}>{text('Log in', '去登录')}</Link>
        </div>
      </form>
    </div>
  );
}
