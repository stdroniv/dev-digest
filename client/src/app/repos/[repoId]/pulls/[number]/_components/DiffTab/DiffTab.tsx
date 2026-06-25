"use client";

import React from "react";
import { SectionLabel, Button } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { SmartDiffViewer } from "../SmartDiffViewer";
import { usePrComments, useCreatePrComment } from "@/lib/hooks/reviews";
import { notify } from "@/lib/toast";
import type { PrFile } from "@devdigest/shared";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  onNavigateToFinding?: (findingId: string) => void;
}

export function DiffTab({ prId, filesCount, files, canComment, onNavigateToFinding }: DiffTabProps) {
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  const [showComments, setShowComments] = React.useState(false);
  const [orderMode, setOrderMode] = React.useState<"smart" | "original">("smart");

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true);
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  const orderToggle = (
    <div style={{ display: "flex", gap: 4 }}>
      <Button
        kind={orderMode === "smart" ? "secondary" : "ghost"}
        size="sm"
        onClick={() => setOrderMode("smart")}
      >
        Smart order
      </Button>
      <Button
        kind={orderMode === "original" ? "secondary" : "ghost"}
        size="sm"
        onClick={() => setOrderMode("original")}
      >
        Original order
      </Button>
    </div>
  );

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {orderMode === "original" && commentCount > 0 && (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments ? "Hide comments" : "Show comments"} ({commentCount})
              </Button>
            )}
            {orderToggle}
          </div>
        }
      >
        Files changed · {filesCount} files
      </SectionLabel>

      {orderMode === "smart" ? (
        <SmartDiffViewer prId={prId} files={files} hideHeader onNavigateToFinding={onNavigateToFinding} />
      ) : (
        <DiffViewer files={files} commenting={commenting} />
      )}
    </section>
  );
}
