import type { IconName } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";

/** Editor tab descriptor. `labelKey` resolves under the `skills` namespace. */
export interface SkillEditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/**
 * Skill editor tabs. Config + Preview + Context + Stats + Versions; the Evals
 * tab in the design is a later lesson (no eval data yet).
 */
export const TABS: readonly SkillEditorTab[] = [
  { key: "config", labelKey: "tabs.config", icon: "Settings" },
  { key: "preview", labelKey: "tabs.preview", icon: "Eye" },
  { key: "context", labelKey: "tabs.context", icon: "FileText" },
  { key: "stats", labelKey: "tabs.stats", icon: "BarChart" },
  { key: "versions", labelKey: "tabs.versions", icon: "History" },
];

export const VALID_SKILL_TABS = TABS.map((t) => t.key);

/** Skill type options for the Config select. */
export const SKILL_TYPE_VALUES: readonly SkillType[] = [
  "rubric",
  "convention",
  "security",
  "custom",
];
