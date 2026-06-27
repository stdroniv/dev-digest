# Plan: Risk Areas card on the PR Overview tab

## Understanding
The PR Overview tab renders an `IntentCard` but has no companion `RisksCard`,
even though the review pipeline already persists risk areas. The full `PrBrief`
(including `risks`) is stored as JSON in the `pr_brief` table, but nothing exposes
it: there is no read route, no repo helper, no client hook, and no UI. This plan
wires up an end-to-end read path — server route -> repo helper -> client hook ->
component — mirroring the existing Intent layer, so the Overview tab shows a Risks
block below Intent. Risks are produced as part of a full review run (not computed
on demand), so the card is read-only (no Recalculate button).

## Context loaded
- Root `CLAUDE.md` (auto-loaded) + root `INSIGHTS.md` — note the "Looks greenfield,
  isn't" entry: the Intent layer is the proven template (`pr_intent`, contracts,
  repo helpers) to mirror; do not recreate tables/contracts.
- `server/CLAUDE.md` — schema-first routes, modules delegate to services, do-not-touch
  vendor/migrations.
- `client/CLAUDE.md` — data access only via `src/lib/hooks/*` -> `src/lib/api.ts`;
  thin pages, colocated `_components/<Name>/`; i18n via `messages/<locale>/*.json`.
- Server: `server/src/modules/reviews/routes.ts` (full), `intent.service.ts`,
  `repository/pull.repo.ts`, `modules/_shared/schemas.ts` (`IdParams`),
  `db/schema/reviews.ts` (`prBrief` table = `{ prId PK, json jsonb }`).
- Shared contract: `client/src/vendor/shared/contracts/brief.ts` (read-only) —
  `Risk`, `RiskSeverity`, `Risks`, `PrBrief`; exported via `@devdigest/shared` on
  both server and client (`*/src/vendor/shared/index.ts`).
- Client: `_components/IntentCard/{IntentCard.tsx,styles.ts,index.ts,IntentCard.test.tsx}`,
  `_components/OverviewTab/OverviewTab.tsx`, `lib/hooks/brief.ts`, `lib/api.ts`,
  `messages/en/brief.json`. UI primitives: `SectionLabel`, `IconName` registry
  (`AlertTriangle` is valid — used by `SEV.WARNING` in `vendor/ui/primitives/tokens.ts`).
- Skills consulted: `client-server-communication` (read endpoint shape + typed
  fetch client + null contract) and `react-best-practices` (component/props/empty-state).
  Deliberately skipped `drizzle-orm-patterns`/`postgresql-table-design` (no schema
  change — table already exists) and `zod` deep-dive (reusing existing `PrBrief`).
- Only one locale exists (`client/messages/en/`), so one message file changes.

## Approach & tradeoffs
Mirror the Intent read path exactly, one layer at a time, so the new code matches
the module's established shape and is independently verifiable:

- **Server read path via a thin service.** Every route in `reviews/routes.ts`
  delegates to a service (`ReviewService`, `IntentService`, `SmartDiffService`); the
  handler never touches the repo directly. So I add a minimal `RisksService.get()`
  that mirrors `IntentService.get()` — it workspace-scopes via `getPull` (404 if the
  PR is not in the workspace) and reads the brief via a new `getBrief` repo helper.
  - *Rejected: inline `getPull` + `getBrief` in the route handler.* It is fewer
    files but breaks the "handlers delegate to a service" convention and duplicates
    the workspace-scoping that `IntentService.get` already models.
- **Robust brief parsing in the repo.** `getBrief` runs `PrBrief.safeParse(row.json)`
  and returns `PrBrief | undefined` (undefined when no row OR the stored JSON fails
  validation), so a partial/legacy brief degrades to "no risks" instead of a 500.
  This is parsing *DB data*, not request input, so it does not violate the
  "no hand-rolled parsing of requests in handlers" rule.
- **Route shape mirrors the sibling `GET /pulls/:id/intent` exactly**
  (`{ schema: { params: IdParams } }`, returns the payload or `null`). No route in
  this module declares a `response:` schema; I follow the sibling we were told to
  mirror rather than introduce the module's first response schema (see Open questions).
- **Client mirrors `useIntent` + `IntentCard`** — a `useRisks` query hook and a
  `RisksCard` built from the same inline-`styles.ts` pattern, minus the Recalculate
  button/mutation (risks are not computed on demand).

## Implementation steps

1. **Add `getBrief` repo helper** — `server/src/modules/reviews/repository/pull.repo.ts`
   - Change type: modify (append a new exported function; add `PrBrief` import)
   - What: import `PrBrief` from `@devdigest/shared` (alongside the existing `Intent`
     type import). Add:
     `export async function getBrief(db: Db, prId: string): Promise<PrBrief | undefined>`
     that `select()`s from `t.prBrief` where `prId` matches; if no row, return
     `undefined`; else `const parsed = PrBrief.safeParse(row.json); return parsed.success ? parsed.data : undefined;`.
     Place it under a new `// ---- brief ----` section near `getIntent`.
   - Verify: `cd server && node_modules/.bin/tsc --noEmit` passes; `getBrief` is
     exported and referenced nowhere yet.

