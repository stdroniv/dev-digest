# How DevDigest's `client/` adapts the generic standard

The generic standard in this skill describes a top-level `src/features/` layout. DevDigest's
Next.js App Router client achieves the **same goals** (feature isolation, colocation,
unidirectional flow) using **route-colocated features** instead. When working in
`client/`, follow these actual conventions — they're authoritative; the generic docs are
the "why". See `client/CLAUDE.md` and `client/INSIGHTS.md` for the source of truth.

## Route-colocated features (not `src/features/`)

Features live next to the route that owns them, inside a private `_components/` folder
(the App Router colocation mechanism, [nextjs-architecture.md](./nextjs-architecture.md)):

```
client/src/app/repos/[repoId]/pulls/
├── page.tsx          # thin route entry — fetches via hooks, delegates to _components
├── constants.ts      # feature-local constants (GRID, COLUMN_KEYS, ...)
├── styles.ts         # colocated styles
└── _components/
    └── PRRow/
        ├── PRRow.tsx
        ├── FindingsCell.tsx
        └── PRRow.test.tsx
```

A feature folder colocates everything it owns: `Feature.tsx`, `styles.ts`, `constants.ts`,
`helpers.ts`, `*.test.tsx`, and nested `_components/`.

## Conventions specific to this repo

- **Pages are thin.** `app/**/page.tsx` fetches via hooks and delegates to
  `_components/<Name>/`; feature logic does not live in the page.
- **Named exports everywhere** — except where Next.js requires a default export
  (`page.tsx`, `layout.tsx`). Component **files are PascalCase** (`PRRow.tsx`), which
  differs from the kebab-case the generic docs suggest — follow PascalCase here.
- **Props destructured inline** in the signature with an inline type.
- **Data layer is fixed:** all access goes through `src/lib/hooks/*` (TanStack Query,
  organized by domain — `core.ts`, `reviews.ts`, `agents.ts`) → `src/lib/api.ts`
  (`apiFetch`/`ApiError`). **Never call `fetch()` directly in a component.** This is the
  repo's equivalent of the Data Access Layer concept, on the client side.
- **Cross-cutting UI** (nav, breadcrumbs, app shell, shortcuts) → `src/components/`
  (e.g. `src/components/app-shell`).
- **Shared utilities/types** → `src/lib/` (`lib/cost.ts`, `lib/github-urls.ts`,
  `lib/types.ts`). Configured third-party/client code also lives in `lib/`.
- **Styles** are colocated `styles.ts` modules using inline `CSSProperties` objects with
  `satisfies` + `as const` (not CSS modules), e.g. `s.row(hovered)` for computed styles.
- **i18n via next-intl:** strings come from `messages/<locale>/*.json` per namespace;
  never hard-code user-facing strings. Use `useTranslations(ns)` / `getTranslations(ns)`.
- **Vendored contracts:** shared Zod contracts in `src/vendor/shared` and UI primitives in
  `src/vendor/ui` are **vendored copies — do not edit** (changing one copy desyncs the
  others). Derive types via `z.infer<typeof Schema>`.

## Mapping generic → this repo

| Generic standard | DevDigest `client/` |
|---|---|
| `src/features/<feature>/` | `src/app/<route>/_components/<Feature>/` (route-colocated) |
| Feature `api/` module / DAL | `src/lib/hooks/*` → `src/lib/api.ts` |
| Shared `components/` | `src/components/` |
| Shared `utils/` + `lib/` | `src/lib/` |
| kebab-case files | PascalCase component files |
| CSS / Tailwind | colocated `styles.ts` (`CSSProperties` + `satisfies`) |
| Feature public API barrel | one file per component, named exports (no in-folder barrels) |
