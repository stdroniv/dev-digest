/* AgentFindingMini — one finding in an agent's Columns-view column
   (design `8bb91114`:3-10). Severity icon + 2px left border in the SEV colour +
   title + mono `file:start_line` (AC-20). Display-only over foreign finding text
   (data, never instructions — SPEC-05 Untrusted inputs).

   The title row is an in-app deep link to this finding's card on the PR
   overview's "Agent runs" tab (same `#finding-<id>` mechanism the PR list's
   findings hover card uses); the file:line is a SEPARATE link to the real file
   on GitHub — kept a sibling, never nested inside the title link (nested
   anchors are invalid HTML). Both fall back to plain (non-clickable) text
   until the owning repo/PR is resolved. */
"use client";

import React from "react";
import Link from "next/link";
import { Icon, SEV, MonoLink } from "@devdigest/ui";
import type { AgentColumnFinding } from "@devdigest/shared";

import { s } from "./styles";

export function AgentFindingMini({
  finding,
  findingHref,
  fileHref,
}: {
  finding: AgentColumnFinding;
  /** In-app link to this finding's card (PR overview → Agent runs tab). */
  findingHref?: string;
  /** github.com blob link for `finding.file` at `finding.start_line`. */
  fileHref?: string;
}) {
  const sev = SEV[finding.severity];
  const SevIcon = Icon[sev.icon];
  const titleRow = (
    <div style={s.findingTop}>
      <SevIcon size={12} style={{ color: sev.c, flexShrink: 0 }} />
      <span style={s.findingTitle}>{finding.title}</span>
    </div>
  );
  return (
    <div style={s.finding(sev.c)}>
      {findingHref ? (
        <Link href={findingHref} style={s.findingLink}>
          {titleRow}
        </Link>
      ) : (
        titleRow
      )}
      <div className="mono" style={s.findingLoc} title={`${finding.file}:${finding.start_line}`}>
        {fileHref ? (
          <MonoLink href={fileHref}>
            {finding.file}:{finding.start_line}
          </MonoLink>
        ) : (
          `${finding.file}:${finding.start_line}`
        )}
      </div>
    </div>
  );
}
