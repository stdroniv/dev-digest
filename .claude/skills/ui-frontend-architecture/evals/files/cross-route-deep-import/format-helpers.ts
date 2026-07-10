// Conceptual path: client/src/lib/format-helpers.ts
//
// Shared, app-wide formatting helpers — meant to be safely importable from
// any route or component in the app.

import { formatDistanceToNow } from 'date-fns';
// Shared lib code reaching down into one route's private feature internals
// to reuse a color-mapping hook. This inverts the dependency rule: shared
// code must not know about features/routes.
import { useAgentStatusColor } from '@/app/agents/_components/AgentStatusBadge/useAgentStatusColor';

export function formatRelativeTime(iso: string): string {
  return formatDistanceToNow(new Date(iso), { addSuffix: true });
}

export function useStatusColorForDisplay(status: string): string {
  return useAgentStatusColor(status);
}
