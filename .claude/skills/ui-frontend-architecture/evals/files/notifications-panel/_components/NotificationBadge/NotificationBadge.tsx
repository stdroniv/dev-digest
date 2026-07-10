// Conceptual path:
// client/src/app/notifications/_components/NotificationBadge/NotificationBadge.tsx
//
// Correctly organized: presentational component, no inline fetch, no
// inline business logic — derives its display value from a shared data
// hook. This file is intentionally correct and should NOT be flagged.

import { useUnreadCount } from '@/lib/hooks/notifications';

export function NotificationBadge() {
  const { data: unreadCount } = useUnreadCount();

  if (!unreadCount) return null;

  return <span aria-label={`${unreadCount} unread notifications`}>{unreadCount}</span>;
}
