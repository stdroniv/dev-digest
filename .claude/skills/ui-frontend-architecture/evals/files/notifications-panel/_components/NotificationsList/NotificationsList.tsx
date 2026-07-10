// Conceptual path:
// client/src/app/notifications/_components/NotificationsList/NotificationsList.tsx

import { useEffect, useState } from 'react';
import type { Notification } from './types';
import { useFormatTimestamp } from './notification-helpers';

export function NotificationsList({ notifications }: { notifications: Notification[] }) {
  const [archived, setArchived] = useState<Record<string, boolean>>({});
  const formatTimestamp = useFormatTimestamp();

  // Fetches archived-state overrides directly from the API, bypassing the
  // shared lib/hooks -> lib/api.ts data layer this repo standardizes on.
  useEffect(() => {
    fetch('/api/notifications/archived-overrides')
      .then((res) => res.json())
      .then((overrides: Record<string, boolean>) => setArchived(overrides));
  }, []);

  // Business logic (filtering + sorting) computed inline in the component
  // body/JSX instead of living in a util or being memoized in a hook.
  const visible = notifications
    .filter((n) => !archived[n.id])
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <ul>
      {visible.map((n) => (
        <li key={n.id}>
          <strong>{n.title}</strong>
          <span>{formatTimestamp(n.createdAt)}</span>
          {!n.read && <em>new</em>}
        </li>
      ))}
    </ul>
  );
}
