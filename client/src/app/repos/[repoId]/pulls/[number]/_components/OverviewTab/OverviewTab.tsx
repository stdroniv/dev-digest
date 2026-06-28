"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { IntentCard } from "../IntentCard";
import { RisksCard } from "../RisksCard";
import { BlastRadius } from "../BlastRadius";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null | undefined;
  repoFullName: string | null | undefined;
}

export function OverviewTab({ prBody, prId, repoFullName }: OverviewTabProps) {
  return (
    <>
      <IntentCard prId={prId} />
      <RisksCard prId={prId} />
      <BlastRadius prId={prId} repoFullName={repoFullName} />

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
