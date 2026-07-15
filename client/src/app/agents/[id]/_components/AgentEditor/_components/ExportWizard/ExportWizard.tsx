/* ExportWizard — the 4-step "Export to CI" modal (SPEC-05 T10 / N12).
   Target → Preview → Configure → Install. Composes vendored `@devdigest/ui`
   primitives only (Modal, ExportWizardSteps, Badge, Chip, Button, FormField,
   TextInput, Icon) — never edits them. All copy comes from
   `useTranslations("ci")` (`exportWizard.*`); no hardcoded strings. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Button, ExportWizardSteps } from "@devdigest/ui";
import type { Agent, CiTarget } from "@devdigest/shared";
import { useExportPreview, useExportInstall, useExportZip } from "@/lib/hooks/ci";
import { ApiError } from "@/lib/api";
import { TargetStep } from "./TargetStep";
import { PreviewStep } from "./PreviewStep";
import { ConfigureStep } from "./ConfigureStep";
import { InstallStep } from "./InstallStep";
import { downloadBlob, isValidRepoRef } from "./helpers";
import {
  STEP_KEYS,
  MODAL_WIDTH,
  DEFAULT_TRIGGERS,
  DEFAULT_POST_AS,
  DEFAULT_BASE_BRANCH,
  type TriggerOption,
  type PostAsOption,
} from "./constants";
import { s } from "./styles";

export interface ExportWizardProps {
  agent: Agent;
  onClose: () => void;
}

/** Mount-gated like the codebase's other modals (e.g. `CreateAgentModal`) —
 *  the caller renders `{open && <ExportWizard .../>}` rather than passing an
 *  `open` prop. */
export function ExportWizard({ agent, onClose }: ExportWizardProps) {
  const t = useTranslations("ci");

  const [step, setStep] = React.useState(0);
  const [target, setTarget] = React.useState<CiTarget>("gha");
  const [repo, setRepo] = React.useState("");
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [triggers, setTriggers] = React.useState<Set<TriggerOption>>(new Set(DEFAULT_TRIGGERS));
  const [postAs, setPostAs] = React.useState<PostAsOption>(DEFAULT_POST_AS);

  const preview = useExportPreview();
  const install = useExportInstall();
  const zip = useExportZip();

  const exportInput = {
    repo: repo.trim(),
    target,
    post_as: postAs,
    triggers: Array.from(triggers),
    base: DEFAULT_BASE_BRANCH,
  };

  // Default the Preview selection to the workflow file once files arrive
  // (mirrors the design's default selection), or the first file otherwise.
  React.useEffect(() => {
    const files = preview.data?.files;
    if (!files || files.length === 0) return;
    if (selectedPath && files.some((f) => f.path === selectedPath)) return;
    const workflow = files.find((f) => f.path.startsWith(".github/workflows/"));
    setSelectedPath((workflow ?? files[0])?.path ?? null);
    // Deliberately keyed on `preview.data` only — `selectedPath` is read but
    // must not re-trigger this effect on every selection change.
  }, [preview.data]);

  const canContinueFromTarget = isValidRepoRef(repo);

  async function handleContinue() {
    if (step === 0) {
      try {
        await preview.mutateAsync({ agentId: agent.id, input: exportInput });
      } catch {
        // Stay on the Target step — `previewErrorMessage` drives the inline
        // banner; the global mutation-error toast also fires.
        return;
      }
    }
    setStep((cur) => Math.min(cur + 1, STEP_KEYS.length - 1));
  }

  function handleBack() {
    setStep((cur) => Math.max(cur - 1, 0));
  }

  function toggleTrigger(trigger: TriggerOption) {
    setTriggers((prev) => {
      const next = new Set(prev);
      if (next.has(trigger)) next.delete(trigger);
      else next.add(trigger);
      return next;
    });
  }

  function handleInstall() {
    install.mutate({ agentId: agent.id, input: exportInput });
  }

  async function handleDownloadZip() {
    try {
      const blob = await zip.mutateAsync(agent.id);
      downloadBlob(blob, `devdigest-ci-${agent.id}.zip`);
    } catch {
      // zip.error is already reactive on the mutation result; nothing else to do.
    }
  }

  const isInstalled = Boolean(install.data?.pr_url);

  const installErrorMessage =
    install.error instanceof ApiError
      ? install.error.message
      : install.error
        ? String(install.error)
        : null;

  const previewErrorMessage =
    preview.error instanceof ApiError
      ? preview.error.message
      : preview.error
        ? String(preview.error)
        : null;

  const stepLabels = STEP_KEYS.map((key) => t(`exportWizard.steps.${key}`));

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("exportWizard.title")}
      subtitle={t("exportWizard.subtitle", { agentName: agent.name || t("exportWizard.thisAgent") })}
      onClose={onClose}
      footer={
        <div style={s.footerRow}>
          {step > 0 && (
            <Button kind="ghost" icon="ChevronLeft" onClick={handleBack}>
              {t("exportWizard.back")}
            </Button>
          )}
          <div style={{ marginLeft: "auto" }}>
            {step < STEP_KEYS.length - 1 ? (
              <Button
                kind="primary"
                iconRight="ArrowRight"
                onClick={handleContinue}
                disabled={step === 0 && (!canContinueFromTarget || preview.isPending)}
                loading={step === 0 && preview.isPending}
              >
                {t("exportWizard.continue")}
              </Button>
            ) : isInstalled ? (
              <Button kind="primary" icon="Check" onClick={onClose}>
                {t("exportWizard.complete")}
              </Button>
            ) : (
              <Button kind="primary" icon="Check" onClick={handleInstall} disabled={install.isPending}>
                {install.isPending ? t("exportWizard.installing") : t("exportWizard.install")}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div style={s.stepperWrap}>
        <ExportWizardSteps step={step} labels={stepLabels} />
      </div>
      <div style={s.stepBody}>
        {step === 0 && (
          <TargetStep
            target={target}
            onTargetChange={setTarget}
            repo={repo}
            onRepoChange={setRepo}
            error={previewErrorMessage}
          />
        )}
        {step === 1 && (
          <PreviewStep
            files={preview.data?.files ?? []}
            isLoading={preview.isPending}
            selectedPath={selectedPath}
            onSelect={setSelectedPath}
          />
        )}
        {step === 2 && (
          <ConfigureStep
            triggers={triggers}
            onToggleTrigger={toggleTrigger}
            postAs={postAs}
            onPostAsChange={setPostAs}
          />
        )}
        {step === 3 && (
          <InstallStep
            repo={repo}
            fileCount={preview.data?.files.length ?? 0}
            onInstall={handleInstall}
            installPending={install.isPending}
            installError={installErrorMessage}
            prUrl={install.data?.pr_url ?? null}
            installed={isInstalled}
            onDownloadZip={handleDownloadZip}
            zipPending={zip.isPending}
          />
        )}
      </div>
    </Modal>
  );
}
