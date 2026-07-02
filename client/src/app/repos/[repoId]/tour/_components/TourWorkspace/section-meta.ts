import type { IconName } from "@devdigest/ui";
import type { TourSectionKind } from "@devdigest/shared";

/** Fixed display order for the five tour sections (SPEC-02 AC-7/14). */
export const SECTION_ORDER: TourSectionKind[] = [
  "architecture",
  "critical_paths",
  "how_to_run",
  "reading_path",
  "first_tasks",
];

/** Per-section leading icon + the `tour.sections.<key>.title` message key
   segment (contract kinds are snake_case; message keys are camelCase). */
export const SECTION_META: Record<TourSectionKind, { icon: IconName; messageKey: string }> = {
  architecture: { icon: "Layers", messageKey: "architecture" },
  critical_paths: { icon: "Target", messageKey: "criticalPaths" },
  how_to_run: { icon: "Play", messageKey: "howToRun" },
  reading_path: { icon: "ArrowRight", messageKey: "readingPath" },
  first_tasks: { icon: "ListChecks", messageKey: "firstTasks" },
};

export function sectionAnchorId(kind: TourSectionKind | "cost"): string {
  return `tour-section-${kind}`;
}
