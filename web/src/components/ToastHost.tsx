import { useEffect, useState } from 'react';
import { IconCheck, IconAlertTriangle, IconXCircle, IconX } from './Icons';
import { subscribeToasts, toast as toastApi, type Toast } from '../lib/toast';

// Mounts once at the app root and subscribes to the global toast store.
// Renders a stack in the bottom-right corner; clicking a toast or its ×
// button dismisses it manually.

const toneColor: Record<Toast['tone'], { fg: string; bg: string; border: string }> = {
  info: {
    fg: 'var(--text)',
    bg: 'var(--bg-elevated, var(--bg))',
    border: 'var(--border)',
  },
  success: {
    fg: 'var(--green-text, #16a34a)',
    bg: 'var(--green-bg, #ecfdf5)',
    border: 'var(--green-text, #16a34a)',
  },
  warn: {
    fg: 'var(--amber-text, #b45309)',
    bg: 'var(--amber-bg, #fef3c7)',
    border: 'var(--amber-text, #b45309)',
  },
  error: {
    fg: 'var(--red-text, #dc2626)',
    bg: 'var(--red-bg, #fef2f2)',
    border: 'var(--red-text, #dc2626)',
  },
};

function Glyph({ tone }: { tone: Toast['tone'] }) {
  if (tone === 'success') return <IconCheck size={15} />;
  if (tone === 'warn') return <IconAlertTriangle size={15} />;
  if (tone === 'error') return <IconXCircle size={15} />;
  return null;
}

export function ToastHost() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => subscribeToasts(setItems), []);

  if (items.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 1500,
        display: 'flex',
        flexDirection: 'column-reverse',
        gap: 8,
        maxWidth: 'min(420px, calc(100vw - 32px))',
      }}
      role="region"
      aria-label="Notifications"
    >
      {items.map((t) => {
        const c = toneColor[t.tone];
        return (
          <div
            key={t.id}
            role="status"
            aria-live={t.tone === 'error' ? 'assertive' : 'polite'}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '10px 12px',
              borderRadius: 8,
              border: `1px solid ${c.border}`,
              borderLeft: `3px solid ${c.border}`,
              background: c.bg,
              color: c.fg,
              fontSize: 13,
              lineHeight: 1.45,
              boxShadow: '0 8px 24px rgba(15,23,42,0.18)',
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: 1,
                flexShrink: 0,
              }}
            >
              <Glyph tone={t.tone} />
            </span>
            <span style={{ flex: 1, wordBreak: 'break-word', color: 'var(--text)' }}>
              {t.message}
            </span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => toastApi.dismiss(t.id)}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: 2,
                color: 'var(--text-faint)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <IconX size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
