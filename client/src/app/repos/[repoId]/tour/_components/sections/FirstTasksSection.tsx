/* FirstTasksSection — SPEC-02 AC-12/13/16/17: 2-4 starter-task cards, each
   with a title, a cited real repo-relative path (opens GitHub / copies, per
   the shared affordance), and a Low/Medium/High complexity badge. Derived
   from repo content only — never round-trips GitHub Issues. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { FirstTasksContent } from "@devdigest/shared";
import { openOrCopyCited } from "../affordances";
import { s, COMPLEXITY_COLOR } from "./styles";

export function FirstTasksSection({
  content,
  githubUrl,
}: {
  content: FirstTasksContent;
  githubUrl: string | null;
}) {
  const t = useTranslations("tour");
  return (
    <div style={s.taskGrid}>
      {content.tasks.map((task, i) => {
        const color = COMPLEXITY_COLOR[task.complexity];
        return (
          <div key={i} style={s.taskCard}>
            <div style={s.taskTitle}>{task.title}</div>
            <button
              type="button"
              className="mono"
              style={{ ...s.taskPath, background: "none", border: "none", textAlign: "left", padding: 0 }}
              onClick={() => openOrCopyCited(task.path, githubUrl)}
            >
              {task.path}
            </button>
            <Badge color={color.c} bg={color.bg}>
              {t(`sections.firstTasks.complexity.${task.complexity}`)}
            </Badge>
          </div>
        );
      })}
    </div>
  );
}
