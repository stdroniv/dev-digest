/* constants.ts — static option lists for the Export Wizard (SPEC-05 T10).
   Names/descriptions render via `t("exportWizard.targets.<key>")` /
   `t("exportWizard.targets.<key>Desc")` — only the icon + selectable/recommended
   flags live here (design's `CI_TARGETS`). */
import type { CiTarget } from "@devdigest/shared";
import type { IconName } from "@devdigest/ui";

export interface CiTargetOption {
  key: CiTarget;
  icon: IconName;
  recommended?: boolean;
  disabled?: boolean;
}

/** GitHub Actions is the only functional target (AC-1); CircleCI / Jenkins /
 *  Generic CLI are visible but disabled ("coming soon", spec Non-goals). */
export const CI_TARGETS: CiTargetOption[] = [
  { key: "gha", icon: "Workflow", recommended: true },
  { key: "circle", icon: "RefreshCw", disabled: true },
  { key: "jenkins", icon: "Settings", disabled: true },
  { key: "cli", icon: "Command", disabled: true },
];

/** `pull_request` event types offered as trigger chips (AC-6). Rendered as the
 *  literal `pull_request:<value>` technical string — not translated, mirroring
 *  the un-translated `mono` file paths in the Preview tree. */
export const TRIGGER_OPTIONS = ["opened", "synchronize", "reopened"] as const;
export type TriggerOption = (typeof TRIGGER_OPTIONS)[number];

/** `opened` + `synchronize` on by default; `reopened` is optional (AC-6). */
export const DEFAULT_TRIGGERS: TriggerOption[] = ["opened", "synchronize"];

export const POST_AS_OPTIONS = ["github_review", "pr_comment", "none"] as const;
export type PostAsOption = (typeof POST_AS_OPTIONS)[number];

/** Maps a `post_as` value to its `exportWizard.postAs.*` i18n key. */
export const POST_AS_I18N_KEY: Record<PostAsOption, string> = {
  github_review: "githubReview",
  pr_comment: "prComment",
  none: "none",
};

export const DEFAULT_POST_AS: PostAsOption = "github_review";

export const STEP_KEYS = ["target", "preview", "configure", "install"] as const;

export const MODAL_WIDTH = 720;

/** Default base branch for the export input (server default is also "main"). */
export const DEFAULT_BASE_BRANCH = "main";
