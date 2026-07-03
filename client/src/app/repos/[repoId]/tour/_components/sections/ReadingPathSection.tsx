/* ReadingPathSection — SPEC-02 AC-11: an ordered list of real files with a
   short why-read/why-in-this-order note. Text-only (no open affordance per
   the design — that's owned by Critical paths + First tasks, AC-16). */
"use client";

import React from "react";
import type { ReadingPathContent } from "@devdigest/shared";
import { s } from "./styles";

export function ReadingPathSection({ content }: { content: ReadingPathContent }) {
  return (
    <div>
      {content.steps.map((step, i) => (
        <div key={`${step.path}-${i}`} style={{ ...s.row, ...(i === content.steps.length - 1 ? s.rowLast : {}) }}>
          <span style={s.index}>{i + 1}.</span>
          <div style={s.rowMain}>
            <span className="mono" style={s.path}>
              {step.path}
            </span>
            <span style={s.reason}>{step.reason}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
