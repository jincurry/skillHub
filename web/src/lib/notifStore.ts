// notifStore is a tiny module-level pub/sub that holds the current user's
// notifications and the polling timer. All consumers (sidebar nav badge,
// topbar bell, Workspace feed) subscribe to the same store via
// useNotifStore(), so marking a single notification read in one surface
// instantly updates every other surface — no prop drilling, no duplicate
// network traffic.
//
// Why not React Context? Context would work but React-routes mount order
// complicates initialisation and the 30s poll has to survive route changes.
// A plain module-level subscription keeps the API trivial and the behavior
// deterministic: the poll starts on first subscribe and stops on last
// unsubscribe.

import { useEffect, useSyncExternalStore } from 'react';
import { api } from '../api/client';
import type { Notification } from '../api/types';

// The reactive state. We snapshot an object rather than a tuple so a new
// reference is emitted each time any field changes (useSyncExternalStore
// uses Object.is).
type State = {
  items: Notification[];
  loading: boolean;
  error: string | null;
  /** ISO timestamp of the last successful fetch, used only for debugging. */
  lastLoadedAt: string | null;
};

let state: State = { items: [], loading: false, error: null, lastLoadedAt: null };
const listeners = new Set<() => void>();
let pollTimer: number | null = null;
let inflight: Promise<void> | null = null;

/** 30s is plenty for a product that's otherwise event-driven. */
const POLL_MS = 30_000;

function emit() {
  listeners.forEach((l) => l());
}

function setState(patch: Partial<State>) {
  const newState = { ...state, ...patch };
  // Only emit if something actually changed
  const itemsChanged = newState.items !== state.items && !itemsEqual(newState.items, state.items);
  if (itemsChanged ||
      newState.loading !== state.loading ||
      newState.error !== state.error ||
      newState.lastLoadedAt !== state.lastLoadedAt) {
    state = newState;
    emit();
  }
}

/** Deep comparison for notification arrays - checks if the content actually changed */
function itemsEqual(a: Notification[], b: Notification[]): boolean {
  if (a.length !== b.length) return false;
  // Compare by ID and unread status
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].unread !== b[i].unread) return false;
  }
  return true;
}

/** Fetch the latest notifications and publish them. Deduped: concurrent
 *  calls await the same in-flight request. */
export async function reloadNotifications(): Promise<void> {
  if (inflight) return inflight;
  setState({ loading: true });
  inflight = (async () => {
    try {
      const items = (await api.myNotifications()) ?? [];
      setState({ items, loading: false, error: null, lastLoadedAt: new Date().toISOString() });
    } catch (e) {
      setState({ loading: false, error: (e as Error).message });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Flip one notification to read, with optimistic update + rollback. */
export async function markOneReadOptimistic(id: number): Promise<void> {
  const prev = state.items;
  setState({ items: prev.map((n) => (n.id === id ? { ...n, unread: false } : n)) });
  try {
    await api.markNotificationsRead({ ids: [id] });
  } catch {
    // Revert on failure. We do a fresh reload instead of restoring `prev`
    // so other in-flight changes aren't overwritten.
    void reloadNotifications();
  }
}

/** Flip all notifications to read, with optimistic update + rollback. */
export async function markAllReadOptimistic(): Promise<void> {
  if (!state.items.some((n) => n.unread)) return;
  const prev = state.items;
  setState({ items: prev.map((n) => ({ ...n, unread: false })) });
  try {
    await api.markNotificationsRead({ all: true });
  } catch {
    void reloadNotifications();
  }
}

// ---------------------------------------------------------------------------
// Subscription + polling
// ---------------------------------------------------------------------------

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  // First subscriber starts the poll; subsequent ones just piggy-back.
  if (listeners.size === 1) {
    void reloadNotifications();
    pollTimer = window.setInterval(() => void reloadNotifications(), POLL_MS);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && pollTimer != null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  };
}

function getSnapshot(): State {
  return state;
}

function getServerSnapshot(): State {
  return state;
}

/** React hook: returns the shared notification state, polling while mounted. */
export function useNotifStore(): State {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** React hook with selector: returns a derived value from the shared state,
 *  only re-renders when the selected value changes. */
export function useNotifSelector<T>(selector: (state: State) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(state),
  );
}

/** Convenience: unread count from the shared store. */
export function useUnreadCount(): number {
  const { items } = useNotifStore();
  return items.reduce((n, x) => n + (x.unread ? 1 : 0), 0);
}

/**
 * Useful when a page mounts after mark-as-read happened on another tab and
 * we want an immediate refresh rather than waiting for the next poll.
 */
export function useRefreshOnFocus(): void {
  useEffect(() => {
    function onFocus() { void reloadNotifications(); }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
}
