import { usePrActivityFeed } from './usePrActivityFeed';
import { ActivityList } from './ActivityList';

interface ActivityFeedPanelProps {
  prId: string;
}

export function ActivityFeedPanel({ prId }: ActivityFeedPanelProps) {
  const { events, stats } = usePrActivityFeed(prId);

  return (
    <aside className="w-80 border-l p-3">
      <header className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Activity</h3>
        <span className="text-xs text-neutral-500">{stats.unread} unread</span>
      </header>
      <ActivityList events={events} />
    </aside>
  );
}
