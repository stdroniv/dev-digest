#!/usr/bin/env node
// Thin launcher: exec `tsx src/index.ts` so the package runs straight from
// TypeScript source (the repo consumes TS as source — no JS build step, mirroring
// how `server` runs `tsx src/server.ts`). stdout stays the JSON-RPC channel; tsx
// itself writes nothing there.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, '..', 'src', 'index.ts');
const tsx = join(here, '..', 'node_modules', '.bin', 'tsx');

// Pin cwd to the mcp/ package dir so `tsx` resolves `mcp/tsconfig.json` (and its
// `@devdigest/*` path aliases) regardless of the caller's cwd. MCP clients spawn
// this shim from the project root, where those aliases would otherwise be
// unresolvable and the server would crash on boot.
const child = spawn(tsx, [entry], { stdio: 'inherit', cwd: join(here, '..') });
child.on('exit', (code) => process.exit(code ?? 0));
