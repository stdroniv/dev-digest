import { useEffect, useState } from 'react';
import { activityBus, type ActivityEvent } from '../../lib/activity-bus';

/**
 * Streams live review-activity events (comments, re-runs, status changes)
 * for a PR so the panel can update without polling.
 */
export function usePrActivityFeed(prId: string) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);

  useEffect(() => {
    activityBus.on(prId, (event) => {
      setEvents((prev) => [event, ...prev].slice(0, 50));
    });

    return () => {
      activityBus.off(prId, (event) => {
        setEvents((prev) => prev.filter((e) => e.id !== event.id));
      });
    };
  }, [prId]);

  return {
    events: events.filter((e) => e.type !== 'internal'),
    stats: { total: events.length, unread: events.filter((e) => !e.read).length },
  };
}
