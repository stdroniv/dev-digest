import { SectionLabel } from "@devdigest/ui";
import type { FindingRecord, RunSummary, PrCommit } from "@devdigest/shared";
import { RunHistory } from "../../../RunHistory/RunHistory";
import { s } from "./styles";

interface TimelineSectionProps {
  runs: RunSummary[] | undefined;
  commits: PrCommit[];
  findingsByRun: Map<string, FindingRecord[]>;
  onOpenTrace: (id: string) => void;
  onGoToReview: (runId: string) => void;
  onDelete: (id: string) => void;
}

/** Merged runs + commits timeline. Renders nothing when there is neither. */
export function TimelineSection({
  runs,
  commits,
  findingsByRun,
  onOpenTrace,
  onGoToReview,
  onDelete,
}: TimelineSectionProps) {
  if ((!runs || runs.length === 0) && commits.length === 0) return null;
  return (
    <div style={s.timelineSection}>
      <SectionLabel
        icon="Activity"
        right={<span style={{ fontSize: 12, color: "var(--text-muted)" }}>runs &amp; commits · newest first</span>}
      >
        Timeline
      </SectionLabel>
      <RunHistory
        runs={runs ?? []}
        commits={commits}
        findingsByRun={findingsByRun}
        onOpenTrace={onOpenTrace}
        onGoToReview={onGoToReview}
        onDelete={onDelete}
      />
    </div>
  );
}
