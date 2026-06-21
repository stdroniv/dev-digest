"use client";

import { useCallback } from "react";
import { Icon, Button, SectionLabel } from "@devdigest/ui";
import type { UseMutationResult } from "@tanstack/react-query";
import { RunStatus } from "../../../RunStatus";
import { s } from "./styles";

interface LiveRunSectionProps {
  liveRunIds: string[];
  reviewRunning: boolean;
  cancelMutation: UseMutationResult<any, any, string, any>;
  onOpenTrace: (id: string) => void;
  onRunDone: () => void;
}

/** Live-review status (with cancel / open-trace actions) plus the
 *  "review in progress" banner shown while agents are running. */
export function LiveRunSection({
  liveRunIds,
  reviewRunning,
  cancelMutation,
  onOpenTrace,
  onRunDone,
}: LiveRunSectionProps) {
  const handleCancelAll = useCallback(() => {
    liveRunIds.forEach((id) => cancelMutation.mutate(id));
  }, [liveRunIds, cancelMutation]);

  const handleOpenFirstTrace = useCallback(() => {
    if (liveRunIds[0]) onOpenTrace(liveRunIds[0]);
  }, [liveRunIds, onOpenTrace]);

  return (
    <>
      {liveRunIds.length > 0 && (
        <div style={s.liveRunSection}>
          <SectionLabel
            icon="Sparkles"
            right={
              <div style={s.cancelActions}>
                <Button
                  kind="danger"
                  size="sm"
                  icon="X"
                  loading={cancelMutation.isPending}
                  onClick={handleCancelAll}
                >
                  Cancel
                </Button>
                <Button kind="ghost" size="sm" icon="FileText" onClick={handleOpenFirstTrace}>
                  Open run trace
                </Button>
              </div>
            }
          >
            Live review
          </SectionLabel>
          <RunStatus runIds={liveRunIds} onDone={onRunDone} />
        </div>
      )}

      {reviewRunning && (
        <div style={s.reviewInProgress}>
          <Icon.RefreshCw size={16} style={{ color: "var(--accent)", animation: "ddspin 1s linear infinite" }} />
          <span style={s.reviewInProgressText}>Review in progress…</span>
          <span style={s.reviewInProgressSub}>
            the agent is analyzing the diff — this can take a while on large PRs.
          </span>
        </div>
      )}
    </>
  );
}
