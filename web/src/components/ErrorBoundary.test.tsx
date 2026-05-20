import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';
import i18n from '../i18n';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

// A component that throws on render. Used as the boundary's child to trigger
// componentDidCatch deterministically. We can't simply throw inside a hook
// because Testing Library wraps mounts in act() and we'd lose the error.
function Boom({ message = 'kaboom' }: { message?: string }): JSX.Element {
  throw new Error(message);
}

// React intentionally logs the captured error to console.error during test
// runs. Silence it so the suite output stays readable while still asserting
// behaviour. Each test re-installs the spy via vi.spyOn for isolation.
function silenceConsoleError() {
  return vi.spyOn(console, 'error').mockImplementation(() => undefined);
}

describe('ErrorBoundary', () => {
  it('renders children when no error is thrown', () => {
    render(
      <ErrorBoundary>
        <div>healthy content</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('healthy content')).toBeInTheDocument();
  });

  it('renders the default fallback when a child throws', () => {
    const spy = silenceConsoleError();
    render(
      <ErrorBoundary>
        <Boom message="render-time crash" />
      </ErrorBoundary>,
    );
    // The default fallback shows the i18n "Something went wrong" headline and
    // exposes the original error message inside <details>. Use a regex for
    // the message because the <pre> also contains the stack trace in dev
    // mode, which would defeat an exact text match.
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText(/render-time crash/)).toBeInTheDocument();
    spy.mockRestore();
  });

  it('invokes onError with the caught exception', () => {
    const spy = silenceConsoleError();
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <Boom message="track me" />
      </ErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((onError.mock.calls[0][0] as Error).message).toBe('track me');
    spy.mockRestore();
  });

  it('uses a custom fallback when provided', () => {
    const spy = silenceConsoleError();
    render(
      <ErrorBoundary fallback={(err) => <div>custom: {err.message}</div>}>
        <Boom message="oops" />
      </ErrorBoundary>,
    );
    expect(screen.getByText('custom: oops')).toBeInTheDocument();
    spy.mockRestore();
  });

  it('reset() callback clears the error state and re-renders children', () => {
    const spy = silenceConsoleError();

    // Use a stateful child whose throw flag we can flip from outside via a
    // module-level mutable cell. After the boundary's reset clears its
    // captured error, React re-mounts the child tree; we want it to render
    // successfully on the second try.
    let shouldThrow = true;
    function Maybe(): JSX.Element {
      if (shouldThrow) throw new Error('first attempt');
      return <div>second attempt OK</div>;
    }

    render(
      <ErrorBoundary
        fallback={(_err, reset) => (
          <button
            type="button"
            onClick={() => {
              shouldThrow = false;
              reset();
            }}
          >
            retry
          </button>
        )}
      >
        <Maybe />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('button', { name: 'retry' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    expect(screen.getByText('second attempt OK')).toBeInTheDocument();
    spy.mockRestore();
  });
});
