'use client';

import { acknowledgeFinding, dismissFinding } from './actions';

type Props = { findingId: string; repoId: string };

export function FindingAcknowledgeForm({ findingId, repoId }: Props) {
  return (
    <div>
      <form action={acknowledgeFinding.bind(null, findingId)}>
        <button type="submit">Acknowledge</button>
      </form>
      <form action={dismissFinding.bind(null, findingId, repoId)}>
        <button type="submit">Dismiss</button>
      </form>
    </div>
  );
}
