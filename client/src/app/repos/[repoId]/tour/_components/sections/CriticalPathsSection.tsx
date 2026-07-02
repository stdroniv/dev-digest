/* CriticalPathsSection — SPEC-02 AC-9/AC-16/17: ranked list of the repo's most
   important files, each citing a real repo-relative path + a one-line
   why-it-matters. The path is untrusted model output — rendered as plain text,
   never dangerouslySetInnerHTML. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import type { CriticalPathsContent } from "@devdigest/shared";
import { openOrCopyCited } from "../affordances";
import { s } from "./styles";

export function CriticalPathsSection({
  content,
  githubUrl,
}: {
  content: CriticalPathsContent;
  githubUrl: string | null;
}) {
  const t = useTranslations("tour");
  return (
    <div>
      {content.rows.map((row, i) => (
        <div key={`${row.path}-${i}`} style={{ ...s.row, ...(i === content.rows.length - 1 ? s.rowLast : {}) }}>
          <div style={s.rowMain}>
            <span className="mono" style={s.path}>
              {row.path}
            </span>
            <span style={s.why}>— {row.why}</span>
          </div>
          <Button kind="ghost" size="sm" onClick={() => openOrCopyCited(row.path, githubUrl)}>
            {t("sections.criticalPaths.open")}
          </Button>
        </div>
      ))}
    </div>
  );
}
