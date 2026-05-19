import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { IconBell } from './Icons';
import { fmtRelative, notifTargetUrl } from '../lib/notify';
import {
  markAllReadOptimistic, markOneReadOptimistic, reloadNotifications, useNotifStore,
} from '../lib/notifStore';
import type { Notification } from '../api/types';

const KIND_COLOR: Record<string, string> = {
  review: 'var(--amber)',
  comment: 'var(--primary)',
  publish: 'var(--green)',
  warn: 'var(--red)',
  rating: 'var(--violet, var(--primary))',
};

export function NotificationBell() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Shared notification state — the bell, the sidebar badge and the
  // Workspace feed all read from this single source.
  const { items, loading } = useNotifStore();
  const unreadCount = items.reduce((n, x) => n + (x.unread ? 1 : 0), 0);

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
    // Opening the popover refreshes immediately so the user doesn't see
    // stale data between polls.
    if (!open) await reloadNotifications();
  }

  async function markAllRead() {
    await markAllReadOptimistic();
  }

  async function clickItem(n: Notification) {
    if (n.unread) void markOneReadOptimistic(n.id);
    setOpen(false);
    const url = notifTargetUrl(n);
    if (url) navigate(url);
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="icon-btn" title={t('notifications.title')} onClick={toggle} aria-label={t('notifications.iconAriaLabel')}>
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
            <span style={{ fontSize: 13, fontWeight: 600 }}>{t('notifications.title')}</span>
            <button
              onClick={markAllRead}
              disabled={unreadCount === 0}
              style={{
                border: 'none', background: 'transparent', cursor: unreadCount ? 'pointer' : 'default',
                color: unreadCount ? 'var(--primary)' : 'var(--text-faint)', fontSize: 12,
              }}
            >{t('notifications.markAllRead')}</button>
          </div>
          {loading && <div style={{ padding: 14, fontSize: 12, color: 'var(--text-subtle)' }}>{t('common.loading')}</div>}
          {!loading && items.length === 0 && (
            <div style={{ padding: 24, fontSize: 13, color: 'var(--text-subtle)', textAlign: 'center' }}>
              {t('notifications.empty')}
            </div>
          )}
          {[...items]
            .sort((a, b) => {
              if (a.unread !== b.unread) return a.unread ? -1 : 1;
              return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            })
            .map((n) => {
              const url = notifTargetUrl(n);
              return (
                <div
                  key={n.id}
                  onClick={() => clickItem(n)}
                  title={url ? t('notifications.openHint', { url }) : undefined}
                  style={{
                    padding: '10px 14px', borderBottom: '1px solid var(--border)',
                    cursor: url ? 'pointer' : 'default',
                    background: n.unread ? 'rgba(79,70,229,0.04)' : 'transparent',
                    display: 'flex', gap: 10, alignItems: 'flex-start',
                    position: 'relative', transition: 'background 0.12s',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = n.unread ? 'rgba(79,70,229,0.04)' : 'transparent'; }}
                >
                  {n.unread && (
                    <span style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, background: KIND_COLOR[n.kind] ?? 'var(--primary)', borderRadius: '0 2px 2px 0' }} />
                  )}
                  <div style={{
                    width: 8, height: 8, marginTop: 6, borderRadius: 4,
                    background: KIND_COLOR[n.kind] ?? 'var(--text-faint)',
                    flexShrink: 0,
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--text)', wordBreak: 'break-word', fontWeight: n.unread ? 600 : 400 }}>
                      {n.body}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }} title={new Date(n.createdAt).toLocaleString()}>
                      {fmtRelative(n.createdAt)}
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
