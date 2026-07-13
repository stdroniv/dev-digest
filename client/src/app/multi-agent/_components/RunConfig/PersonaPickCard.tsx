/* RunConfig/PersonaPickCard.tsx — one selectable agent card in the Configure
   step (SPEC-05, T14 / AC-9, AC-11..12). Faithful port of the mock
   `PersonaPickCard` (`8bb91114:93-105`): a colour-tinted checkbox, an agent
   icon tile, the name + short summary, and a right-aligned mono guideline
   (its time/cost estimate or "no history"). The whole card is a toggle button;
   `guideline` is passed in already localised by the parent. */
"use client";

import React from "react";
import { Icon, type IconName } from "@devdigest/ui";
import { s } from "./styles";

export interface PersonaPickCardProps {
  name: string;
  summary: string;
  /** Deterministic agent colour (from `agentVisual`) used to tint the card. */
  color: string;
  icon: IconName;
  /** Right-aligned mono guideline — the estimate string or "no history". */
  guideline: string;
  on: boolean;
  onToggle: () => void;
}

export function PersonaPickCard({
  name,
  summary,
  color,
  icon,
  guideline,
  on,
  onToggle,
}: PersonaPickCardProps) {
  const TileIcon = Icon[icon];
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      style={{
        ...s.card,
        border: "1px solid " + (on ? color : "var(--border)"),
        background: on ? color + "12" : "var(--bg-elevated)",
      }}
    >
      <span
        style={{
          ...s.cardCheckbox,
          border: "1.5px solid " + (on ? color : "var(--border-strong)"),
          background: on ? color : "transparent",
        }}
      >
        {on && <Icon.Check size={12} style={{ color: "#fff" }} />}
      </span>
      <span style={{ ...s.cardIconTile, background: color + "1f", color }}>
        <TileIcon size={16} />
      </span>
      <span style={s.cardText}>
        <span style={s.cardName}>{name}</span>
        <span style={s.cardSummary}>{summary}</span>
      </span>
      <span className="mono" style={s.cardGuideline}>
        {guideline}
      </span>
    </button>
  );
}