2. **Add `RisksService`** — `server/src/modules/reviews/risks.service.ts` (new)
   - Change type: add
   - What: a class mirroring `IntentService` but read-only:
     `constructor(private readonly container: Container) {}` and
     `async get(workspaceId: string, prId: string): Promise<Risks | null>`.
     Body: `const pull = await getPull(this.container.db, workspaceId, prId); if (!pull) throw new NotFoundError(\`PR ${prId} not found\`); const brief = await getBrief(this.container.db, prId); return brief?.risks ?? null;`.
     Imports: `Risks` type from `@devdigest/shared`, `Container` type from
     `../../platform/container.js`, `getPull`/`getBrief` from
     `./repository/pull.repo.js`, `NotFoundError` from `../../platform/errors.js`.
   - Verify: `cd server && node_modules/.bin/tsc --noEmit` passes.

3. **Register `GET /pulls/:id/risks` route** — `server/src/modules/reviews/routes.ts`
   - Change type: modify
   - What: import `RisksService` from `./risks.service.js`; instantiate
     `const risksService = new RisksService(container);` beside the other services;
     add a handler directly after the `GET /pulls/:id/intent` block:
     `app.get('/pulls/:id/risks', { schema: { params: IdParams } }, async (req) => { const { workspaceId } = await getContext(container, req); return (await risksService.get(workspaceId, req.params.id)) ?? null; });`.
     Add a one-line entry to the module's top-of-file route doc comment.
   - Verify: `cd server && node_modules/.bin/tsc --noEmit` passes; start the API
     (`pnpm dev`) and `curl -s localhost:3001/pulls/<prId>/risks` returns a JSON
     object `{ "risks": [...] }` for a PR with a stored brief and `null` otherwise.

4. **Add `useRisks` client hook** — `client/src/lib/hooks/brief.ts`
   - Change type: modify
   - What: add `Risks` to the `import type { Intent, SmartDiff } from "@devdigest/shared"`
     line. Add, mirroring `useIntent`:
     `export function useRisks(prId: string | null | undefined) { return useQuery({ queryKey: ["risks", prId], queryFn: () => api.get<Risks | null>(\`/pulls/${prId}/risks\`), enabled: prId != null }); }`.
   - Verify: `cd client && node_modules/.bin/tsc --noEmit` passes.

5. **Add Risks i18n keys** — `client/messages/en/brief.json`
   - Change type: modify
   - What: add a `"risks"` object with severity labels:
     `"risks": { "high": "High", "medium": "Medium", "low": "Low" }`.
     Leave the existing `block.risks` ("Risks") and `noRisks` keys untouched (they
     are already used by the card). No other locale dirs exist, so this is the only
     message file to change.
   - Verify: file is valid JSON (`cd client && node_modules/.bin/tsc --noEmit` still
     passes; the RisksCard test below renders without missing-message warnings).

6. **Add `RisksCard` styles** — `client/src/app/repos/[repoId]/pulls/[number]/_components/RisksCard/styles.ts` (new)
   - Change type: add
   - What: export `const s = { ... } as const` using the inline-`CSSProperties`
     pattern from `IntentCard/styles.ts`. Reuse `card`, `emptyState`, `divider`.
     Add: `riskList` (column flex, gap), `riskItem` (padding, column), `riskHeader`
     (row flex, gap, align center), `badge` (inline-flex, small radius, 11px bold,
     uppercase, padding), `title` (14px, primary text), `explanation` (13px,
     secondary text), `fileRefs` (row wrap, gap), `fileRef` (mono, 11px, muted).
     Add a `severityColor: Record<RiskSeverity, { c: string; bg: string }>` map using
     existing CSS vars — high -> `var(--crit)`/`var(--crit-bg)`, medium ->
     `var(--warn)`/`var(--warn-bg)`, low -> `var(--sugg)`/`var(--sugg-bg)` (mirrors
     `SEV` in `vendor/ui/primitives/tokens.ts`). Import `RiskSeverity` type from
     `@devdigest/shared`.
   - Verify: `cd client && node_modules/.bin/tsc --noEmit` passes.

7. **Add `RisksCard` component** — `client/src/app/repos/[repoId]/pulls/[number]/_components/RisksCard/RisksCard.tsx` (new)
   - Change type: add
   - What: `"use client"` component `export function RisksCard({ prId }: { prId: string | null | undefined })`.
     `const t = useTranslations("brief"); const { data: risks, isLoading } = useRisks(prId);`
     if `isLoading` return `null` (mirror IntentCard). Render
     `<section><SectionLabel icon="AlertTriangle">{t("block.risks")}</SectionLabel><div style={s.card}>...`.
     Empty state when `!risks || risks.risks.length === 0`: a padded row showing
     `t("noRisks")` styled with `s.emptyState` (no button). Otherwise map
     `risks.risks` to a `s.riskList`; each item shows a severity badge
     (`style={{ ...s.badge, color: s.severityColor[r.severity].c, background: s.severityColor[r.severity].bg }}`
     with label `t(\`risks.${r.severity}\`)`), `r.title`, `r.explanation`, and, when
     `r.file_refs.length > 0`, a `s.fileRefs` row of `r.file_refs` as `s.fileRef`
     chips. Key list items by index (as IntentCard does).
   - Verify: `cd client && node_modules/.bin/tsc --noEmit` passes.

