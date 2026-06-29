"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { blastCallerUrl } from "@/lib/github-urls";
import type { BlastSymbolGroup } from "@/lib/types";

interface BlastGraphProps {
  symbols: BlastSymbolGroup[];
  repoFullName: string | null | undefined;
  indexedSha: string | null;
}

// Layout constants
const NODE_W = 160;
const NODE_H = 32;
const NODE_PADDING = 8;
const COL_GAP = 80;
const ROW_GAP = 14;
const PADDING = 24;

/**
 * Hand-rolled, dependency-free SVG hierarchical node-link graph.
 *
 * Three columns: changed symbols (left) → caller nodes (centre) →
 * endpoint/cron nodes (right). Connectors are SVG cubic bezier paths.
 * Caller nodes are clickable links (same blob URL as the Tree view).
 *
 * No new npm dependencies — pure SVG + React.
 */
export function BlastGraph({ symbols, repoFullName, indexedSha }: BlastGraphProps) {
  const t = useTranslations("blast");

  // Collect all unique callers and endpoint/cron nodes
  const callers: Array<{ file: string; symbol: string; line: number; rank: number }> = [];
  const endpointSet = new Set<string>();
  const cronSet = new Set<string>();

  for (const sym of symbols) {
    for (const c of sym.callers) {
      if (!callers.find((x) => x.file === c.file && x.line === c.line)) {
        callers.push(c);
      }
    }
    for (const ep of sym.endpoints) endpointSet.add(ep);
    for (const cr of sym.crons) cronSet.add(cr);
  }

  const endpoints = Array.from(endpointSet);
  const crons = Array.from(cronSet);
  const rightNodes = [...endpoints.map((ep) => ({ label: ep, kind: "endpoint" as const })), ...crons.map((cr) => ({ label: cr, kind: "cron" as const }))];

  if (symbols.length === 0) {
    return (
      <div
        style={{
          padding: "20px 16px",
          fontSize: 13,
          color: "var(--text-muted)",
          textAlign: "center",
        }}
        aria-label={t("graph.ariaLabel")}
      >
        {t("graph.empty")}
      </div>
    );
  }

  // Column x positions
  const col0x = PADDING;
  const col1x = PADDING + NODE_W + COL_GAP;
  const col2x = PADDING + NODE_W * 2 + COL_GAP * 2;

  // Row heights for each column
  const symCount = Math.max(symbols.length, 1);
  const callerCount = Math.max(callers.length, 1);
  const rightCount = Math.max(rightNodes.length, 1);

  const totalRows = Math.max(symCount, callerCount, rightCount);
  const svgHeight = PADDING * 2 + totalRows * (NODE_H + ROW_GAP) - ROW_GAP;
  const svgWidth = col2x + NODE_W + PADDING;

  // Helper: centre-y of row i in a column with N nodes, fitting in the total height
  function nodeY(i: number, N: number): number {
    const totalH = N * NODE_H + (N - 1) * ROW_GAP;
    const startY = PADDING + (svgHeight - 2 * PADDING - totalH) / 2;
    return startY + i * (NODE_H + ROW_GAP);
  }

  // Build connection edges (symbol → callers → rightNodes)
  const edges: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

  for (let si = 0; si < symbols.length; si++) {
    const sym = symbols[si]!;
    const sy = nodeY(si, symbols.length) + NODE_H / 2;

    for (const caller of sym.callers) {
      const ci = callers.findIndex(
        (c) => c.file === caller.file && c.line === caller.line,
      );
      if (ci >= 0) {
        const cy = nodeY(ci, callers.length) + NODE_H / 2;
        edges.push({
          x1: col0x + NODE_W,
          y1: sy,
          x2: col1x,
          y2: cy,
        });
      }
    }

    // caller → right nodes (endpoints/crons attributed to this symbol)
    for (const ep of sym.endpoints) {
      const ri = rightNodes.findIndex((n) => n.label === ep && n.kind === "endpoint");
      if (ri >= 0) {
        // find first matching caller for this symbol
        const ci = callers.findIndex((c) =>
          sym.callers.some((sc) => sc.file === c.file && sc.line === c.line),
        );
        if (ci >= 0) {
          const cy = nodeY(ci, callers.length) + NODE_H / 2;
          const ry = nodeY(ri, rightNodes.length) + NODE_H / 2;
          edges.push({ x1: col1x + NODE_W, y1: cy, x2: col2x, y2: ry });
        }
      }
    }
    for (const cr of sym.crons) {
      const ri = rightNodes.findIndex((n) => n.label === cr && n.kind === "cron");
      if (ri >= 0) {
        const ci = callers.findIndex((c) =>
          sym.callers.some((sc) => sc.file === c.file && sc.line === c.line),
        );
        if (ci >= 0) {
          const cy = nodeY(ci, callers.length) + NODE_H / 2;
          const ry = nodeY(ri, rightNodes.length) + NODE_H / 2;
          edges.push({ x1: col1x + NODE_W, y1: cy, x2: col2x, y2: ry });
        }
      }
    }
  }

  function cubicPath(x1: number, y1: number, x2: number, y2: number): string {
    const cx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
  }

  function truncate(text: string, maxLen = 18): string {
    return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
  }

  return (
    <svg
      width={svgWidth}
      height={svgHeight}
      aria-label={t("graph.ariaLabel")}
      style={{ display: "block", width: "100%", overflowX: "auto", fontSize: 11 }}
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
    >
      {/* Connector paths */}
      {edges.map((e, i) => (
        <path
          key={i}
          d={cubicPath(e.x1, e.y1, e.x2, e.y2)}
          fill="none"
          stroke="var(--border)"
          strokeWidth={1.5}
          strokeOpacity={0.7}
        />
      ))}

      {/* Column 0: Changed symbols */}
      {symbols.map((sym, i) => {
        const y = nodeY(i, symbols.length);
        return (
          <g key={`sym-${i}`}>
            <rect
              x={col0x}
              y={y}
              width={NODE_W}
              height={NODE_H}
              rx={5}
              fill="var(--bg-sunken)"
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text
              x={col0x + NODE_PADDING}
              y={y + NODE_H / 2 + 4}
              fill="var(--text-primary)"
              fontWeight={600}
              fontSize={11}
              fontFamily="var(--font-mono, monospace)"
            >
              {truncate(sym.name, 16)}
            </text>
          </g>
        );
      })}

      {/* Column 1: Callers */}
      {callers.map((caller, i) => {
        const y = nodeY(i, callers.length);
        const href = blastCallerUrl(repoFullName, indexedSha, caller.file, caller.line);
        const label = `${truncate(caller.file, 14)}:${caller.line}`;

        const nodeEl = (
          <g key={`caller-${i}`}>
            <rect
              x={col1x}
              y={y}
              width={NODE_W}
              height={NODE_H}
              rx={5}
              fill="rgba(59, 130, 246, 0.07)"
              stroke="var(--accent)"
              strokeWidth={1}
              strokeOpacity={0.5}
            />
            <text
              x={col1x + NODE_PADDING}
              y={y + NODE_H / 2 + 4}
              fill="var(--accent)"
              fontSize={10}
              fontFamily="var(--font-mono, monospace)"
            >
              {label}
            </text>
          </g>
        );

        if (href) {
          return (
            <a key={`caller-${i}`} href={href} target="_blank" rel="noopener noreferrer">
              {nodeEl}
            </a>
          );
        }
        return nodeEl;
      })}

      {/* Column 2: Endpoints + crons */}
      {rightNodes.map((node, i) => {
        const y = nodeY(i, rightNodes.length);
        const isEndpoint = node.kind === "endpoint";
        return (
          <g key={`right-${i}`}>
            <rect
              x={col2x}
              y={y}
              width={NODE_W}
              height={NODE_H}
              rx={5}
              fill={isEndpoint ? "rgba(59, 130, 246, 0.1)" : "rgba(139, 92, 246, 0.1)"}
              stroke={isEndpoint ? "var(--accent)" : "var(--purple, #8b5cf6)"}
              strokeWidth={1}
              strokeOpacity={0.5}
            />
            <text
              x={col2x + NODE_PADDING}
              y={y + NODE_H / 2 + 4}
              fill={isEndpoint ? "var(--accent)" : "var(--purple, #8b5cf6)"}
              fontSize={10}
              fontFamily="var(--font-mono, monospace)"
            >
              {truncate(node.label, 18)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
