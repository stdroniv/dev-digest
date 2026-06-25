"use client";

/**
 * SmartDiffViewer — risk-ordered diff layout.
 *
 * Fetches the Smart Diff grouping (core → wiring → boilerplate) from the server,
 * joins with the patch text already on `pr.files`, and renders each file as a
 * collapsible card. Boilerplate files are collapsed by default. When a file has
 * findings, a clickable badge scrolls to the first cited line. Per-line severity
 * pills are rendered for annotated lines and clicking them calls onNavigateToFinding.
 */
import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Icon, Skeleton } from "@devdigest/ui";
import type { PrFile, SmartDiffFile, SmartDiffRole, FindingAnnotation } from "@devdigest/shared";
import { useSmartDiff } from "@/lib/hooks/brief";
import { parsePatch, type Line } from "@/components/diff-viewer";
import { s } from "./styles";

// ---- Props -----------------------------------------------------------------

interface SmartDiffViewerProps {
  prId: string | null;
  files: PrFile[];
  /** When true, suppress the outer SectionLabel (caller owns the header). */
  hideHeader?: boolean;
  /** Called when the user clicks a per-line severity pill to jump to a finding. */
  onNavigateToFinding?: (findingId: string) => void;
}

// ---- Severity token map ----------------------------------------------------

type AnnotationSeverity = FindingAnnotation["severity"];

const SEV_TOKEN: Record<AnnotationSeverity, { color: string; bg: string; labelKey: "smartDiff.annotation.blocker" | "smartDiff.annotation.warning" | "smartDiff.annotation.suggestion" }> = {
  critical: { color: "var(--crit)", bg: "var(--crit-bg)", labelKey: "smartDiff.annotation.blocker" },
  warning: { color: "var(--warn)", bg: "var(--warn-bg)", labelKey: "smartDiff.annotation.warning" },
  suggestion: { color: "var(--sugg)", bg: "var(--sugg-bg)", labelKey: "smartDiff.annotation.suggestion" },
};

const SEV_RANK: Record<AnnotationSeverity, number> = { critical: 0, warning: 1, suggestion: 2 };

// ---- Helpers ---------------------------------------------------------------

function lineDomId(path: string, lineNo: number): string {
  return `line-${path.replace(/[^a-z0-9]/gi, "_")}-${lineNo}`;
}

function roleLabelKey(role: SmartDiffRole): "smartDiff.core" | "smartDiff.wiring" | "smartDiff.boilerplate" {
  if (role === "core") return "smartDiff.core";
  if (role === "wiring") return "smartDiff.wiring";
  return "smartDiff.boilerplate";
}

function roleDescKey(role: SmartDiffRole): "smartDiff.coreDesc" | "smartDiff.wiringDesc" | "smartDiff.boilerplateDesc" {
  if (role === "core") return "smartDiff.coreDesc";
  if (role === "wiring") return "smartDiff.wiringDesc";
  return "smartDiff.boilerplateDesc";
}

const ROLE_COLOR: Record<SmartDiffRole, string> = {
  core: "var(--accent)",
  wiring: "var(--warn)",
  boilerplate: "var(--text-muted)",
};

// ---- Component -------------------------------------------------------------

export function SmartDiffViewer({ prId, files, hideHeader = false, onNavigateToFinding }: SmartDiffViewerProps) {
  const t = useTranslations("brief");
  const { data, isLoading } = useSmartDiff(prId);

  // Build a Map<path, PrFile> for O(1) patch lookups
  const fileMap = React.useMemo(() => {
    const m = new Map<string, PrFile>();
    for (const f of files) m.set(f.path, f);
    return m;
  }, [files]);

  if (isLoading) {
    return (
      <section>
        {!hideHeader && <SectionLabel icon="Layers">Smart Diff</SectionLabel>}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Skeleton height={44} />
          <Skeleton height={44} />
          <Skeleton height={44} />
        </div>
      </section>
    );
  }

  const groups = data?.groups ?? [];
  const splitSuggestion = data?.split_suggestion;

  if (groups.length === 0) {
    return (
      <section>
        {!hideHeader && <SectionLabel icon="Layers">Smart Diff</SectionLabel>}
        <div style={s.empty}>{t("smartDiff.empty")}</div>
      </section>
    );
  }

  return (
    <section>
      {!hideHeader && <SectionLabel icon="Layers">Smart Diff</SectionLabel>}
      {splitSuggestion?.too_big && (
        <div style={s.splitBanner}>
          <Icon.AlertTriangle size={14} style={{ color: "var(--warn)", flexShrink: 0 }} />
          {t("smartDiff.splitSuggestion")}
        </div>
      )}
      <div style={s.section}>
        {groups.map((group) => (
          <SmartDiffGroup
            key={group.role}
            role={group.role}
            smartFiles={group.files}
            fileMap={fileMap}
            onNavigateToFinding={onNavigateToFinding}
            t={t}
          />
        ))}
      </div>
    </section>
  );
}

