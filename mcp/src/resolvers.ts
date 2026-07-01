import { RepoRepository, type RepoRow } from '@devdigest/api/modules/repos/repository.js';
import type { PullRow } from '@devdigest/api/db/rows.js';
import type { Agent } from '@devdigest/shared';
import { McpToolError } from './errors.js';
import type { ToolDeps } from './deps.js';

/**
 * Identifier resolution — turn the human-readable handles the tools accept
 * (`owner/repo#number`, `owner/repo`, agent name) into the internal UUIDs the
 * services expect. Every not-found path throws an `McpToolError` with an
 * actionable message (mapped to an `isError` result by `runTool`), never a raw
 * protocol throw.
 *
 * Onion note: reaching `RepoRepository.findByFullName` / `reviewRepo` directly is
 * a legal Presentation→Infrastructure (inward) arrow — read-only resolution that
 * mirrors how the server's own container already exposes `agentsRepo`/`reviewRepo`.
 */

export interface PrRef {
  owner: string;
  name: string;
  fullName: string;
  number: number;
}

export interface RepoRef {
  owner: string;
  name: string;
  fullName: string;
}

const PR_REF_RE = /^([^/]+)\/([^#]+)#(\d+)$/;
const REPO_REF_RE = /^([^/]+)\/([^/#]+)$/;

/** Parse `owner/repo#number` → its parts. Throws `McpToolError` if malformed. */
export function parsePrRef(pr: string): PrRef {
  const m = PR_REF_RE.exec(pr.trim());
  if (!m) {
    throw new McpToolError(
      `Could not parse '${pr}'. Use owner/repo#number, e.g. acme/payments-api#482.`,
    );
  }
  const [, owner, name, numberStr] = m;
  return {
    owner: owner!,
    name: name!,
    fullName: `${owner}/${name}`,
    number: Number(numberStr),
  };
}

/** Parse `owner/repo` → its parts. Throws `McpToolError` if malformed. */
export function parseRepoRef(repo: string): RepoRef {
  const m = REPO_REF_RE.exec(repo.trim());
  if (!m) {
    throw new McpToolError(`Could not parse '${repo}'. Use owner/repo, e.g. acme/payments-api.`);
  }
  const [, owner, name] = m;
  return { owner: owner!, name: name!, fullName: `${owner}/${name}` };
}

/** Resolve a repo by `owner/repo`. Throws `McpToolError` if not imported. */
export async function resolveRepo(
  deps: ToolDeps,
  workspaceId: string,
  ref: RepoRef,
): Promise<RepoRow> {
  const repoRepo = new RepoRepository(deps.container.db);
  const repo = await repoRepo.findByFullName(workspaceId, ref.fullName);
  if (!repo) {
    throw new McpToolError(
      `Repo '${ref.fullName}' is not imported. Add it in the DevDigest web UI first.`,
    );
  }
  return repo;
}

/** Resolve a PR by `owner/repo#number`: repo first, then PR. */
export async function resolvePull(
  deps: ToolDeps,
  workspaceId: string,
  ref: PrRef,
): Promise<{ repo: RepoRow; pull: PullRow }> {
  const repo = await resolveRepo(deps, workspaceId, ref);
  const pull = await deps.container.reviewRepo.getPullByNumber(workspaceId, repo.id, ref.number);
  if (!pull) {
    throw new McpToolError(
      `PR #${ref.number} not found in '${ref.fullName}'. Import the PR first.`,
    );
  }
  return { repo, pull };
}

/** Resolve an agent by name (case-insensitive). Throws if not found. */
export async function resolveAgentByName(
  deps: ToolDeps,
  workspaceId: string,
  name: string,
): Promise<Agent> {
  const agents = await deps.services.agents.list(workspaceId);
  const wanted = name.trim().toLowerCase();
  const agent = agents.find((a) => a.name.toLowerCase() === wanted);
  if (!agent) {
    throw new McpToolError(
      `Agent '${name}' not found. Call devdigest_list_agents to see available agents.`,
    );
  }
  return agent;
}
