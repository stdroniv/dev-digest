import { useFindings } from './useFindings';

export interface FindingsListProps {
  workspaceId: string;
  prId: string;
}

export function FindingsList({ workspaceId, prId }: FindingsListProps) {
  const { findings, isLoading, error } = useFindings(workspaceId, prId);

  if (isLoading) {
    return <p role="status">Loading findings…</p>;
  }

  if (error) {
    return <p role="alert">Could not load findings</p>;
  }

  if (findings.length === 0) {
    return <p data-testid="findings-empty">No findings — this PR looks clean.</p>;
  }

  return (
    <ul aria-label="findings">
      {findings.map((f) => (
        <li key={f.id}>
          <span>{f.severity}</span>
          <span>{f.title}</span>
        </li>
      ))}
    </ul>
  );
}