8. **Add `RisksCard` barrel** — `client/src/app/repos/[repoId]/pulls/[number]/_components/RisksCard/index.ts` (new)
   - Change type: add
   - What: `export { RisksCard } from "./RisksCard";` (mirrors `IntentCard/index.ts`
     so `OverviewTab` can import from `"../RisksCard"`).
   - Verify: `cd client && node_modules/.bin/tsc --noEmit` passes.

9. **Mount `RisksCard` in `OverviewTab`** — `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`
   - Change type: modify
   - What: `import { RisksCard } from "../RisksCard";` and render `<RisksCard prId={prId} />`
     immediately below `<IntentCard prId={prId} />`.
   - Verify: `cd client && node_modules/.bin/tsc --noEmit` passes; in the running app
     the Risks block appears under Intent on a PR Overview tab.

10. **Add `RisksCard` RTL test** — `client/src/app/repos/[repoId]/pulls/[number]/_components/RisksCard/RisksCard.test.tsx` (new)
    - Change type: add
    - What: mirror `IntentCard.test.tsx` (same `renderCard`/`jsonResp` helpers,
      `NextIntlClientProvider` with `messages={{ brief: briefMessages }}`, mocked
      `global.fetch`). Cover: (a) with risks data -> renders a risk title,
      explanation, severity label, and a file ref; (b) `null` response -> renders the
      `No notable risks flagged.` empty state; (c) empty `{ "risks": [] }` -> also
      renders the empty state. Use a fixture matching the `Risks` contract
      (`{ risks: [{ kind, title, explanation, severity, file_refs }] }`).
    - Verify: `cd client && node_modules/.bin/vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/RisksCard` is green.

## Acceptance criteria
- **Server typecheck:** `cd server && node_modules/.bin/tsc --noEmit` exits 0.
- **Server route behavior:** with the API running (`./scripts/dev.sh` or
  `cd server && pnpm dev`, DB migrated + seeded), for a PR that has a stored brief
  `curl -s localhost:3001/pulls/<prId>/risks` returns `{"risks":[...]}`; for a PR
  with no `pr_brief` row it returns `null`; an unknown/foreign PR id returns a 404.
- **Client typecheck + unit:** `cd client && node_modules/.bin/tsc --noEmit` exits 0,
  and `cd client && node_modules/.bin/vitest run .../RisksCard` passes (data,
  null-empty, and empty-array cases).
- **End-to-end (manual):** open a PR whose review has run, go to the Overview tab —
  a "Risks" section with the `AlertTriangle` icon renders directly below the Intent
  card, listing each risk with a colored high/medium/low badge, title, explanation,
  and file refs; a PR with no brief shows "No notable risks flagged.".
- (Canonical commands `cd server && pnpm typecheck` / `cd client && pnpm test` are
  the documented equivalents; this repo's pnpm pre-flight is broken, so the
  `node_modules/.bin/*` invocations above are the reliable form — see root INSIGHTS.)

## Risks / out of scope / open questions
- **Risks:**
  - Do NOT edit `*/src/vendor/**` — the `Risk`/`Risks`/`PrBrief` contracts and
    `SectionLabel`/`IconName` already exist there; import, never modify.
  - No DB migration: the `pr_brief` table already exists; do not add/alter schema or
    edit old migrations.
  - i18n: every user-visible string must come from `messages/en/brief.json` via
    `useTranslations("brief")`; a missing key surfaces as a runtime warning and a
    raw key in the UI — the new `risks.{high,medium,low}` keys must exist before the
    card ships (step 5 precedes step 7).
  - Index-based React keys match IntentCard but assume stable ordering; acceptable
    here since the list is static per fetch.
- **Out of scope:** computing/populating `pr_brief` (that is the review run's job — no
  Recalculate button); the Blast radius and PR History blocks of the brief; any
  POST/recompute endpoint for risks; pagination/filtering/sorting of risks; new
  locales beyond `en`.
- **Open questions / assumptions:**
  - *Response schema:* the constraints mention declaring a Zod `response` schema, but
    no route in `reviews/routes.ts` (including the `GET /pulls/:id/intent` we mirror)
    declares one, and adding `response: Risks.nullable()` would be the module's first
    and risks serialization edge cases. **Assumption:** match the sibling route
    (`params: IdParams` only). If the team wants response validation enforced, add
    `response: { 200: Risks.nullable() }` to this route as a follow-up.
  - **Assumption:** a single `RisksService` is preferred over inlining repo calls in
    the handler, for parity with the module's other routes and to reuse `getPull`
    workspace scoping. If strictly the four originally-listed pieces are wanted, the
    handler can inline `getPull` + `getBrief` and the service step is dropped.
  - **Assumption:** `getBrief` returns `undefined` on a failed `safeParse` (treat a
    malformed stored brief as "no risks") rather than throwing — keeps the read
    endpoint resilient to legacy/partial briefs.
