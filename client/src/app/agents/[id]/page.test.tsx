import { describe, it, expect } from "vitest";
import { VALID_AGENT_TABS } from "./_components/AgentEditor/constants";

/** SPEC-05 T12 — the `?tab=` deep-link allow-list must include the new
 *  Stats/CI tabs, or `/agents/:id?tab=ci` (or `?tab=stats`) falls back to
 *  "config" instead of resolving (see `page.tsx`'s `VALID_AGENT_TABS.includes`
 *  check). The page derives its allow-list from the single `TABS` source in
 *  `AgentEditor/constants.ts` (`VALID_AGENT_TABS`), so the editor tab bar and
 *  the deep-link allow-list can no longer drift apart. */
describe("Agent editor page — VALID_AGENT_TABS (?tab= deep-links, AC-38/39/42)", () => {
  it("includes both 'ci' and 'stats'", () => {
    expect(VALID_AGENT_TABS).toContain("ci");
    expect(VALID_AGENT_TABS).toContain("stats");
  });
});
