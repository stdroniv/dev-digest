'use client';

type Props = {
  repoId: string;
  onAcknowledge: () => void;
};

export async function FindingActions({ repoId, onAcknowledge }: Props) {
  return (
    <div>
      <button onClick={onAcknowledge}>Acknowledge</button>
      <span>{repoId}</span>
    </div>
  );
}
