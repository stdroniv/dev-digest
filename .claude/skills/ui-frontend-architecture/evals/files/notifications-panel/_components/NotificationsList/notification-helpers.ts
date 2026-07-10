// Conceptual path:
// client/src/app/notifications/_components/NotificationsList/notification-helpers.ts

// Named like a hook (`use` prefix) but calls no React hooks internally — it's
// a plain, stateless formatting function and should not carry the `use`
// prefix or live in a hooks-shaped module.
export function useFormatTimestamp() {
  return (iso: string) => new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
