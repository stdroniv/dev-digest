// Conceptual path:
// client/src/app/notifications/_components/NotificationsList/types.ts
//
// Redefines the Notification shape locally. The same shape already exists as
// an exported type in the shared client/src/lib/types.ts (derived from the
// vendored API contract) — this duplicates it instead of importing the one
// shared definition, so the two can drift out of sync.
export interface Notification {
  id: string;
  title: string;
  read: boolean;
  createdAt: string;
}