// ---- Group -----------------------------------------------------------------

function SmartDiffGroup({
  role,
  smartFiles,
  fileMap,
  onNavigateToFinding,
  t,
}: {
  role: SmartDiffRole;
  smartFiles: SmartDiffFile[];
  fileMap: Map<string, PrFile>;
  onNavigateToFinding?: (findingId: string) => void;
  t: ReturnType<typeof useTranslations<"brief">>;
}) {
  const roleLabel = t(roleLabelKey(role));
  const roleDesc = t(roleDescKey(role));
  const color = ROLE_COLOR[role];
  const fileWord = smartFiles.length === 1 ? "file" : "files";

  return (
    <div style={s.groupBlock}>
      <div style={s.groupHeader}>
        <span style={{ ...s.roleIndicator, background: color }} />
        <span style={s.roleLabel}>{roleLabel}</span>
        <span style={s.roleDesc}>{roleDesc}</span>
        <span style={s.roleCount}>{smartFiles.length} {fileWord}</span>
      </div>
      {smartFiles.map((sf) => (
        <SmartFileCard
          key={sf.path}
          smartFile={sf}
          prFile={fileMap.get(sf.path) ?? null}
          defaultOpen={role !== "boilerplate"}
          onNavigateToFinding={onNavigateToFinding}
          t={t}
        />
      ))}
    </div>
  );
}

// ---- File card -------------------------------------------------------------

