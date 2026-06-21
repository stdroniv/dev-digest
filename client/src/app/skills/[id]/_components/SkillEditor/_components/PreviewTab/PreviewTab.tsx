/* Skill Preview tab — renders the body the way the reviewing agent receives it.
   Imported/untrusted skills show a vetting notice (the body is stored as data). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Markdown, Icon } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";

export function PreviewTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const untrusted = skill.source !== "manual";

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{t("preview.heading")}</h2>
        <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>{t("preview.renderedAs")}</p>
      </div>

      {untrusted && (
        <div
          role="note"
          style={{
            display: "flex",
            gap: 10,
            padding: "10px 12px",
            marginBottom: 16,
            borderRadius: 8,
            border: "1px solid var(--warn)",
            background: "var(--bg-hover)",
            fontSize: 12.5,
            color: "var(--text-secondary)",
            lineHeight: 1.5,
          }}
        >
          <Icon.AlertTriangle size={16} style={{ color: "var(--warn)", flexShrink: 0, marginTop: 1 }} />
          <span>{t("preview.untrustedNotice")}</span>
        </div>
      )}

      <div
        style={{
          padding: "20px 24px",
          borderRadius: 12,
          border: "1px solid var(--border)",
          background: "var(--bg-elevated)",
          fontSize: 14,
        }}
      >
        <Markdown>{skill.body}</Markdown>
      </div>
    </div>
  );
}
