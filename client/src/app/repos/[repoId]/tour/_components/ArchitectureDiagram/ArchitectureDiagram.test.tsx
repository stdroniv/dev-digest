import React from "react";
import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { ArchitectureGraph } from "@devdigest/shared";

import { ArchitectureDiagram } from "./ArchitectureDiagram";

afterEach(cleanup);

const GRAPH: ArchitectureGraph = {
  nodes: [
    { id: "client", label: "client/", outlineColor: "#3b82f6" },
    { id: "server", label: "server/" },
    { id: "db", label: "Postgres" },
  ],
  edges: [
    { from: "client", to: "server", label: "HTTP" },
    { from: "server", to: "db" },
  ],
};

describe("ArchitectureDiagram (AC-8, Q3: bespoke SVG, not Mermaid)", () => {
  it("renders one node group per graph node", () => {
    const { container } = render(<ArchitectureDiagram graph={GRAPH} />);
    const nodeGroups = container.querySelectorAll("g[data-node-id]");
    expect(nodeGroups.length).toBe(GRAPH.nodes.length);
    const rects = container.querySelectorAll("rect");
    expect(rects.length).toBe(GRAPH.nodes.length);
  });

  it("renders one arrow (line with a marker-end) per graph edge", () => {
    const { container } = render(<ArchitectureDiagram graph={GRAPH} />);
    const lines = container.querySelectorAll("line[data-edge]");
    expect(lines.length).toBe(GRAPH.edges.length);
    lines.forEach((line) => {
      expect(line.getAttribute("marker-end")).toBe("url(#tour-arch-arrow)");
    });
  });

  it("applies outlineColor as the node's stroke when present, and the default border otherwise", () => {
    const { container } = render(<ArchitectureDiagram graph={GRAPH} />);
    const clientRect = container.querySelector('g[data-node-id="client"] rect');
    expect(clientRect?.getAttribute("stroke")).toBe("#3b82f6");
    const serverRect = container.querySelector('g[data-node-id="server"] rect');
    expect(serverRect?.getAttribute("stroke")).toBe("var(--border)");
  });

  it("renders node labels as plain SVG text (never dangerouslySetInnerHTML)", () => {
    const { container } = render(<ArchitectureDiagram graph={GRAPH} />);
    const texts = Array.from(container.querySelectorAll("text")).map((t) => t.textContent);
    expect(texts).toEqual(expect.arrayContaining(["client/", "server/", "Postgres"]));
  });

  it("renders nothing for an empty graph", () => {
    const { container } = render(<ArchitectureDiagram graph={{ nodes: [], edges: [] }} />);
    expect(container.querySelector("svg")).toBeNull();
  });
});
