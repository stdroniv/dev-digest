import { memo } from 'react';
import type { ActivityEvent } from '../../lib/activity-bus';

interface ActivityListProps {
  events: ActivityEvent[];
}

function ActivityListImpl({ events }: ActivityListProps) {
  return (
    <ul className="space-y-1">
      {events.map((event) => (
        <li key={event.id} className="text-xs">
          <span className="font-medium">{event.type}</span> — {event.message}
        </li>
      ))}
    </ul>
  );
}

export const ActivityList = memo(ActivityListImpl);
