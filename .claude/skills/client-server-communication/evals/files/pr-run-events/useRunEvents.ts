import { useEffect, useState } from 'react';
import { API_BASE } from '../api.js';

export interface RunEvent {
  type: string;
  message: string;
  timestamp: string;
}

// Subscribes to a run's live event feed for as long as the panel is open.
export function useRunEvents(workspaceId: string, runId: string) {
  const [events, setEvents] = useState<RunEvent[]>([]);

  useEffect(() => {
    const es = new EventSource(`${API_BASE}/workspaces/${workspaceId}/runs/${runId}/events`);

    es.onmessage = (e) => {
      const event = JSON.parse(e.data) as RunEvent;
      setEvents((prev) => [...prev, event]);
    };

    return () => es.close();
  }, [workspaceId, runId]);

  return events;
}
