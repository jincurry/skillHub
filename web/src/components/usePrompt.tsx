import { useCallback, useRef, useState } from 'react';
import { PromptDialog, type PromptDialogProps } from './PromptDialog';

// Promise-based replacement for window.prompt. Pair the hook output with
// the JSX element it returns:
//
//   const [prompt, promptEl] = usePrompt();
//   const reason = await prompt({ title: 'Yank reason', required: true, ... });
//   if (reason === null) return; // user cancelled
//   ...
//   return <>{rest} {promptEl}</>;
//
// Resolves to the entered string (possibly empty if `required` is false),
// or `null` if the user cancelled / pressed Esc / clicked the overlay.
// Calling prompt() while another is open immediately resolves the previous
// one as cancelled — matches the implicit contract of window.prompt.

type PromptOptions = Omit<PromptDialogProps, 'open' | 'onConfirm' | 'onCancel' | 'busy'>;

export function usePrompt(): [
  (opts: PromptOptions) => Promise<string | null>,
  React.ReactNode,
] {
  const [state, setState] = useState<(PromptOptions & { open: boolean }) | null>(null);
  const resolverRef = useRef<((v: string | null) => void) | null>(null);

  const prompt = useCallback((opts: PromptOptions) => {
    resolverRef.current?.(null);
    return new Promise<string | null>((resolve) => {
      resolverRef.current = resolve;
      setState({ ...opts, open: true });
    });
  }, []);

  const close = useCallback((result: string | null) => {
    const r = resolverRef.current;
    resolverRef.current = null;
    setState((s) => (s ? { ...s, open: false } : s));
    r?.(result);
  }, []);

  const element = state ? (
    <PromptDialog
      {...state}
      onConfirm={(v) => close(v)}
      onCancel={() => close(null)}
    />
  ) : null;

  return [prompt, element];
}
