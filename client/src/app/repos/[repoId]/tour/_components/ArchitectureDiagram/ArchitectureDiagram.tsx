/* ArchitectureDiagram — a lightweight, dependency-free SVG box-and-arrow
   renderer for the tour's `ArchitectureGraph` (SPEC-02 AC-8, Q3: NOT Mermaid).
   Node/edge labels are UNTRUSTED model output (often literal repo paths) —
   rendered only as SVG `<text>` content, never `dangerouslySetInnerHTML`. */
"use client";

import React from "react";
import type { ArchitectureGraph } from "@devdigest/shared";
import { layoutArchitectureGraph } from "./layout";

export function ArchitectureDiagram({ graph }: { graph: ArchitectureGraph }) {
  const { nodes, edges, width, height } = layoutArchitectureGraph(graph);
  if (nodes.length === 0) return null;

  return (
    <svg
      role="img"
      aria-label="Architecture diagram"
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      style={{ maxWidth: "100%", display: "block" }}
    >
      <defs>
        <marker
          id="tour-arch-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L10 5 L0 10 z" fill="var(--text-muted)" />
        </marker>
      </defs>

      {edges.map((e, i) => (
        <line
          key={`edge-${e.from}-${e.to}-${i}`}
          data-edge={`${e.from}->${e.to}`}
          x1={e.x1}
          y1={e.y1}
          x2={e.x2}
          y2={e.y2}
          stroke="var(--text-muted)"
          strokeWidth={1.5}
          markerEnd="url(#tour-arch-arrow)"
        />
      ))}

      {nodes.map((n) => (
        <g key={n.id} data-node-id={n.id}>
          <rect
            x={n.x}
            y={n.y}
            width={n.width}
            height={n.height}
            rx={8}
            ry={8}
            fill="var(--bg-elevated)"
            stroke={n.outlineColor ?? "var(--border)"}
            strokeWidth={n.outlineColor ? 2 : 1}
          />
          <text
            x={n.x + n.width / 2}
            y={n.y + n.height / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={11.5}
            fill="var(--text-primary)"
          >
            {n.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
