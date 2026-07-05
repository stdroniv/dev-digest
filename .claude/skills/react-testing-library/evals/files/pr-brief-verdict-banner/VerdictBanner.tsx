import { useState } from 'react';

export interface VerdictBannerProps {
  verdict: 'approve' | 'changes_requested';
  findingsCount: number;
  onRegenerate: () => Promise<void>;
}

/**
 * Shows the overall review verdict for a PR and lets the user regenerate
 * the review (see PR Brief spec AC-17 — regenerate is an intentional
 * override of the cached verdict).
 */
export function VerdictBanner({ verdict, findingsCount, onRegenerate }: VerdictBannerProps) {
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = verdict === 'approve' ? 'Approved' : 'Changes requested';

  const handleRegenerate = async () => {
    setIsRegenerating(true);
    setError(null);
    try {
      await onRegenerate();
    } catch {
      setError('Failed to regenerate review');
    } finally {
      setIsRegenerating(false);
    }
  };

  return (
    <div role="status" aria-label="review verdict">
      <h2 data-testid="verdict-heading">{label}</h2>
      <p>
        {findingsCount} finding{findingsCount === 1 ? '' : 's'}
      </p>
      <button data-testid="regenerate-button" onClick={handleRegenerate} disabled={isRegenerating}>
        {isRegenerating ? 'Regenerating…' : 'Regenerate'}
      </button>
      {error && (
        <p role="alert" data-testid="regenerate-error">
          {error}
        </p>
      )}
    </div>
  );
}