function SmartFileCard({
  smartFile,
  prFile,
  defaultOpen,
  onNavigateToFinding,
  t,
}: {
  smartFile: SmartDiffFile;
  prFile: PrFile | null;
  defaultOpen: boolean;
  onNavigateToFinding?: (findingId: string) => void;
  t: ReturnType<typeof useTranslations<"brief">>;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const lines = React.useMemo(() => parsePatch(prFile?.patch), [prFile?.patch]);

  // Set of line numbers that are actually rendered in this file's diff patch.
  const renderedLineNos = React.useMemo(() => {
    const s = new Set<number>();
    for (const ln of lines) {
      const no = ln.newNo ?? ln.oldNo;
      if (no != null) s.add(no);
    }
    return s;
  }, [lines]);

  // Annotations whose start..end range intersects at least one rendered line.
  const visibleAnnotations = React.useMemo(() => {
    return smartFile.finding_annotations.filter((a) => {
      const end = a.end_line ?? a.line;
      for (let n = a.line; n <= end; n++) {
        if (renderedLineNos.has(n)) return true;
      }
      return false;
    });
  }, [smartFile.finding_annotations, renderedLineNos]);

  // Map each visible annotation under every line number in its inclusive range (used for highlight).
  const annotationsByLine = React.useMemo(() => {
    const m = new Map<number, FindingAnnotation[]>();
    for (const a of visibleAnnotations) {
      const end = a.end_line ?? a.line;
      for (let n = a.line; n <= end; n++) {
        const existing = m.get(n) ?? [];
        existing.push(a);
        m.set(n, existing);
      }
    }
    return m;
  }, [visibleAnnotations]);

  // Map each visible annotation only under its first line (used for the badge button).
  const badgeAnnotationsByLine = React.useMemo(() => {
    const m = new Map<number, FindingAnnotation[]>();
    for (const a of visibleAnnotations) {
      const existing = m.get(a.line) ?? [];
      existing.push(a);
      m.set(a.line, existing);
    }
    return m;
  }, [visibleAnnotations]);

  const handleFindingsBadgeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open) setOpen(true);

    const firstAnnotation = visibleAnnotations[0];
    if (firstAnnotation == null) return;
    const elemId = lineDomId(smartFile.path, firstAnnotation.line);
    // Wait one tick for the body to mount if we just opened the file
    setTimeout(() => {
      document.getElementById(elemId)?.scrollIntoView({ block: "center" });
    }, 0);
  };

  const hasFinding = visibleAnnotations.length > 0;
  const chevronStyle: React.CSSProperties = {
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
  };

  return (
    <div style={s.fileCard}>
      {/* Header */}
      <div onClick={() => setOpen((o) => !o)} style={s.fileHeader}>
        <Icon.ChevronRight size={13} style={chevronStyle} />
        <Icon.FileText size={14} style={{ color: "var(--text-muted)" }} />
        <span className="mono" style={s.filePath}>
          {smartFile.path}
        </span>
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{smartFile.additions}</span>{" "}
          <span style={s.delText}>−{smartFile.deletions}</span>
        </span>
        {hasFinding && (
          <button
            type="button"
            onClick={handleFindingsBadgeClick}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 8px",
              borderRadius: 5,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              background: "var(--code-del)",
              color: "var(--code-del-text)",
              borderStyle: "solid",
              borderWidth: 1,
              borderColor: "var(--code-del-text)",
            }}
          >
            <Icon.AlertTriangle size={11} />
            {t("smartDiff.findings", { count: visibleAnnotations.length })}
          </button>
        )}
      </div>

      {/* Body */}
      {open && (
        <div style={s.fileBody}>
          {lines.length === 0 ? (
            <div style={{ padding: "14px 18px", fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>
              No diff available.
            </div>
          ) : (
            lines.map((ln, i) => (
              <DiffLine
                key={i}
                ln={ln}
                path={smartFile.path}
                annotationsByLine={annotationsByLine}
                badgeAnnotationsByLine={badgeAnnotationsByLine}
                onNavigateToFinding={onNavigateToFinding}
                t={t}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---- Individual diff line --------------------------------------------------

function DiffLine({
  ln,
  path,
  annotationsByLine,
  badgeAnnotationsByLine,
  onNavigateToFinding,
  t,
}: {
  ln: Line;
  path: string;
  annotationsByLine: Map<number, FindingAnnotation[]>;
  badgeAnnotationsByLine: Map<number, FindingAnnotation[]>;
  onNavigateToFinding?: (findingId: string) => void;
  t: ReturnType<typeof useTranslations<"brief">>;
}) {
  if (ln.kind === "hunk") {
    return (
      <div className="mono" style={s.hunk}>
        {ln.text}
      </div>
    );
  }

  const lineNo = ln.newNo ?? ln.oldNo;
  const annotations = lineNo != null ? (annotationsByLine.get(lineNo) ?? []) : [];
  const badgeAnnotations = lineNo != null ? (badgeAnnotationsByLine.get(lineNo) ?? []) : [];

  // Pick the most-severe annotation for the left-border highlight (all lines in range).
  const topAnnotation = annotations.reduce<FindingAnnotation | null>((best, a) => {
    if (best === null) return a;
    return SEV_RANK[a.severity] < SEV_RANK[best.severity] ? a : best;
  }, null);

  // Pick the most-severe annotation for the badge (first line of range only).
  const topBadgeAnnotation = badgeAnnotations.reduce<FindingAnnotation | null>((best, a) => {
    if (best === null) return a;
    return SEV_RANK[a.severity] < SEV_RANK[best.severity] ? a : best;
  }, null);

  const sign = ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : "";
  const signColor =
    ln.kind === "add"
      ? "var(--code-add-text)"
      : ln.kind === "del"
        ? "var(--code-del-text)"
        : "var(--text-muted)";

  const baseBg =
    ln.kind === "add"
      ? "var(--code-add)"
      : ln.kind === "del"
        ? "var(--code-del)"
        : "transparent";

  const sevToken = topAnnotation ? SEV_TOKEN[topAnnotation.severity] : null;
  const badgeSevToken = topBadgeAnnotation ? SEV_TOKEN[topBadgeAnnotation.severity] : null;

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "stretch",
    fontSize: 13,
    lineHeight: "20px",
    background: sevToken ? sevToken.bg : baseBg,
    borderLeftWidth: 3,
    borderLeftStyle: "solid",
    borderLeftColor: sevToken ? sevToken.color : "transparent",
  };

  return (
    <div
      id={lineNo != null ? lineDomId(path, lineNo) : undefined}
      style={rowStyle}
    >
      <span className="mono tnum" style={s.lineNo}>
        {lineNo ?? ""}
      </span>
      <span className="mono" style={{ ...s.lineSign, color: signColor }}>
        {sign}
      </span>
      <span className="mono" style={s.lineText}>
        {ln.text || " "}
      </span>
      {topBadgeAnnotation && badgeSevToken && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNavigateToFinding?.(topBadgeAnnotation.finding_id);
          }}
          style={{
            marginLeft: "auto",
            alignSelf: "center",
            display: "inline-flex",
            alignItems: "center",
            padding: "1px 6px",
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            color: badgeSevToken.color,
            background: badgeSevToken.bg,
            borderStyle: "solid",
            borderWidth: 1,
            borderColor: badgeSevToken.color,
            flexShrink: 0,
            marginRight: 8,
            whiteSpace: "nowrap" as const,
          }}
        >
          {t(badgeSevToken.labelKey)}
        </button>
      )}
    </div>
  );
}
