"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button, Skeleton } from "@devdigest/ui";
import type { Intent } from "@devdigest/shared";
import { useIntent, useRecalculateIntent } from "@/lib/hooks/brief";
import { s } from "./styles";
import { RiskAreas } from "./RiskAreas";

interface IntentCardProps {
  prId: string | null | undefined;
}

/**
 * IntentCard — shows the PR's classified intent on the Overview tab.
 *
 * Displays: summary, IN SCOPE list, OUT OF SCOPE list, and a Recalculate
 * button. Shows an empty state when no intent has been computed yet.
 */
export function IntentCard({ prId }: IntentCardProps) {
  const t = useTranslations("brief");
  const { data: intent, isLoading } = useIntent(prId);
  const recalculate = useRecalculateIntent(prId);

  const handleRecalculate = () => {
    recalculate.mutate();
  };

  if (isLoading) {
    return (
      <section>
        <SectionLabel icon="Target">{t("block.intent")}</SectionLabel>
        <div style={s.card}>
          <div style={{ padding: 16 }}>
            <Skeleton height={88} />
          </div>
        </div>
      </section>
    );
  }

  const recalculateLabel = recalculate.isPending
    ? t("intent.recalculating")
    : t("intent.recalculate");

  return (
    <section>
      <SectionLabel icon="Target">{t("block.intent")}</SectionLabel>
      <div style={s.card}>
        {!intent ? (
          <EmptyState
            onRecalculate={handleRecalculate}
            isPending={recalculate.isPending}
            emptyLabel={t("intent.empty")}
            recalculateLabel={recalculateLabel}
          />
        ) : (
          <IntentContent
            intent={intent}
            onRecalculate={handleRecalculate}
            isPending={recalculate.isPending}
            inScopeLabel={t("intent.inScope")}
            outOfScopeLabel={t("intent.outOfScope")}
            recalculateLabel={recalculateLabel}
          />
        )}
        <RiskAreas prId={prId} />
      </div>
    </section>
  );
}

// ---- Sub-components --------------------------------------------------------

function EmptyState({
  onRecalculate,
  isPending,
  emptyLabel,
  recalculateLabel,
}: {
  onRecalculate: () => void;
  isPending: boolean;
  emptyLabel: string;
  recalculateLabel: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 16px",
        gap: 12,
      }}
    >
      <span style={s.emptyState}>{emptyLabel}</span>
      <Button size="sm" kind="ghost" onClick={onRecalculate} disabled={isPending}>
        {recalculateLabel}
      </Button>
    </div>
  );
}

function IntentContent({
  intent,
  onRecalculate,
  isPending,
  inScopeLabel,
  outOfScopeLabel,
  recalculateLabel,
}: {
  intent: Intent;
  onRecalculate: () => void;
  isPending: boolean;
  inScopeLabel: string;
  outOfScopeLabel: string;
  recalculateLabel: string;
}) {
  return (
    <>
      <div style={s.header}>
        <p style={s.summaryText}>{intent.intent}</p>
        <Button size="sm" kind="ghost" onClick={onRecalculate} disabled={isPending}>
          {recalculateLabel}
        </Button>
      </div>

      {(intent.in_scope.length > 0 || intent.out_of_scope.length > 0) && (
        <div style={s.divider} />
      )}

      <div style={s.scopeSection}>
        {intent.in_scope.length > 0 && (
          <div style={s.scopeCol}>
            <p style={s.scopeLabel}>{inScopeLabel}</p>
            <ul style={s.scopeList}>
              {intent.in_scope.map((item, i) => (
                <li key={i} style={s.scopeItem}>
                  <span style={s.scopeBullet}>•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {intent.out_of_scope.length > 0 && (
          <div style={s.scopeCol}>
            <p style={s.scopeLabel}>{outOfScopeLabel}</p>
            <ul style={s.scopeList}>
              {intent.out_of_scope.map((item, i) => (
                <li key={i} style={s.scopeItem}>
                  <span style={s.scopeBullet}>•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
