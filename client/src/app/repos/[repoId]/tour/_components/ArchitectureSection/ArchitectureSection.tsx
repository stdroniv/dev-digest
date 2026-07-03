/* ArchitectureSection — SPEC-02 AC-8: prose describing the service + request
   flow, inline references to real repo paths, and a small architecture
   diagram. `prose` and `refs` are UNTRUSTED model output — rendered with a
   minimal, SAFE inline formatter that emits React elements only (never
   dangerouslySetInnerHTML): paragraph breaks, `inline code`, and **bold**.
   The ref chips open the cited file on the repo's GitHub (AC-16/17). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { ArchitectureContent } from "@devdigest/shared";
import { ArchitectureDiagram } from "../ArchitectureDiagram";
import { openOrCopyCited } from "../affordances";
import { s } from "./styles";

/** Split untrusted prose on blank lines into paragraphs, collapsing single
   hard-wraps within a paragraph into spaces so it reflows naturally. */
function toParagraphs(prose: string): string[] {
  return prose
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

/** Safe inline formatter for a single paragraph of UNTRUSTED text: recognises
   only `code` spans and **bold** runs, everything else is literal text. Returns
   React nodes — no HTML is ever injected. */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const token = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = token.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const raw = m[0];
    if (raw.startsWith("`")) {
      nodes.push(
        <code key={`${keyPrefix}-c${i}`} className="mono" style={s.inlineCode}>
          {raw.slice(1, -1)}
        </code>,
      );
    } else {
      nodes.push(
        <strong key={`${keyPrefix}-b${i}`} style={s.bold}>
          {raw.slice(2, -2)}
        </strong>,
      );
    }
    last = token.lastIndex;
    i += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function ArchitectureSection({
  content,
  githubUrl,
}: {
  content: ArchitectureContent;
  githubUrl: string | null;
}) {
  const t = useTranslations("tour");
  const paragraphs = toParagraphs(content.prose);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={s.prose}>
        {paragraphs.map((para, i) => (
          <p key={i} style={s.paragraph}>
            {renderInline(para, `p${i}`)}
          </p>
        ))}
      </div>
      {content.refs.length > 0 && (
        <div style={s.refsWrap}>
          {content.refs.map((ref, i) => (
            <button
              key={`${ref}-${i}`}
              type="button"
              className="mono"
              style={s.refChip}
              title={t("sections.architecture.openFile", { path: ref })}
              aria-label={t("sections.architecture.openFile", { path: ref })}
              onClick={() => openOrCopyCited(ref, githubUrl)}
            >
              <Icon.ExternalLink size={11} style={s.refIcon} />
              {ref}
            </button>
          ))}
        </div>
      )}
      <div style={s.diagramWrap}>
        <ArchitectureDiagram graph={content.diagram} />
      </div>
    </div>
  );
}
