// Helpers shared by the Workspace feed and the topbar bell. These keep the
// click-through logic and the relative-time formatter in one place so the two
// surfaces can never drift out of sync.

import type { Notification } from '../api/types';
import i18n from '../i18n';

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
 * locale date for anything older than 30 days. We use Intl.RelativeTimeFormat
 * driven by the current i18next language so zh-CN gets "5 分钟前" and en gets
 * "5 minutes ago" without us hand-rolling pluralization rules.
 */
export function fmtRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t) return '';
  const diffMs = Date.now() - t;
  const lang = i18n.resolvedLanguage ?? 'zh-CN';
  if (diffMs < 0) return i18n.t('relative.justNow');
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return i18n.t('relative.justNow');
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'always' });
  if (min < 60) return rtf.format(-min, 'minute');
  const hr = Math.floor(min / 60);
  if (hr < 24) return rtf.format(-hr, 'hour');
  const day = Math.floor(hr / 24);
  if (day < 30) return rtf.format(-day, 'day');
  return new Date(iso).toLocaleDateString(lang);
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
