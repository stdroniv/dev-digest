"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { CiRun } from "@devdigest/shared";
import { s } from "./styles";
import { CiRunRow } from "./CiRunRow";

/** The CI Runs table body: header row (AC-35's 9 columns) + one `CiRunRow`
 *  per ingested run. The last column (Trace) has no header label, matching
 *  the design (N13). */
export function CiRunsTable({ runs }: { runs: CiRun[] }) {
  const t = useTranslations("ci");
  const headers = [
    t("runs.table.timestamp"),
    t("runs.table.pullRequest"),
    t("runs.table.agent"),
    t("runs.table.source"),
    t("runs.table.duration"),
    t("runs.table.findings"),
    t("runs.table.cost"),
    t("runs.table.status"),
    "",
  ];

  return (
    <>
      <div style={s.headRow}>
        {headers.map((h, i) => (
          <div key={i}>{h}</div>
        ))}
      </div>
      {runs.map((run, i) => (
        <CiRunRow key={run.id} run={run} last={i === runs.length - 1} />
      ))}
    </>
  );
}
