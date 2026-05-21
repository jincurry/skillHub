import { useEffect, useRef, useState } from 'react';

// Styled replacement for window.prompt. Mirrors ConfirmDialog's overlay /
// header / body / footer shell so the look matches the rest of the modals.
// The body is a textarea (multi-line) by default — most call sites collect
// reasons / notes that benefit from line breaks.

export interface PromptDialogProps {
  open: boolean;
  title: string;
  // Inline label rendered above the textarea.
  message?: string;
  // Optional secondary line below the textarea (e.g. "must be ≥ 8 chars").
  detail?: string;
  placeholder?: string;
  initialValue?: string;
  // When true, the confirm button stays disabled while the textarea is
  // empty / whitespace-only. Used for "yank reason" where the reason is
  // mandatory.
  required?: boolean;
  multiline?: boolean;
  rows?: number;
  confirmLabel: string;
  cancelLabel: string;
  // Visual weight of the confirm button. `danger` paints it red — right
  // pick for destructive actions like yank.
  tone?: 'primary' | 'danger';
  busy?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function PromptDialog({
  open, title, message, detail, placeholder, initialValue = '',
  required = false, multiline = true, rows = 4,
  confirmLabel, cancelLabel,
  tone = 'primary', busy = false,
  onConfirm, onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);

  // Reset the value whenever the dialog reopens. Without this, reusing the
  // hook for a second prompt would surface the previous answer.
  useEffect(() => {
    if (open) {
      setValue(initialValue);
      // Slight delay so the focus lands after the dialog mount transition.
      const t = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [open, initialValue]);

  // Keyboard shortcuts: Esc cancels. Ctrl/Cmd+Enter confirms (single Enter
  // is reserved for line breaks in multi-line mode).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!busy) onCancel();
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !busy) {
        e.preventDefault();
        const v = value.trim();
        if (required && !v) return;
        onConfirm(value);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, value, required, onCancel, onConfirm]);

  if (!open) return null;

  const trimmed = value.trim();
  const canConfirm = !busy && (!required || trimmed.length > 0);
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
      aria-labelledby="prompt-dialog-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg)', borderRadius: 10, width: 480, maxWidth: '94vw',
          boxShadow: '0 20px 50px rgba(15,23,42,0.25)', border: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <h3 id="prompt-dialog-title" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{title}</h3>
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {message && (
            <div style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.5 }}>{message}</div>
          )}
          {multiline ? (
            <textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              rows={rows}
              disabled={busy}
              style={{
                width: '100%', resize: 'vertical', minHeight: 80,
                padding: '8px 10px', fontSize: 13, lineHeight: 1.5,
                border: '1px solid var(--border)', borderRadius: 6,
                background: 'var(--bg)', color: 'var(--text)',
                fontFamily: 'inherit',
              }}
            />
          ) : (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              disabled={busy}
              style={{
                width: '100%', padding: '8px 10px', fontSize: 13,
                border: '1px solid var(--border)', borderRadius: 6,
                background: 'var(--bg)', color: 'var(--text)',
              }}
            />
          )}
          {detail && <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>{detail}</div>}
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
          <button
            type="button"
            className={confirmClass}
            onClick={() => onConfirm(value)}
            disabled={!canConfirm}
          >{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
