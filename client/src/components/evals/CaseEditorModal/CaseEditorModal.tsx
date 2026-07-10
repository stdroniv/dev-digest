/* Eval case editor modal (SPEC-04, T16; lifted + generalized in T5). Shared by
   the agent Evals tab, the (future) skill Evals tab, and the repo/PR
   FindingCard. Three modes:
   - "new"    — author a brand-new case from scratch (AC-22): diff/files/PR
                meta are editable.
   - "edit"   — edit an existing case: rename + expected-output JSON edit
                only; the frozen input is read-only (the case is a snapshot —
                client/CLAUDE.md edge case).
   - "seeded" — Gap 2's "Turn into eval case": pre-filled from a NON-SAVING
                preview of a frozen finding draft (`seed.draft`). The frozen
                diff/files/PR-meta are read-only (R-G2-3 — must not
                user-rewrite the freeze guarantee), but name + expected-output
                stay editable before the first Save, which goes through
                `useCreateCaseFromFinding` (the finding route owns AC-5
                idempotency), not `useCreateCase`.
   Every mode shares the same JSON-validation + finding-skeleton affordance
   (AC-23), blocking Save while the expected-output JSON is invalid. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, FormField, TextInput, Textarea, Toggle, Tabs, Badge } from "@devdigest/ui";
import type { EvalCase, EvalRunRecord } from "@devdigest/shared";
import {
  useCreateCase,
  useUpdateCase,
  useDeleteCase,
  useRunSingleCase,
  useCreateCaseFromFinding,
  type EvalOwner,
  type FindingEvalCasePreview,
} from "@/lib/hooks/evals";
import { s } from "./styles";

type InputTab = "diff" | "files" | "prMeta";

const SKELETON_FINDING = {
  file: "src/example.ts",
  start_line: 1,
  end_line: 1,
  severity: "WARNING",
  category: "security",
  title: "Describe the expected finding",
};

function stringifyPretty(value: unknown, fallback: string): string {
  if (value == null) return fallback;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return fallback;
  }
}

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

export function CaseEditorModal({
  mode,
  owner,
  evalCase,
  lastRun,
  seed,
  onSaved,
  onClose,
}: {
  mode: "new" | "edit" | "seeded";
  /** The case's owner (agent or skill) — threaded into the generalized
   *  create/update/delete/run-single hooks (T13/T14). Seeded mode always
   *  saves via the finding route with `owner.kind === "agent"` (only agents
   *  have findings to freeze from). */
  owner: EvalOwner;
  evalCase: EvalCase | null;
  lastRun: EvalRunRecord | null;
  /** Gap 2 seeded mode: the finding this case is frozen from + its non-saving
   *  preview draft. Required when `mode === "seeded"`. */
  seed?: { findingId: string; draft: FindingEvalCasePreview };
  /** Fired after a successful SEEDED-mode save (only) with the finding
   *  route's `{ case, already_added }` response — lets the caller (e.g.
   *  `FindingCard`) show the "Added"/"Already added" confirmation without
   *  this component needing to know about toasts. */
  onSaved?: (result: { case: EvalCase; already_added: boolean }) => void;
  onClose: () => void;
}) {
  const t = useTranslations("evals");
  const create = useCreateCase();
  const update = useUpdateCase();
  const del = useDeleteCase();
  const runCase = useRunSingleCase();
  const createFromFinding = useCreateCaseFromFinding();

  const seededDraft = mode === "seeded" ? seed?.draft : undefined;

  const [name, setName] = React.useState(evalCase?.name ?? seededDraft?.name ?? "");
  const [diff, setDiff] = React.useState(evalCase?.input_diff ?? seededDraft?.input_diff ?? "");
  const [filesText, setFilesText] = React.useState(stringifyPretty(evalCase?.input_files, ""));
  const [metaText, setMetaText] = React.useState(
    stringifyPretty(evalCase?.input_meta ?? seededDraft?.input_meta, ""),
  );
  const [expectedText, setExpectedText] = React.useState(
    stringifyPretty(evalCase?.expected_output ?? seededDraft?.expected_output ?? [], "[]"),
  );
  const [runOnSave, setRunOnSave] = React.useState(false);
  const [inputTab, setInputTab] = React.useState<InputTab>("diff");

  const expectedParsed = tryParseJson(expectedText);
  const isValidJson = expectedParsed.ok;

  const isSaving = create.isPending || update.isPending || createFromFinding.isPending;

  const insertSkeleton = () => {
    const parsed = tryParseJson(expectedText);
    const nextArray = parsed.ok && Array.isArray(parsed.value) ? [...parsed.value, SKELETON_FINDING] : [SKELETON_FINDING];
    setExpectedText(JSON.stringify(nextArray, null, 2));
  };

  const save = async () => {
    if (!isValidJson) return;
    const expected_output = expectedParsed.ok ? expectedParsed.value : [];
    let savedId = evalCase?.id ?? null;

    if (mode === "new") {
      const filesParsed = filesText.trim() ? tryParseJson(filesText) : { ok: true as const, value: undefined };
      const metaParsed = metaText.trim() ? tryParseJson(metaText) : { ok: true as const, value: undefined };
      const created = await create.mutateAsync({
        owner,
        name: name.trim() || t("caseEditor.namePlaceholder"),
        input_diff: diff,
        input_files: filesParsed.ok ? filesParsed.value : undefined,
        input_meta: metaParsed.ok ? metaParsed.value : undefined,
        expected_output,
      });
      savedId = created.id;
    } else if (mode === "seeded" && seed) {
      // Save on the finding route (A2) — it owns AC-5 idempotency + the
      // finding→case link; the frozen `input_diff` is never sent (R-G2-3).
      const created = await createFromFinding.mutateAsync({
        findingId: seed.findingId,
        name: name.trim() || t("caseEditor.namePlaceholder"),
        expected_output,
      });
      savedId = created.case.id;
      onSaved?.(created);
    } else if (evalCase) {
      await update.mutateAsync({
        id: evalCase.id,
        owner,
        patch: { name, expected_output },
      });
    }

    if (runOnSave && savedId) {
      runCase.mutate({ caseId: savedId, owner });
    }
    onClose();
  };

  const removeCase = () => {
    if (!evalCase) return;
    if (window.confirm(`Delete eval case "${evalCase.name}"? This cannot be undone.`)) {
      del.mutate({ id: evalCase.id, owner }, { onSuccess: onClose });
    }
  };

  const runNow = () => {
    if (!evalCase) return;
    runCase.mutate({ caseId: evalCase.id, owner });
  };

  const expectedCount = React.useMemo(() => {
    const value = tryParseJson(stringifyPretty(evalCase?.expected_output ?? [], "[]"));
    return value.ok && Array.isArray(value.value) ? value.value.length : 0;
  }, [evalCase]);

  return (
    <Modal
      width={880}
      title={
        mode === "new"
          ? t("caseEditor.titleNew")
          : mode === "seeded"
            ? t("caseEditor.titleSeeded")
            : t("caseEditor.titleEdit", { name: evalCase?.name ?? "" })
      }
      subtitle="simulate a PR and assert the expected output"
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {mode === "edit" && (
            <Button kind="danger" icon="Trash" onClick={removeCase} disabled={del.isPending}>
              {t("caseEditor.delete")}
            </Button>
          )}
          <label style={s.runOnSaveLabel}>
            <Toggle on={runOnSave} onChange={setRunOnSave} size={16} />
            {t("caseEditor.runOnSave")}
          </label>
          <div style={s.spacer} />
          <Button kind="ghost" onClick={onClose}>
            {t("caseEditor.cancel")}
          </Button>
          {mode === "edit" && (
            <Button kind="secondary" icon="Play" onClick={runNow} disabled={runCase.isPending}>
              {runCase.isPending ? t("caseEditor.running") : t("caseEditor.runCase")}
            </Button>
          )}
          <Button kind="primary" icon="Check" onClick={save} disabled={!isValidJson || isSaving}>
            {isSaving ? t("caseEditor.saving") : t("caseEditor.save")}
          </Button>
        </div>
      }
    >
      {lastRun && (
        <div style={{ padding: "16px 24px 0" }}>
          <div style={s.resultStrip}>
            {lastRun.pass ? t("caseEditor.lastRunPassed") : t("caseEditor.lastRunFailed")}
            <span>·</span>
            <span>
              {t("caseEditor.lastRunGotFindings", {
                expected: expectedCount,
                actual: Array.isArray(lastRun.actual_output) ? lastRun.actual_output.length : 0,
              })}
            </span>
            {lastRun.duration_ms != null && (
              <span>· {t("caseEditor.lastRunDuration", { seconds: (lastRun.duration_ms / 1000).toFixed(1) })}</span>
            )}
            {lastRun.cost_usd != null && (
              <span>· {t("caseEditor.lastRunCost", { amount: lastRun.cost_usd.toFixed(4) })}</span>
            )}
          </div>
        </div>
      )}
      <div style={s.body}>
        <div style={s.col}>
          <FormField label={t("caseEditor.nameLabel")} required>
            <TextInput value={name} onChange={setName} placeholder={t("caseEditor.namePlaceholder")} />
          </FormField>

          <FormField label={t("caseEditor.inputLabel")}>
            <Tabs
              pad="0"
              value={inputTab}
              onChange={(k) => setInputTab(k as InputTab)}
              tabs={[
                { key: "diff", label: t("caseEditor.diffLabel") },
                { key: "files", label: t("caseEditor.filesLabel") },
                { key: "prMeta", label: t("caseEditor.prMetaLabel") },
              ]}
            />
            <div style={{ marginTop: 10 }}>
              {inputTab === "diff" &&
                (mode === "new" ? (
                  <Textarea value={diff} onChange={setDiff} rows={12} mono placeholder={t("caseEditor.diffPlaceholder")} />
                ) : (
                  <pre style={s.inputPane}>{diff || "—"}</pre>
                ))}
              {inputTab === "files" &&
                (mode === "new" ? (
                  <Textarea value={filesText} onChange={setFilesText} rows={12} mono placeholder="[]" />
                ) : (
                  <pre style={s.inputPane}>{filesText || "—"}</pre>
                ))}
              {inputTab === "prMeta" &&
                (mode === "new" ? (
                  <Textarea value={metaText} onChange={setMetaText} rows={12} mono placeholder="{}" />
                ) : (
                  <pre style={s.inputPane}>{metaText || "—"}</pre>
                ))}
            </div>
          </FormField>
        </div>

        <div style={s.col}>
          <div style={s.expectedHeaderRow}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
              {t("caseEditor.expectedOutputLabel")}
            </span>
            <Badge style={isValidJson ? s.jsonBadgeValid : s.jsonBadgeInvalid}>
              {isValidJson ? t("caseEditor.validJson") : t("caseEditor.invalidJson")}
            </Badge>
            <div style={{ marginLeft: "auto" }}>
              <Button kind="secondary" size="sm" icon="Plus" onClick={insertSkeleton}>
                {t("caseEditor.findingSkeleton")}
              </Button>
            </div>
          </div>
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "8px 0" }}>
            {t("caseEditor.expectedOutputHelp")}
          </p>
          <Textarea value={expectedText} onChange={setExpectedText} rows={16} mono />
        </div>
      </div>
    </Modal>
  );
}
