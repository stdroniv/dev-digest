/* HowToRunSection — SPEC-02 AC-10: ordered shell-command steps, each
   individually copyable. Copy-only — a suggested command is NEVER executed
   (§Untrusted inputs); commands are model output rendered as plain text. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { HowToRunContent } from "@devdigest/shared";
import { copyCommand } from "../affordances";
import { s } from "./styles";

export function HowToRunSection({ content }: { content: HowToRunContent }) {
  const t = useTranslations("tour");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {content.steps.map((step, i) => (
        <div key={i} style={s.command}>
          <div style={s.commandLine}>
            <span style={{ color: "var(--text-muted)", fontSize: 12, flexShrink: 0 }}>{i + 1}.</span>
            <code className="mono" style={s.commandText}>
              {step.command}
            </code>
            {step.comment && <span style={s.commandComment}>{step.comment}</span>}
          </div>
          <button
            type="button"
            style={s.copyBtn}
            aria-label={t("sections.howToRun.copyCommand")}
            onClick={() => copyCommand(step.command)}
          >
            <Icon.Copy size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
