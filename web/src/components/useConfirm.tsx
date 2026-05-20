import { useCallback, useRef, useState } from 'react';
import { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog';

// Promise-based replacement for window.confirm. Pair the hook output with the
// JSX element it returns:
//
//   const [confirm, confirmEl] = useConfirm();
//   if (!await confirm({ title: 'Delete?', message: '...', tone: 'danger' })) return;
//   ...
//   return <>{rest} {confirmEl}</>;
//
// Each call resolves to true (confirm) or false (cancel / Esc / overlay click).
// Calling confirm() while another prompt is open immediately resolves the
// previous one as cancelled — last-call-wins matches the implicit contract of
// window.confirm() and avoids a stuck dialog if a caller races itself.

type ConfirmOptions = Omit<ConfirmDialogProps, 'open' | 'onConfirm' | 'onCancel' | 'busy'>;

export function useConfirm(): [
  (opts: ConfirmOptions) => Promise<boolean>,
  React.ReactNode,
] {
  const [state, setState] = useState<(ConfirmOptions & { open: boolean }) | null>(null);
  const resolverRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    // Resolve any in-flight prompt as cancelled before opening a new one.
    resolverRef.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setState({ ...opts, open: true });
    });
  }, []);

  const close = useCallback((result: boolean) => {
    const r = resolverRef.current;
    resolverRef.current = null;
    setState((s) => (s ? { ...s, open: false } : s));
    r?.(result);
  }, []);

  const element = state ? (
    <ConfirmDialog
      {...state}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  ) : null;

  return [confirm, element];
}
