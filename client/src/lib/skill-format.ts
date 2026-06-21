import type { SkillType } from "@devdigest/shared";

/** Accent color per skill type — shared by the Skills list cards and the
 *  Agent editor's Skills tab so type badges stay consistent. */
export function typeColor(type: SkillType): string {
  switch (type) {
    case "rubric":
      return "var(--accent)";
    case "convention":
      return "var(--ok)";
    case "security":
      return "var(--crit)";
    case "custom":
    default:
      return "var(--text-secondary)";
  }
}
