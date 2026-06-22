/* Skill Stats tab — per-skill usage metrics for the selected skill: how many /
   which agents use it, how often it's pulled into reviews, its finding accept
   rate, and a 30-day findings count + category breakdown. All read-only,
   computed server-side (GET /skills/:id/stats). Mirrors the design mockup. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Card,
  Donut,
  EmptyState,
  ErrorState,
  Icon,
  MetricCard,
  SectionLabel,
  Skeleton,
} from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillStats } from "@/lib/hooks/skills";
import { categoryColor } from "./constants";

/**
 * Determinate ring gauge for a 0–100 metric — a track circle with an orange
 * progress arc and the rounded value in the center. Mirrors the design mockup's
 * accept-rate dial. Pure SVG (the vendored MetricCard's header slot only renders
 * a Sparkline, so the dial lives here in the feature rather than touching vendor).
 */
function RingGauge({ value, size = 40, stroke = 4 }: { value: number; size?: number; stroke?: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const dash = (pct / 100) * circumference;
  const center = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle cx={center} cy={center} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
      <circle
        cx={center}
        cy={center}
        r={r}
        fill="none"
        stroke="var(--warn)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference - dash}`}
        transform={`rotate(-90 ${center} ${center})`}
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        className="tnum"
        style={{ fontSize: 12, fontWeight: 700, fill: "var(--text-primary)" }}
      >
        {Math.round(pct)}
      </text>
    </svg>
  );
}

/**
 * Accept-rate KPI tile. Same shell as the vendored MetricCard but swaps the
 * top-right Sparkline slot for a {@link RingGauge} dial, per the design mockup.
 */
function AcceptRateCard({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        flex: 1,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 9,
        padding: 18,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span
          style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.03em" }}
        >
          {label}
        </span>
        <RingGauge value={value} />
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 12 }}>
        <span className="tnum" style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em" }}>
          {value}
          <span style={{ fontSize: 18, color: "var(--text-muted)" }}>%</span>
        </span>
      </div>
    </div>
  );
}

export function StatsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const { data: stats, isLoading, isError, refetch } = useSkillStats(skill.id);

  if (isLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", gap: 12 }}>
          <Skeleton height={96} />
          <Skeleton height={96} />
          <Skeleton height={96} />
          <Skeleton height={96} />
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <Skeleton height={180} />
          <Skeleton height={180} />
        </div>
      </div>
    );
  }

  if (isError || !stats) {
    return <ErrorState title={t("stats.errorTitle")} body={t("stats.errorBody")} onRetry={() => refetch()} />;
  }

  const segments = stats.findings_by_category.map((c) => ({
    label: c.category,
    value: c.count,
    color: categoryColor(c.category),
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* KPI row */}
      <div style={{ display: "flex", gap: 12 }}>
        <MetricCard label={t("stats.usedBy")} value={stats.used_by.count} suffix={` ${t("stats.agentsUnit")}`} />
        <MetricCard label={t("stats.pullFrequency")} value={stats.pull_frequency_pct} suffix="%" />
        <AcceptRateCard label={t("stats.acceptRate")} value={stats.accept_rate_pct} />
        <MetricCard label={t("stats.findings30d")} value={stats.findings_30d} />
      </div>

      {/* Detail row: agents using this skill + findings by category */}
      <div style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
        <Card style={{ flex: 1 }}>
          <SectionLabel icon="Cpu">{t("stats.agentsUsing")}</SectionLabel>
          {stats.used_by.agents.length === 0 ? (
            <EmptyState icon="Cpu" title={t("stats.noAgentsTitle")} body={t("stats.noAgentsBody")} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              {stats.used_by.agents.map((a) => (
                <Link
                  key={a.id}
                  href={`/agents/${a.id}?tab=config`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 12px",
                    borderRadius: 9,
                    border: "1px solid var(--border)",
                    background: "var(--bg-elevated)",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <Icon.Cpu size={15} />
                  <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{a.name}</span>
                  <span style={{ fontSize: 12.5, color: "var(--accent)", fontWeight: 600 }}>
                    {t("stats.open")}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card style={{ flex: 1 }}>
          <SectionLabel icon="Tag">{t("stats.findingsByCategory")}</SectionLabel>
          {segments.length === 0 ? (
            <EmptyState icon="Tag" title={t("stats.noFindingsTitle")} body={t("stats.noFindingsBody")} />
          ) : (
            <div style={{ marginTop: 12 }}>
              <Donut segments={segments} valuePrefix="" />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
