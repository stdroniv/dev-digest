/* layout.ts — pure, deterministic layered (Sugiyama-style, simplified) layout
   for the architecture diagram. Grounded in a repo-derived {nodes, edges}
   graph (Q3/Rec 3 in the plan) — this file only computes GEOMETRY, never
   touches the untrusted node/edge labels themselves. Deterministic across
   renders: node order and edge order are the only inputs, no randomness. */
import type { ArchNode, ArchitectureGraph } from "@devdigest/shared";

const NODE_W = 160;
const NODE_H = 44;
const H_GAP = 56;
const V_GAP = 20;
const PAD = 16;

export interface PositionedNode extends ArchNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PositionedEdge {
  from: string;
  to: string;
  label?: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface DiagramLayout {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  width: number;
  height: number;
}

/** Assign each node a column ("layer") via bounded longest-path relaxation —
   tolerates cycles (a cyclic edge just stops contributing once the bound is
   hit) rather than requiring a strict DAG, since model-derived import graphs
   can contain cycles. */
export function layoutArchitectureGraph(graph: ArchitectureGraph): DiagramLayout {
  const { nodes, edges } = graph;
  const idSet = new Set(nodes.map((n) => n.id));
  // Defensive: drop edges that reference a node not present in `nodes` — the
  // model's diagram output is untrusted and may be malformed.
  const validEdges = edges.filter((e) => idSet.has(e.from) && idSet.has(e.to) && e.from !== e.to);

  const layer = new Map<string, number>();
  nodes.forEach((n) => layer.set(n.id, 0));
  for (let i = 0; i < nodes.length; i++) {
    let changed = false;
    for (const e of validEdges) {
      const from = layer.get(e.from) ?? 0;
      const to = layer.get(e.to) ?? 0;
      if (to <= from) {
        layer.set(e.to, from + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const byLayer = new Map<number, ArchNode[]>();
  for (const n of nodes) {
    const l = layer.get(n.id) ?? 0;
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l)!.push(n);
  }
  const layerKeys = [...byLayer.keys()].sort((a, b) => a - b);

  const positioned: PositionedNode[] = [];
  const posById = new Map<string, PositionedNode>();
  layerKeys.forEach((l, colIdx) => {
    const colNodes = byLayer.get(l)!;
    colNodes.forEach((n, rowIdx) => {
      const x = PAD + colIdx * (NODE_W + H_GAP);
      const y = PAD + rowIdx * (NODE_H + V_GAP);
      const pn: PositionedNode = { ...n, x, y, width: NODE_W, height: NODE_H };
      positioned.push(pn);
      posById.set(n.id, pn);
    });
  });

  const maxRows = layerKeys.length === 0 ? 0 : Math.max(...layerKeys.map((l) => byLayer.get(l)!.length));
  const width = PAD * 2 + Math.max(1, layerKeys.length) * NODE_W + Math.max(0, layerKeys.length - 1) * H_GAP;
  const height = PAD * 2 + Math.max(1, maxRows) * NODE_H + Math.max(0, maxRows - 1) * V_GAP;

  const positionedEdges: PositionedEdge[] = validEdges.map((e) => {
    const from = posById.get(e.from)!;
    const to = posById.get(e.to)!;
    const sameLayer = from.x === to.x;
    return {
      from: e.from,
      to: e.to,
      label: e.label,
      x1: sameLayer ? from.x + from.width / 2 : from.x + from.width,
      y1: sameLayer ? from.y + from.height : from.y + from.height / 2,
      x2: sameLayer ? to.x + to.width / 2 : to.x,
      y2: sameLayer ? to.y : to.y + to.height / 2,
    };
  });

  return { nodes: positioned, edges: positionedEdges, width, height };
}
