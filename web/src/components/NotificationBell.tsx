import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconBell } from './Icons';
import { api } from '../api/client';
import type { Notification } from '../api/types';

const KIND_COLOR: Record<string, string> = {
  review: 'var(--amber)',
  comment: 'var(--primary)',
  publish: 'var(--green)',
  warn: 'var(--red)',
  rating: 'var(--violet, var(--primary))',
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const unreadCount = items.filter((n) => n.unread).length;

  async function load() {
    setLoading(true);
    try {
      setItems((await api.myNotifications()) ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  async function toggle() {
    setOpen((v) => !v);
    if (!open) await load();
  }

  async function markAllRead() {
    if (unreadCount === 0) return;
    await api.markNotificationsRead({ all: true });
    setItems((arr) => arr.map((n) => ({ ...n, unread: false })));
  }

  async function clickItem(n: Notification) {
    if (n.unread) {
      await api.markNotificationsRead({ ids: [n.id] });
      setItems((arr) => arr.map((x) => (x.id === n.id ? { ...x, unread: false } : x)));
    }
    setOpen(false);
    if (n.kind === 'review') navigate('/reviews');
    else if (n.kind === 'comment' || n.kind === 'publish') navigate('/workspace');
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="icon-btn" title="通知" onClick={toggle} aria-label="通知">
        <IconBell size={18} />
        {unreadCount > 0 && (
          <span
            className="dot"
            style={{
              background: 'var(--red)',
              color: '#fff',
              minWidth: 14,
              height: 14,
              borderRadius: 7,
              fontSize: 9,
              fontWeight: 700,
              padding: '0 3px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0,
            width: 360, maxHeight: 480, overflow: 'auto',
            background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 8, boxShadow: '0 12px 32px rgba(0,0,0,.12)',
            zIndex: 50,
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', borderBottom: '1px solid var(--border)',
            background: 'var(--bg)',
            position: 'sticky', top: 0, zIndex: 1,
          }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>通知</span>
            <button
              onClick={markAllRead}
              disabled={unreadCount === 0}
              style={{
                border: 'none', background: 'transparent', cursor: unreadCount ? 'pointer' : 'default',
                color: unreadCount ? 'var(--primary)' : 'var(--text-faint)', fontSize: 12,
              }}
            >全部已读</button>
          </div>
          {loading && <div style={{ padding: 14, fontSize: 12, color: 'var(--text-subtle)' }}>加载中...</div>}
          {!loading && items.length === 0 && (
            <div style={{ padding: 24, fontSize: 13, color: 'var(--text-subtle)', textAlign: 'center' }}>
              暂无通知
            </div>
          )}
          {items.map((n) => (
            <div
              key={n.id}
              onClick={() => clickItem(n)}
              style={{
                padding: '10px 14px', borderBottom: '1px solid var(--border)',
                cursor: 'pointer',
                background: n.unread ? 'var(--bg-muted, transparent)' : 'transparent',
                display: 'flex', gap: 10, alignItems: 'flex-start',
              }}
            >
              <div style={{
                width: 8, height: 8, marginTop: 6, borderRadius: 4,
                background: KIND_COLOR[n.kind] ?? 'var(--text-faint)',
                flexShrink: 0,
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--text)', wordBreak: 'break-word' }}>
                  {n.body}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                  {new Date(n.createdAt).toLocaleString()}
                </div>
              </div>
              {n.unread && (
                <span style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--primary)', marginTop: 6, flexShrink: 0 }} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
