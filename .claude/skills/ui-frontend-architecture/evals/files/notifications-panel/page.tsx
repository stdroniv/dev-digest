// Conceptual path: client/src/app/notifications/page.tsx
//
// Thin route entry — fetches via the shared data-fetching hook and delegates
// rendering to colocated _components. This file is intentionally correct;
// it should NOT be flagged.

import { useNotifications } from '@/lib/hooks/notifications';
import { NotificationsList } from './_components/NotificationsList/NotificationsList';
import { NotificationBadge } from './_components/NotificationBadge/NotificationBadge';

export default function NotificationsPage() {
  const { data, isLoading } = useNotifications();

  return (
    <div>
      <header>
        <h1>Notifications</h1>
        <NotificationBadge />
      </header>
      {isLoading ? <p>Loading…</p> : <NotificationsList notifications={data ?? []} />}
    </div>
  );
}
