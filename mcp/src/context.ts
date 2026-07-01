import type { Container } from '@devdigest/api/platform/container.js';

/**
 * In-process tenancy resolution (no FastifyRequest).
 *
 * The server's `getContext` needs a `FastifyRequest`; here there is none. The
 * MVP `LocalNoAuthProvider` ignores its `req` argument and caches the single
 * seeded default workspace + system user, and the `AuthProvider` interface types
 * the arg as `unknown` — so passing `undefined` is valid and resolves the same
 * default workspace every API request uses.
 */
export async function getWorkspaceId(container: Container): Promise<string> {
  const workspace = await container.auth.currentWorkspace(undefined);
  return workspace.id;
}
