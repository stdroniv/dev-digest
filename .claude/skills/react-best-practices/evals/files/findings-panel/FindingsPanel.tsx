import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchFindings } from '../../lib/api/findings';
import { FindingRow } from './FindingRow';
import { trackAnalyticsEvent } from '../../lib/analytics';

interface FindingsPanelProps {
  reviewId: string;
}

type SortOrder = 'severity' | 'file';

function renderSortSummary(count: number, order: SortOrder) {
  return (
    <p className="text-sm text-neutral-500">
      Showing {count} findings, sorted by {order}
    </p>
  );
}

export function FindingsPanel({ reviewId }: FindingsPanelProps) {
  const [sortOrder, setSortOrder] = useState<SortOrder>('severity');
  const [sortedFindings, setSortedFindings] = useState<Array<{ id: string; file: string; severity: string; message: string }>>([]);

  const { data: findings } = useQuery({
    queryKey: ['findings', reviewId],
    queryFn: () => fetchFindings(reviewId),
  });

  // Keep sortedFindings in sync with the fetched findings + current sort order.
  useEffect(() => {
    if (!findings) return;
    const next = [...findings].sort((a, b) => {
      if (sortOrder === 'file') return a.file.localeCompare(b.file);
      const rank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };
      return (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3);
    });
    setSortedFindings(next);
  }, [findings]);

  // Fire an analytics ping whenever the panel is shown for a given sort order.
  useEffect(() => {
    trackAnalyticsEvent('findings_panel_viewed', { reviewId, sortOrder });
  }, [reviewId]);

  return (
    <section className="space-y-2 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Findings</h2>
        <select
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value as SortOrder)}
          className="rounded border px-2 py-1 text-sm"
        >
          <option value="severity">Severity</option>
          <option value="file">File</option>
        </select>
      </div>
      {renderSortSummary(sortedFindings.length, sortOrder)}
      <ul className="divide-y">
        {sortedFindings.map((finding, index) => (
          <FindingRow key={index} finding={finding} />
        ))}
      </ul>
    </section>
  );
}
