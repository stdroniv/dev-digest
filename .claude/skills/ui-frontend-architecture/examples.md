# Examples — good vs bad

Concrete pairs for the architecture rules. Each shows the **bad** pattern, the **good**
pattern, and a one-line "why".

---

## 1. Feature-based vs scatter-by-type

**Bad** — one feature's files scattered across layer-folders:

```
src/
├── components/  PriceTable.tsx  AgentCard.tsx  RepoList.tsx ...
├── hooks/       usePricing.ts   useAgents.ts   useRepos.ts ...
└── utils/       priceMath.ts    agentSort.ts   repoFilter.ts ...
```
To touch "pricing" you edit three distant folders; deleting it leaves orphans.

**Good** — each feature self-contained:

```
src/features/pricing/
├── components/PriceTable.tsx
├── hooks/usePricing.ts
├── utils/priceMath.ts
└── index.ts          # small, pure public API
```
*Why:* the feature is understandable, movable, and deletable as one unit.

---

## 2. Unidirectional dependencies

**Bad** — feature imports another feature:

```ts
// features/pricing/PriceTable.tsx
import { AgentCard } from '@/features/agents/components/AgentCard'; // ❌ feature→feature
```

**Good** — share via a shared layer, or compose at the page:

```ts
// features/pricing/PriceTable.tsx
import { Card } from '@/components/Card';        // ✅ feature → shared
// app/dashboard/page.tsx composes both features side by side
```
*Why:* features stay decoupled; cross-feature coupling becomes an app-level concern.
([dependency rule](./references/folder-structure.md))

---

## 3. Colocation vs premature shared util

**Bad** — a helper used by exactly one component dumped into global `utils/`:

```ts
// utils/formatPrRowDate.ts   (only PRRow uses this)
export const formatPrRowDate = (d: string) => ...;
```

**Good** — colocate until a second consumer appears:

```ts
// features/pulls/PRRow/helpers.ts
export const formatPrRowDate = (d: string) => ...;
```
*Why:* shared folders should hold genuinely shared code; promote on the second use.
([colocation](./references/placement.md))

---

## 4. Business logic: pure function vs hook vs service

**Bad** — a "hook" that calls no hooks; I/O mixed into the component:

```tsx
function useSortedItems(items: Item[]) {       // ❌ no hooks inside → not a hook
  return [...items].sort((a, b) => a.n - b.n);
}
function List() {
  const data = await fetch('/api/items');       // ❌ I/O inlined in component
}
```

**Good** — pure function for the transform, service+hook for I/O:

```ts
// utils/sortItems.ts  — pure, callable anywhere
export const sortItems = (items: Item[]) => [...items].sort((a, b) => a.n - b.n);
```
```tsx
// hooks/useItems.ts — wraps the service
export const useItems = () => useQuery({ queryKey: ['items'], queryFn: fetchItems });
function List() {
  const { data = [] } = useItems();
  return <>{sortItems(data).map(/* ... */)}</>;
}
```
*Why:* stateless logic stays testable and unconstrained by hook rules; I/O is isolated.
([business-logic triage](./references/placement.md))

---

## 5. `"use client"` pushed to the leaf, not the subtree

**Bad** — whole page marked client so one button works:

```tsx
'use client';                                   // ❌ ships the entire page as client JS
export default function Page() {
  return (<article>{/* lots of static content */}<LikeButton /></article>);
}
```

**Good** — server page, client only at the interactive leaf:

```tsx
// page.tsx — Server Component (no directive)
export default function Page() {
  return (<article>{/* static content stays on the server */}<LikeButton /></article>);
}
// LikeButton.tsx
'use client';
export function LikeButton() { const [liked, setLiked] = useState(false); /* ... */ }
```
*Why:* only the interactive leaf ships JS; the static content stays server-rendered.
([server/client boundary](./references/nextjs-architecture.md))

---

## 6. Donut / `children` composition

**Bad** — client component imports a server component (pulls it into the bundle):

```tsx
'use client';
import { ServerChart } from './ServerChart';    // ❌ now bundled as client
export function Panel() { return <div>{open && <ServerChart />}</div>; }
```

**Good** — pass the server component in as `children`:

```tsx
'use client';
export function Panel({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <div>{open && children}</div>;          // ✅ rendered on server, passed as output
}
// usage (server): <Panel><ServerChart /></Panel>
```
*Why:* children passed into a client component are rendered on the server, not bundled.

---

## 7. Data Access Layer: DTO vs leaking the DB record

**Bad** — full user row handed to a client component:

```tsx
const user = await db.user.findUnique({ where: { id } }); // includes passwordHash, email…
return <Profile user={user} />;                            // ❌ private fields cross to client
```

**Good** — server-only DAL returns a minimal DTO:

```ts
// lib/dal/user.ts
import 'server-only';
export async function getPublicProfile(id: string) {
  const u = await db.user.findUnique({ where: { id } });
  return { name: u.name, avatarUrl: u.avatarUrl };          // ✅ only public fields
}
```
*Why:* only the DAL touches the DB/secrets and decides what reaches the client.
([DAL](./references/nextjs-architecture.md))

---

## 8. Imports: alias vs relative chain; pure barrel vs deep barrel

**Bad:**

```ts
import { Button } from '../../../components/Button';   // ❌ brittle
// features/pricing/index.ts
export * from './components/PriceTable';
export const TAX = 0.2;                                 // ❌ logic in a barrel breaks tree-shaking
```

**Good:**

```ts
import { Button } from '@/components/Button';           // ✅ alias
// features/pricing/index.ts — pure re-exports only
export { PriceTable } from './components/PriceTable';
export { usePricing } from './hooks/usePricing';
```
*Why:* aliases survive file moves; pure per-feature barrels stay tree-shakeable and
cycle-free. ([imports & boundaries](./references/imports-and-boundaries.md))

---

## 9. Exports & file naming

**Bad:**

```tsx
// userCard.tsx
export default function UserCard() { /* ... */ }
import Card from './userCard';   // ❌ arbitrary local name, rename doesn't propagate
```

**Good:**

```tsx
// UserCard.tsx  (PascalCase file in this repo)
export function UserCard() { /* ... */ }
import { UserCard } from './UserCard';   // ✅ consistent name, refactor-safe, autocompletes
```
*Why:* named exports keep names consistent and rename-safe (Next still requires default
exports for `page.tsx`/`layout.tsx` — that's the exception).

---

## 10. Constants vs magic literals

**Bad:**

```tsx
if (retries > 3) abort();        // ❌ what is 3?
setStatus('lodaing');            // ❌ typo, no type safety
```

**Good:**

```ts
const MAX_RETRIES = 3;
export const STATUS = { idle: 'idle', loading: 'loading', error: 'error' } as const;
export type Status = (typeof STATUS)[keyof typeof STATUS];
```
*Why:* named constants explain intent; an `as const` object gives type-safe enumerated
values. Colocate feature-local; `config/` for app-wide. ([placement](./references/placement.md))
