// Tiny global toast store. Call sites push messages without needing to
// thread a hook through every component:
//
//   import { toast } from '../lib/toast';
//   toast.error('Save failed: ' + err.message);
//   toast.success('Webhook deleted');
//
// The <ToastHost /> mounted at the app root subscribes and renders the
// stack. Toasts auto-dismiss after `defaultTtl` ms; pass { ttl: 0 } to
// keep one open until the user clicks the close button.

export type ToastTone = 'info' | 'success' | 'error' | 'warn';

export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
  ttl: number;
}

type Listener = (toasts: Toast[]) => void;

const listeners = new Set<Listener>();
let toasts: Toast[] = [];
let nextId = 1;
const defaultTtl = 4000;

function emit() {
  for (const l of listeners) l(toasts);
}

function push(tone: ToastTone, message: string, ttl?: number): number {
  const id = nextId++;
  const item: Toast = { id, tone, message, ttl: ttl ?? defaultTtl };
  toasts = [...toasts, item];
  emit();
  if (item.ttl > 0) {
    window.setTimeout(() => dismiss(id), item.ttl);
  }
  return id;
}

function dismiss(id: number) {
  const next = toasts.filter((t) => t.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  // Push current state immediately so the host renders existing toasts
  // when it (re)mounts.
  listener(toasts);
  return () => { listeners.delete(listener); };
}

export const toast = {
  info: (message: string, ttl?: number) => push('info', message, ttl),
  success: (message: string, ttl?: number) => push('success', message, ttl),
  warn: (message: string, ttl?: number) => push('warn', message, ttl),
  error: (message: string, ttl?: number) => push('error', message, ttl ?? 6000),
  dismiss,
};
