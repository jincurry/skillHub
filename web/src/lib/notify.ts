// Helpers shared by the Workspace feed and the topbar bell. These keep the
// click-through logic and the relative-time formatter in one place so the two
// surfaces can never drift out of sync.

import type { Notification } from '../api/types';

/**
 * Resolve the in-app URL a notification should open, based on its structured
 * target fields. Returns null when the notification has no target (in which
 * case the row should still be clickable to mark-as-read but should not
 * navigate).
 */
export function notifTargetUrl(n: Notification): string | null {
  if (n.targetKind === 'skill' && n.targetRef.includes('/')) {
    return `/skills/${n.targetRef}`;
  }
  if (n.targetKind === 'review' && n.targetRef) {
    return `/reviews/${n.targetRef}`;
  }
  if (n.targetKind === 'audit') {
    return '/audit';
  }
  return null;
}

/**
 * Human-readable "n minutes ago" / "n hours ago" string. Falls back to a
 * locale date for anything older than 30 days.
 */
export function fmtRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t) return '';
  const diffMs = Date.now() - t;
  if (diffMs < 0) return '刚刚';
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(iso).toLocaleDateString();
}

export type NotifFilter = 'all' | 'unread' | 'review' | 'comment';

/** Apply the user's chosen filter chip and sort: unread first, then desc time. */
export function filterAndSort(items: Notification[], filter: NotifFilter): Notification[] {
  const filtered = items.filter((n) => {
    switch (filter) {
      case 'unread':  return n.unread;
      case 'review':  return n.kind === 'review';
      case 'comment': return n.kind === 'comment';
      default:        return true;
    }
  });
  return [...filtered].sort((a, b) => {
    if (a.unread !== b.unread) return a.unread ? -1 : 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}
