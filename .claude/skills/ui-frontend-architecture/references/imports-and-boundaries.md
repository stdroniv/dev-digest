# Imports, aliases & module boundaries

## Path aliases over `../../../`

Use a single absolute-import alias instead of long relative chains. In `tsconfig.json`:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  }
}
```

```ts
// good
import { Button } from '@/components/Button';
// bad — brittle, breaks when the file moves
import { Button } from '../../../components/Button';
```

bulletproof-react recommends **one** `@/*` prefix rather than many granular aliases
(`@components`, `@hooks`, …): it's shorter, needs no extra config per folder, and visually
distinguishes your source from `node_modules` imports. ([bulletproof-react][bp-std])

## Barrel-file policy: avoid arbitrary app-wide barrels

A "barrel" is an `index.ts` that re-exports a directory's contents so callers can
`import { A, B } from './feature'`. In **application code** these cause real problems
([TkDodo][tkdodo], [Hagemeister][marvin]):

- **Startup / test slowdowns.** Importing one symbol through a barrel pulls the whole
  barrel's module graph. Real cases report dev/test module counts and startup times
  ballooning (thousands of extra modules, multi-second startups) that drop dramatically
  once barrels are removed.
- **Accidental circular dependencies.** Barrels make it easy for modules in the same
  folder to import each other through the index, creating cycles that crash bundlers.
- **Fragile tree-shaking.** Bundler optimizations for barrels (e.g. Next's
  `optimizePackageImports`) only work on *pure* re-export files; one non-export statement
  in the barrel breaks them.

Guidance:

- **Don't** sprinkle `index.ts` barrels across arbitrary app directories just for prettier
  imports. Import from the concrete file.
- **A small, pure, per-feature public-API `index.ts` is acceptable** — it documents the
  feature's surface and hides internals. Keep it to re-exports only, no logic.
- **Published libraries** are the genuine exception: they need a single entry point.

## Feature isolation & public API

Each feature should expose an explicit, minimal **public API** (its entry file) and keep
internals private. Consumers import the feature's surface, not its deep files. Combined
with the `shared → features → app` dependency rule
([folder-structure.md](./folder-structure.md)), this keeps features swappable and
deletable.

Enforce the boundaries mechanically — they erode the moment they rely on discipline alone:

```js
// .eslintrc — import/no-restricted-paths (bulletproof-react)
'import/no-restricted-paths': ['error', {
  zones: [
    // features can't import other features
    { target: './src/features/a', from: './src/features', except: ['./a'] },
    // shared code can't import from features or app
    { target: './src/components', from: ['./src/features', './src/app'] },
    // enforce unidirectional flow into app
    { target: './src/features', from: './src/app' },
  ],
}]
```

(Adapt the zones to your actual feature list.) ([bulletproof-react][bp-std])

## Sources

- bulletproof-react — Project Standards (aliases, import lint zones) — https://github.com/alan2207/bulletproof-react/blob/master/docs/project-standards.md
- bulletproof-react — Project Structure (unidirectional dependencies) — https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md
- TkDodo — Please Stop Using Barrel Files — https://tkdodo.eu/blog/please-stop-using-barrel-files
- Marvin Hagemeister — Speeding up the JS ecosystem, part 7 — https://marvinh.dev/blog/speeding-up-javascript-ecosystem-part-7/

[bp-std]: https://github.com/alan2207/bulletproof-react/blob/master/docs/project-standards.md
[tkdodo]: https://tkdodo.eu/blog/please-stop-using-barrel-files
[marvin]: https://marvinh.dev/blog/speeding-up-javascript-ecosystem-part-7/
