# Next.js App Router architecture

This covers **architectural placement** in the App Router — where code lives and where the
server/client boundary falls. For the mechanics of individual file conventions (async
`params`, metadata, error boundaries, image/font, hydration), use the
**`next-best-practices`** skill instead.

## Project organization strategies

Next.js is explicitly **unopinionated** about file organization — "choose a strategy that
works for your team and be consistent." It documents three ([Next.js docs][next-structure]):

1. **Project files outside `app/`** — all app code in root-level shared folders
   (`/components`, `/lib`); `app/` is used purely for routing.
2. **Project files in top-level folders inside `app/`** — `app/components`, `app/lib`.
3. **Split by feature/route** — globally shared code at the root, feature-specific code
   colocated inside the route segment that uses it. (This is the colocation-friendly
   option and what this repo uses — see [this-repo.md](./this-repo.md).)

`components`, `lib`, `ui`, `utils`, `hooks` are generic placeholders, not mandated names.

## Colocation via private `_folders`

A route is **not publicly accessible** until a `page.tsx` or `route.ts` exists, and only
the content returned by those files is sent to the client. So you can safely place
components, helpers, and tests next to the routes that use them. ([Next.js docs][next-structure])

Use a **private folder** (`_components`, `_lib`) — the underscore opts the folder and all
its children out of routing — to colocate feature code inside a route segment without it
becoming a URL:

```
app/dashboard/
├── page.tsx
├── _components/      # not routable — feature UI lives here
│   └── Chart.tsx
└── _lib/             # not routable — feature data/helpers
    └── data.ts
```

Other organizational file conventions (deep mechanics in `next-best-practices`):
`(group)` route groups for organizing without affecting the URL, `[param]` dynamic
segments, `@slot` parallel routes, `(.)` intercepting routes.

## The server/client boundary is an architecture decision

Layouts and pages are **Server Components by default.** This boundary decides what ships
to the browser and where secrets are allowed — treat it as architecture, not a per-file
afterthought. ([Next.js docs][next-sc])

- **Server Components** for: fetching data close to the source, using secrets/API keys,
  reducing client JS, streaming.
- **Client Components** (`"use client"`) for: state, event handlers, lifecycle effects,
  browser-only APIs, custom hooks that use those.

**`"use client"` marks a boundary, not a label.** Everything imported into a
`"use client"` file — and every component it renders — joins the client bundle. So:

- **Push `"use client"` to the interactive leaves.** Don't mark a big subtree client when
  only one button needs interactivity. A server `Layout` can render a server `<Logo/>`
  next to a client `<Search/>`; only `Search` ships JS.

- **Donut / `children` composition.** Server Components passed as `children` (or props)
  into a Client Component are rendered on the server and passed as output — they are *not*
  pulled into the client bundle. This lets a client `<Modal/>` wrap server-rendered
  content. ([Next.js docs][next-sc])

- **Providers go deep, not at the root.** Wrap `{children}` with a context provider as
  deep in the tree as possible rather than wrapping `<html>`, so Next can keep static
  Server Component parts optimized. Context isn't available in Server Components, so the
  provider itself must be a `"use client"` component that accepts `children`.

- **Props crossing server→client must be serializable.**

## Where data fetching goes

Pick the right tool for the direction of data ([Next.js docs][next-fetch], [Lee Robinson][lr-apis]):

- **Reads → Server Components.** Fetch directly from the source (ORM/DB client or
  `fetch`) during render; credentials stay server-side. **Don't** call your own Route
  Handler from a Server Component — that's a needless network hop; fetch from source.
- **Mutations → Server Actions.** Think of them as auto-generated `POST` endpoints called
  like functions; they integrate with caching/revalidation and have built-in CSRF/action-ID
  protections.
- **Route Handlers (`route.ts`) → only when you need a real API:** a public API consumed
  by multiple clients (web + mobile + third party), a BFF/proxy in front of microservices,
  webhooks, or custom auth endpoints.

To avoid waterfalls, start independent requests together and `await Promise.all([...])`
rather than awaiting them in sequence; wrap slow sections in `<Suspense>` to stream.

## The Data Access Layer (DAL) — where business logic and DB access live

For new projects, Next.js recommends a dedicated **server-only Data Access Layer**: an
internal module that controls how data is fetched and what reaches the render context.
([Next.js data security][next-sec])

A DAL module should:

- Start with `import 'server-only';` so importing it into a Client Component is a
  **build-time error**.
- Be the **only** place that reads `process.env` secrets.
- Perform **authorization** checks (re-verify inside each Server Action too — page-level
  checks don't extend to actions; check ownership to avoid IDOR).
- Return **minimal DTOs** — never raw DB records — so private fields can't leak when the
  result is passed to a client component.

Conventionally this lives in `lib/` or `data/` (e.g. `lib/db`, `data/user.ts`). Keep
Server Actions thin and delegate to the DAL; if the same logic is also exposed via a Route
Handler, share it through the DAL rather than duplicating it.

The security audit rule of thumb: **database packages and `process.env` must not be
imported outside the DAL.**

## Environment variables & config

- `.env*` files live at the **project root**, even when using `src/`. ([Next.js env docs][next-env])
- **`NEXT_PUBLIC_` is the only prefix exposed to the browser**, and those values are
  **inlined at build time** (the app won't pick up changes to them after build).
  Unprefixed vars are server-only.
- Read secrets only in the DAL (above). Don't trust client-supplied input
  (`searchParams`, headers) for authorization.
- Config files and `.env*` stay in the root, not inside `src/`.

## Anti-patterns to flag

- Passing whole DB records / overly-broad props from a Server Component into a Client
  Component (leaks private fields). Return DTOs.
- Reading `process.env` outside the DAL.
- Marking large UI subtrees `"use client"` instead of pushing it to leaves.
- Mounting providers at `<html>` instead of wrapping `{children}` deep.
- Sequential `await`s for independent data (waterfall) — use `Promise.all`.
- Building Route Handlers just to fetch your own data, then calling them from Server
  Components (extra hop) — fetch from source instead.
- Mutations as render side effects (e.g. setting cookies during render) — use a Server Action.

## Sources

- Next.js — Project structure and organization — https://nextjs.org/docs/app/getting-started/project-structure
- Next.js — Server and Client Components — https://nextjs.org/docs/app/getting-started/server-and-client-components
- Next.js — Fetching Data — https://nextjs.org/docs/app/getting-started/fetching-data
- Next.js — Route Handlers — https://nextjs.org/docs/app/getting-started/route-handlers
- Next.js — How to think about data security (DAL, server-only, DTOs) — https://nextjs.org/docs/app/guides/data-security
- Next.js — Environment variables — https://nextjs.org/docs/app/guides/environment-variables
- Lee Robinson — Building APIs with Next.js — https://nextjs.org/blog/building-apis-with-nextjs
- server-only (npm) — https://www.npmjs.com/package/server-only

[next-structure]: https://nextjs.org/docs/app/getting-started/project-structure
[next-sc]: https://nextjs.org/docs/app/getting-started/server-and-client-components
[next-fetch]: https://nextjs.org/docs/app/getting-started/fetching-data
[next-sec]: https://nextjs.org/docs/app/guides/data-security
[next-env]: https://nextjs.org/docs/app/guides/environment-variables
[lr-apis]: https://nextjs.org/blog/building-apis-with-nextjs
