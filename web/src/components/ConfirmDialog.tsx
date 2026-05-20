import { useEffect, useRef } from 'react';
import { IconAlertTriangle } from './Icons';

// Styled replacement for window.confirm that matches the rest of the modal
// shells (New File dialog, ModalShell, etc.) — overlay + bordered card with
// header / body / footer rows. Pair with useConfirm() for an ergonomic
// Promise-based call site.

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  // Single-line summary; rendered as the first paragraph in the body.
  message: string;
  // Optional secondary line — useful for "this can't be undone" hints.
  detail?: string;
  confirmLabel: string;
  cancelLabel: string;
  // Visual weight of the confirm button. `danger` paints it red and is the
  // right pick for destructive actions (delete, discard).
  tone?: 'primary' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open, title, message, detail,
  confirmLabel, cancelLabel,
  tone = 'primary', busy = false,
  onConfirm, onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Auto-focus the confirm button when the dialog opens so Enter / Space
  // immediately triggers the action — same ergonomics as window.confirm.
  useEffect(() => {
    if (open) confirmRef.current?.focus();
  }, [open]);

  // Keyboard shortcuts: Esc cancels, Enter confirms.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!busy) onCancel();
      } else if (e.key === 'Enter' && !busy) {
        e.preventDefault();
        onConfirm();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel, onConfirm]);

  if (!open) return null;

  const confirmClass = tone === 'danger' ? 'btn danger' : 'btn primary';

  return (
    <div
      onClick={() => { if (!busy) onCancel(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg)', borderRadius: 10, width: 440, maxWidth: '92vw',
          boxShadow: '0 20px 50px rgba(15,23,42,0.25)', border: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          {tone === 'danger' && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28, borderRadius: '50%',
              background: 'var(--red-bg)', color: 'var(--red-text)', flexShrink: 0,
            }}>
              <IconAlertTriangle size={15} />
            </span>
          )}
          <h3 id="confirm-dialog-title" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{title}</h3>
        </div>
        <div style={{ padding: 18, fontSize: 13.5, color: 'var(--text)', lineHeight: 1.55, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ wordBreak: 'break-word' }}>{message}</div>
          {detail && <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{detail}</div>}
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
          <button
            ref={confirmRef}
            type="button"
            className={confirmClass}
            onClick={onConfirm}
            disabled={busy}
          >{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
