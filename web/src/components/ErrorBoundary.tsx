import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconAlertTriangle } from './Icons';

// React error boundaries can only be class components — there's no Hook
// equivalent for componentDidCatch. We keep the class lean and delegate the
// presentation to a function component that has access to i18n.
interface Props {
  children: ReactNode;
  // Optional override for the rendered fallback. Receives the captured error
  // and a `reset` callback that clears the boundary's error state so the
  // children try to mount again. When omitted, DefaultFallback is used.
  fallback?: (error: Error, reset: () => void) => ReactNode;
  // Called once for each error caught by this boundary. Hook for analytics
  // / Sentry / etc. — kept synchronous because React calls componentDidCatch
  // synchronously during commit.
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface the error in the dev console regardless of whether the host
    // app wired up an onError sink — losing the stack trace makes triage
    // miserable. In production this still hits the user's browser console.
    console.error('[ErrorBoundary] caught render error:', error, info);
    this.props.onError?.(error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }
      return <DefaultFallback error={this.state.error} reset={this.reset} />;
    }
    return this.props.children;
  }
}

function DefaultFallback({ error, reset }: { error: Error; reset: () => void }) {
  const { t } = useTranslation();

  // Show details only in dev. In production we still ship them inside a
  // collapsed <details> block so users can copy the message into a bug
  // report, but we don't expand by default.
  const isDev = import.meta.env.DEV;

  return (
    <div
      role="alert"
      style={{
        minHeight: '60vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
      }}
    >
      <div
        style={{
          width: 480,
          maxWidth: '92vw',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 24,
          boxShadow: '0 12px 36px rgba(15,23,42,0.12)',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'var(--red-bg)',
              color: 'var(--red-text)',
              flexShrink: 0,
            }}
          >
            <IconAlertTriangle size={17} />
          </span>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            {t('errorBoundary.title')}
          </h2>
        </div>
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
          {t('errorBoundary.description')}
        </p>
        <details
          open={isDev}
          style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            background: 'var(--bg-subtle)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '8px 10px',
          }}
        >
          <summary style={{ cursor: 'pointer', userSelect: 'none' }}>
            {t('errorBoundary.details')}
          </summary>
          <pre
            style={{
              margin: '8px 0 0',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: 'var(--font-mono, ui-monospace, monospace)',
              fontSize: 11.5,
              lineHeight: 1.5,
            }}
          >
            {error.message}
            {isDev && error.stack ? '\n\n' + error.stack : ''}
          </pre>
        </details>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn"
            onClick={() => {
              window.location.assign('/');
            }}
          >
            {t('errorBoundary.goHome')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => window.location.reload()}
          >
            {t('errorBoundary.reload')}
          </button>
          <button type="button" className="btn primary" onClick={reset}>
            {t('errorBoundary.retry')}
          </button>
        </div>
      </div>
    </div>
  );
}
