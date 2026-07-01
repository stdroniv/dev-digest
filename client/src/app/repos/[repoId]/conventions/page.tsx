/* Route: /repos/:repoId/conventions — Conventions Extractor. Thin entry; the
   scan/list/accept-reject/create-skill flow lives in ConventionsWorkspace.
   Also the chosen navigation entry point into the Project Context screen
   (SPEC-01 Q3 — no edit to the vendored sidebar nav for that screen): a slim
   link bar above the workspace, since ConventionsWorkspace itself owns its
   AppShell/breadcrumb and is out of scope for this change. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { ConventionsWorkspace } from "./_components/ConventionsWorkspace";

export default function ConventionsPage() {
  const params = useParams<{ repoId: string }>();
  const t = useTranslations("context");
  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          padding: "6px 32px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-surface)",
        }}
      >
        <Link
          href={`/repos/${params.repoId}/context`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12.5,
            fontWeight: 500,
            color: "var(--text-secondary)",
            textDecoration: "none",
          }}
        >
          <Icon.FileText size={13} />
          {t("conventionsLink")}
        </Link>
      </div>
      <ConventionsWorkspace repoId={params.repoId} />
    </>
  );
}
