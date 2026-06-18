# client — Engineering Insights

Append-only log of non-obvious, hard-won lessons for this module (`@devdigest/web`).
Managed by the `engineering-insights` skill. Add each entry under one section; keep
it actionable cold; never edit or delete existing entries.

## What Works

## What Doesn't Work

- A `position: fixed` portal popover positioned from a ONE-TIME `getBoundingClientRect()` (e.g. `FindingsHoverCard`) DETACHES on scroll: `fixed` pins it to the viewport, so when the page/timeline scrolls the trigger moves but the card stays floating over unrelated content. Must dismiss (or reposition) on `scroll`+`resize` while open. Two subtleties: (a) register the `scroll` listener in the CAPTURE phase (`window.addEventListener('scroll', fn, true)`) — `scroll` does NOT bubble, and the content may live in a NESTED `overflow:auto` scroller a non-capture window listener would miss; (b) IGNORE scrolls originating inside the popover's own `overflow:auto` list via `popoverRef.current?.contains(e.target)`, or scrolling a long findings list self-dismisses the card. Regression test: open via `mouseEnter`, `fireEvent.scroll(window)`, assert it's gone (`RunHistory.test.tsx`).

## Codebase Patterns

- The PR-list FINDINGS popover re-derives its finding list CLIENT-SIDE in `components/FindingsCounts/aggregate.ts` (`aggregateLatestPerAgent`), which is a SECOND copy of the rule the server uses to compute the `findings_counts` badge in `server/src/modules/pulls/routes.ts` (latest review per `(pr, agentId)`, `kind === 'review'` only, dismissed findings INCLUDED, sorted severity→confidence). The badge total and the popover list length only match because both apply the identical rule — change one and you MUST change the other, or the header "N findings" disagrees with the rows shown. The popover deliberately reuses the existing `GET /pulls/:id/reviews` endpoint (no new endpoint / contract field) and fetches lazily on hover, which is why the client must re-aggregate rather than read a server-prepared list.
- A hover popover/dropdown anchored inside the PR-list table will be CLIPPED: `styles.ts` `tableCard` sets `overflow: hidden` (needed for its rounded corners), so an absolutely-positioned child is cut at the card edge. Render the floating layer via `createPortal(node, document.body)` with `position: fixed` coords from the trigger's `getBoundingClientRect()` instead (see `PRRow/FindingsCell.tsx`). Keep it open across the trigger→popover gap with a short close-delay timer that both elements' `onMouseEnter` cancel, and `stopPropagation` on the popover so clicks don't fire the row's navigate-onClick.
- A PR-list row component (`PRRow`) now fetches lazily on hover via `usePrReviews` (TanStack Query). Any test that renders `PRRow` must wrap it in a `QueryClientProvider` or `useQuery` throws "No QueryClient set" — even though the query is `enabled:false` until hovered (so no fetch mock is needed for the closed/default state). Mirror `agents/_components/AgentCard/AgentCard.test.tsx`.
- The PR-list table is a POSITIONAL CSS grid, not a column-config map. Adding/removing a column means editing THREE places in sync in `src/app/repos/[repoId]/pulls/`: `constants.ts` `GRID` (add a track width — the string order = visual order), `constants.ts` `COLUMN_KEYS` (the header auto-renders from this array in `page.tsx` via `t("list.columns.<key>")`), and `_components/PRRow/PRRow.tsx` (insert the cell `<div>` at the MATCHING index — cells are emitted in source order with no key binding). Miss one and headers silently misalign from cells. Reuse `SEV`/`Icon` from `@devdigest/ui` (re-exported via the primitives barrel) for severity color+icon instead of redefining maps.

## Tool & Library Notes

- Testing a hover popover that `createPortal`s to `document.body` (e.g. `FindingsHoverCard`) in jsdom: (1) `mouseEnter` does NOT bubble, so `fireEvent.mouseEnter` must target the exact element with the handler — the wrapper div, reachable as `screen.getByLabelText("…counts aria-label…").parentElement` — NOT the inner counters node. (2) The portal still opens even though jsdom's `getBoundingClientRect()` returns all-zeros, because the component stores a truthy `{top:0,left:0}` coords object and renders regardless; assert the revealed content with normal `screen.getByText(...)` since RTL queries default to `document.body` where the portal mounts. No need to stub `getBoundingClientRect`. See `RunHistory.test.tsx` "findings hover popover".

## Recurring Errors & Fixes

- RTL `getByText(/whole string/)` fails ("Unable to find an element") when JSX interpolates siblings: `{a} tok · {formatUsd(b)}` renders THREE text nodes ("9,731", " tok · ", "$0.012"), and `getByText` matches per-node by default. Fix in the component (not the test) by collapsing to one text node with a template literal: `{`${a} tok · ${formatUsd(b)}`}`. Done for the run cost line in `RunHistory.tsx`.
- `getByText("—")` throws "Found multiple elements" once a row can render the em-dash placeholder in MORE than one cell (e.g. `PRRow` shows `—` for both null `cost_usd` and null `findings_counts`). Adding a new dash-able cell breaks pre-existing single-dash assertions. Fix: in the shared test fixture builder give the new field a NON-dash default (e.g. `findings_counts: {critical:2,warning:2,suggestion:1}`), and in each dash-specific test set the OTHER cells non-null so exactly one `—` remains. Prefer `getByLabelText(...)` for the new cell (e.g. the `FindingsCounts` group's aria-label) — it's unique regardless of how many dashes render.

## Session Notes

## Open Questions
