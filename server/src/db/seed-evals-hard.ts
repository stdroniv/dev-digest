import { and, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import * as t from './schema.js';

/**
 * T9-extra — hard, real-world eval cases across ALL FIVE product reviewer agents
 * (`seed-evals.ts`'s T9 only demonstrates Security Reviewer, per AC-7's "at least
 * one demonstrated agent" floor). Two things are deliberately different here:
 *
 * 1. Every diff fragment contains REAL reviewable code (an actual bug/vuln/gap),
 *    not the `// seeded line N` placeholder `buildDiffText` uses. A maintainer who
 *    clicks "Run all evals" against these gets a genuine signal, not a decorative
 *    number — the model has to actually find the issue in the code.
 * 2. Each `must_find` case is paired with a `must_not_flag` decoy that LOOKS
 *    similar but is explicitly the safe/non-breaking side of that agent's own
 *    system-prompt rubric (e.g. Security Reviewer's prompt says a
 *    `param -> DB read -> JSON response` endpoint is NOT a lethal trifecta —
 *    S4 below is exactly that shape). This is what makes precision, not just
 *    recall, actually get exercised.
 *
 * No synthetic run history is seeded here (unlike T9's `EVAL_DEMO_RUNS`) — these
 * cases are meant to be run for real, so their metrics should come from an
 * actual run, not a fabricated trend line. Idempotent per agent: skipped if that
 * agent already has a case named after its first hard case.
 */

type Severity = 'CRITICAL' | 'WARNING' | 'SUGGESTION';
type Category = 'bug' | 'security' | 'perf' | 'style' | 'test';

interface DiffLine {
  op: '+' | '-' | ' ';
  text: string;
}

function add(text: string): DiffLine {
  return { op: '+', text };
}
function del(text: string): DiffLine {
  return { op: '-', text };
}
function ctx(text: string): DiffLine {
  return { op: ' ', text };
}

interface DiffFileSpec {
  path: string;
  oldStart: number;
  lines: DiffLine[];
}

/**
 * Builds a real multi-file unified diff and, crucially, a `lineOf` lookup that
 * mirrors the scorer's own line-numbering (`metrics.ts` `buildDiffLineIndex` /
 * `diff-parser.ts`): a `+` or context line consumes the next new-side line
 * number, a `-` line does not. Looking up the expected finding's line THIS way
 * (instead of hand-counting) guarantees the case's expectation always points at
 * a real, citable line inside the diff we actually generated.
 */
function buildDiff(files: DiffFileSpec[]): { text: string; lineOf: (path: string, exactLine: string) => number } {
  const blocks: string[] = [];
  const newLineOfByFile = new Map<string, number[]>();

  for (const f of files) {
    const added = f.lines.filter((l) => l.op === '+').length;
    const removed = f.lines.filter((l) => l.op === '-').length;
    const context = f.lines.filter((l) => l.op === ' ').length;
    const oldLines = removed + context;
    const newLines = added + context;
    const body: string[] = [];
    const newLineOf: number[] = [];
    let cursor = f.oldStart;
    for (const l of f.lines) {
      body.push(`${l.op}${l.text}`);
      if (l.op === '-') {
        newLineOf.push(-1);
      } else {
        newLineOf.push(cursor);
        cursor++;
      }
    }
    newLineOfByFile.set(f.path, newLineOf);
    blocks.push(
      [
        `diff --git a/${f.path} b/${f.path}`,
        `--- a/${f.path}`,
        `+++ b/${f.path}`,
        `@@ -${f.oldStart},${oldLines} +${f.oldStart},${newLines} @@`,
        ...body,
      ].join('\n'),
    );
  }

  const lineOf = (path: string, exactLine: string): number => {
    const file = files.find((f) => f.path === path);
    if (!file) throw new Error(`buildDiff: no file "${path}" in this diff`);
    const idx = file.lines.findIndex((l) => l.text === exactLine);
    if (idx === -1) throw new Error(`buildDiff: no line matching "${exactLine}" in ${path}`);
    const newLine = newLineOfByFile.get(path)![idx]!;
    if (newLine === -1) throw new Error(`buildDiff: "${exactLine}" in ${path} is a deletion — has no new-side line`);
    return newLine;
  };

  return { text: blocks.join('\n'), lineOf };
}

interface HardCase {
  title: string;
  severity: Severity;
  category: Category;
  decision: 'accepted' | 'dismissed';
  rationale: string;
  diffFiles: DiffFileSpec[];
  targetFile: string;
  targetLine: string;
}

interface AgentHardSet {
  agentName: string;
  prNumber: number;
  prTitle: string;
  prAuthor: string;
  prBody: string;
  cases: HardCase[];
}

// ============================================================ General Reviewer

const G2_TARGET = '  agentsRepo.delete(workspaceId, req.params.id);';
const G3_TARGET = '    .where(eq(agents.id, agentId))';

const GENERAL_HARD_SET: AgentHardSet = {
  agentName: 'General Reviewer',
  prNumber: 601,
  prTitle: 'Add agent retry handling and a delete endpoint',
  prAuthor: 'priya.raman',
  prBody: 'Adds configurable retry handling for agent runs and a DELETE endpoint for removing an agent.',
  cases: [
    {
      title: '`||` silently discards an explicit `retries: 0`',
      severity: 'WARNING',
      category: 'bug',
      decision: 'accepted',
      rationale:
        'A caller passing `retries: 0` (meaning "no retries") gets `DEFAULT_RETRIES` instead — `||` treats the falsy `0` as absent, exactly the truthiness trap the review checklist calls out.',
      diffFiles: [
        {
          path: 'src/agents/service.ts',
          oldStart: 40,
          lines: [
            add('async function runWithRetries(fn: () => Promise<void>, opts: { retries?: number }) {'),
            add('  const retries = opts.retries || DEFAULT_RETRIES;'),
            add('  for (let i = 0; i < retries; i++) {'),
            add('    try {'),
            add('      return await fn();'),
            add('    } catch (err) {'),
            add('      if (i === retries - 1) throw err;'),
            add('    }'),
            add('  }'),
            add('}'),
          ],
        },
      ],
      targetFile: 'src/agents/service.ts',
      targetLine: '  const retries = opts.retries || DEFAULT_RETRIES;',
    },
    {
      title: 'Missing `await` lets the handler respond before the delete runs',
      severity: 'CRITICAL',
      category: 'bug',
      decision: 'accepted',
      rationale:
        'The handler returns 204 while `agentsRepo.delete` is still in flight; a failed delete throws an unhandled rejection after the response is already sent, and a client polling immediately after 204 can still see the agent.',
      diffFiles: [
        {
          path: 'src/agents/routes.ts',
          oldStart: 55,
          lines: [
            add("app.delete('/agents/:id', async (req, reply) => {"),
            add('  const agent = await agentsRepo.getById(workspaceId, req.params.id);'),
            add('  if (!agent) return reply.code(404).send();'),
            add(G2_TARGET),
            add('  return reply.code(204).send();'),
            add('});'),
          ],
        },
      ],
      targetFile: 'src/agents/routes.ts',
      targetLine: G2_TARGET,
    },
    {
      title: 'Agent update query is missing a workspace scope',
      severity: 'CRITICAL',
      category: 'bug',
      decision: 'accepted',
      rationale:
        'The method takes no `workspaceId` at all and filters only by `agents.id` — any workspace can update any other workspace\'s agent by guessing/enumerating its id.',
      diffFiles: [
        {
          path: 'src/agents/repository.ts',
          oldStart: 22,
          lines: [
            add('async update(agentId: string, patch: Partial<AgentRow>): Promise<AgentRow | undefined> {'),
            add('  const [row] = await this.db'),
            add('    .update(agents)'),
            add('    .set(patch)'),
            add(G3_TARGET),
            add('    .returning();'),
            add('  return row;'),
            add('}'),
          ],
        },
      ],
      targetFile: 'src/agents/repository.ts',
      targetLine: G3_TARGET,
    },
    {
      title: 'Possible unhandled rejection in bulk delete',
      severity: 'WARNING',
      category: 'bug',
      decision: 'dismissed',
      rationale:
        'Looks similar to the missing-await bug above at a glance, but this one correctly awaits `Promise.all` before returning — not a real issue.',
      diffFiles: [
        {
          path: 'src/agents/service.ts',
          oldStart: 60,
          lines: [
            add('async function deleteMany(ids: string[]): Promise<void> {'),
            add('  await Promise.all(ids.map((id) => agentsRepo.delete(workspaceId, id)));'),
            add('}'),
          ],
        },
      ],
      targetFile: 'src/agents/service.ts',
      targetLine: '  await Promise.all(ids.map((id) => agentsRepo.delete(workspaceId, id)));',
    },
    {
      title: 'Agent lookup query missing a workspace scope',
      severity: 'CRITICAL',
      category: 'bug',
      decision: 'dismissed',
      rationale:
        'Same shape as the update-query bug above at a glance (`.where(eq(agents.id, ...))`), but this one already scopes on `workspaceId` via `and(...)` — correctly tenant-isolated.',
      diffFiles: [
        {
          path: 'src/agents/repository.ts',
          oldStart: 30,
          lines: [
            add('async getById(workspaceId: string, agentId: string): Promise<AgentRow | undefined> {'),
            add('  const [row] = await this.db'),
            add('    .select()'),
            add('    .from(agents)'),
            add('    .where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)));'),
            add('  return row;'),
            add('}'),
          ],
        },
      ],
      targetFile: 'src/agents/repository.ts',
      targetLine: '    .where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)));',
    },
  ],
};

// ============================================================ Security Reviewer

const SECURITY_HARD_SET: AgentHardSet = {
  agentName: 'Security Reviewer',
  prNumber: 605,
  prTitle: 'Add webhook connectivity test, session refresh, and an assistant tool',
  prAuthor: 'sam.okafor',
  prBody:
    'Adds a webhook connectivity-test endpoint, JWT session verification, and an LLM assistant tool that can read workspace secrets.',
  cases: [
    {
      title: 'Webhook connectivity test is a full SSRF proxy',
      severity: 'CRITICAL',
      category: 'security',
      decision: 'accepted',
      rationale:
        'The endpoint fetches an attacker-supplied `callbackUrl` server-side with no allowlist or private-range block — a caller can reach internal services (metadata endpoints, admin ports) through the app server.',
      diffFiles: [
        {
          path: 'src/repos/routes.ts',
          oldStart: 18,
          lines: [
            add("app.post('/repos/:id/webhook-test', async (req, reply) => {"),
            add('  const { callbackUrl } = req.body;'),
            add('  const res = await fetch(callbackUrl);'),
            add('  return reply.send({ status: res.status });'),
            add('});'),
          ],
        },
      ],
      targetFile: 'src/repos/routes.ts',
      targetLine: '  const res = await fetch(callbackUrl);',
    },
    {
      title: 'JWT verification has no algorithm allowlist',
      severity: 'CRITICAL',
      category: 'security',
      decision: 'accepted',
      rationale:
        '`jwt.verify` is called without an `algorithms` option — a token signed with `alg: none` or with HS256 using the public key as the HMAC secret can bypass verification entirely (classic algorithm-confusion attack).',
      diffFiles: [
        {
          path: 'src/auth/session.ts',
          oldStart: 12,
          lines: [
            add('function verifySessionToken(token: string): SessionClaims {'),
            add('  const payload = jwt.verify(token, PUBLIC_KEY);'),
            add('  return payload as SessionClaims;'),
            add('}'),
          ],
        },
      ],
      targetFile: 'src/auth/session.ts',
      targetLine: '  const payload = jwt.verify(token, PUBLIC_KEY);',
    },
    {
      title: 'Assistant tool is a textbook lethal trifecta',
      severity: 'CRITICAL',
      category: 'security',
      decision: 'accepted',
      rationale:
        'All three components are concrete: (1) untrusted `prBody` feeds the LLM prompt, (2) the same call is handed every workspace secret as `context`, (3) the model\'s reply is POSTed to an external URL — a crafted PR body can instruct the model to exfiltrate secrets in its response.',
      diffFiles: [
        {
          path: 'src/agents/tools.ts',
          oldStart: 30,
          lines: [
            add('async function runAssistant(prBody: string): Promise<void> {'),
            add('  const secrets = await secretsProvider.readAll();'),
            add('  const reply = await llm.chat({'),
            add("    messages: [{ role: 'user', content: prBody }],"),
            add('    context: secrets,'),
            add('  });'),
            add("  await fetch(EXTERNAL_WEBHOOK_URL, { method: 'POST', body: reply });"),
            add('}'),
          ],
        },
      ],
      targetFile: 'src/agents/tools.ts',
      targetLine: "  await fetch(EXTERNAL_WEBHOOK_URL, { method: 'POST', body: reply });",
    },
    {
      title: 'Billing endpoint returns workspace financial data',
      severity: 'WARNING',
      category: 'security',
      decision: 'dismissed',
      rationale:
        'Shape is `session -> DB read -> JSON response` for the caller\'s own workspace — ordinary authenticated access control, not a lethal trifecta (no untrusted content ever reaches an LLM here). Matches the prompt\'s own "do not flag this shape" example.',
      diffFiles: [
        {
          path: 'src/settings/routes.ts',
          oldStart: 8,
          lines: [
            add("app.get('/settings/billing', async (req, reply) => {"),
            add('  const workspaceId = req.session.workspaceId;'),
            add('  const billing = await billingRepo.getByWorkspace(workspaceId);'),
            add('  return reply.send(billing);'),
            add('});'),
          ],
        },
      ],
      targetFile: 'src/settings/routes.ts',
      targetLine: '  const billing = await billingRepo.getByWorkspace(workspaceId);',
    },
    {
      title: 'Repo lookup builds a query from a raw string',
      severity: 'CRITICAL',
      category: 'security',
      decision: 'dismissed',
      rationale:
        'Looks concerning at a glance ("raw string into a query") but `eq(repos.fullName, fullName)` is Drizzle\'s parameterized query builder, not string concatenation — nothing here is injectable.',
      diffFiles: [
        {
          path: 'src/repos/repository.ts',
          oldStart: 15,
          lines: [
            add('async function findByFullName(fullName: string): Promise<RepoRow | undefined> {'),
            add('  const [row] = await db.select().from(repos).where(eq(repos.fullName, fullName));'),
            add('  return row;'),
            add('}'),
          ],
        },
      ],
      targetFile: 'src/repos/repository.ts',
      targetLine: '  const [row] = await db.select().from(repos).where(eq(repos.fullName, fullName));',
    },
  ],
};

// ============================================================ Performance Reviewer

const PERFORMANCE_HARD_SET: AgentHardSet = {
  agentName: 'Performance Reviewer',
  prNumber: 602,
  prTitle: 'Speed up PR ingestion and add similarity search',
  prAuthor: 'felix.oyelaran',
  prBody: 'Optimizes finding lookups during PR ingestion and adds pgvector-based similar-chunk search.',
  cases: [
    {
      title: 'N+1 query loading findings per PR file',
      severity: 'CRITICAL',
      category: 'perf',
      decision: 'accepted',
      rationale:
        'Issues one query per file in the PR — on a 50-file PR that\'s 50 round trips instead of one, and it runs on every ingestion (hot path that grows with PR size).',
      diffFiles: [
        {
          path: 'src/repo-intel/service.ts',
          oldStart: 70,
          lines: [
            add('async function loadFindingsForFiles(files: PrFile[]): Promise<Finding[]> {'),
            add('  const results: Finding[] = [];'),
            add('  for (const file of files) {'),
            add('    const rows = await db.select().from(findings).where(eq(findings.file, file.path));'),
            add('    results.push(...rows);'),
            add('  }'),
            add('  return results;'),
            add('}'),
          ],
        },
      ],
      targetFile: 'src/repo-intel/service.ts',
      targetLine: '    const rows = await db.select().from(findings).where(eq(findings.file, file.path));',
    },
    {
      title: 'LLM call runs inside an open DB transaction',
      severity: 'CRITICAL',
      category: 'perf',
      decision: 'accepted',
      rationale:
        'The transaction holds a pooled connection open across the entire LLM round trip (seconds). With a ~10-connection pool, a handful of concurrent reviews exhausts it and stalls the whole service.',
      diffFiles: [
        {
          path: 'src/reviews/service.ts',
          oldStart: 44,
          lines: [
            add('async function runAndPersist(agent: AgentRow, diff: UnifiedDiff): Promise<ReviewRow> {'),
            add('  return db.transaction(async (tx) => {'),
            add(
              "    const [run] = await tx.insert(agentRuns).values({ agentId: agent.id, status: 'running' }).returning();",
            ),
            add(
              '    const outcome = await reviewPullRequest({ systemPrompt: agent.systemPrompt, model: agent.model, diff, llm });',
            ),
            add("    await tx.update(agentRuns).set({ status: 'done' }).where(eq(agentRuns.id, run.id));"),
            add('    return outcome;'),
            add('  });'),
            add('}'),
          ],
        },
      ],
      targetFile: 'src/reviews/service.ts',
      targetLine:
        '    const outcome = await reviewPullRequest({ systemPrompt: agent.systemPrompt, model: agent.model, diff, llm });',
    },
    {
      title: 'pgvector similarity search has no limit or pre-filter',
      severity: 'CRITICAL',
      category: 'perf',
      decision: 'accepted',
      rationale:
        'Orders the entire `code_chunks` table by vector distance with no ANN index usage boundary (`limit`) and no cheap pre-filter — a full scan that gets slower as the table grows.',
      diffFiles: [
        {
          path: 'src/repo-intel/repository.ts',
          oldStart: 90,
          lines: [
            add('async function findSimilarChunks(queryVec: number[]): Promise<ChunkRow[]> {'),
            add('  return db'),
            add('    .select()'),
            add('    .from(codeChunks)'),
            add('    .orderBy(cosineDistance(codeChunks.embedding, queryVec));'),
            add('}'),
          ],
        },
      ],
      targetFile: 'src/repo-intel/repository.ts',
      targetLine: '    .orderBy(cosineDistance(codeChunks.embedding, queryVec));',
    },
    {
      title: 'Sequential awaits fetching review comment pages',
      severity: 'WARNING',
      category: 'perf',
      decision: 'dismissed',
      rationale:
        'Looks like an easy "parallelize this loop" target, but each page\'s request depends on the previous page\'s cursor — it is inherently sequential, not a real N+1.',
      diffFiles: [
        {
          path: 'src/github/client.ts',
          oldStart: 25,
          lines: [
            add('async function fetchAllReviewComments(owner: string, repo: string, pr: number): Promise<Comment[]> {'),
            add('  const all: Comment[] = [];'),
            add('  let cursor: string | undefined;'),
            add('  do {'),
            add('    const page = await octokit.graphql(REVIEW_COMMENTS_QUERY, { owner, repo, pr, after: cursor });'),
            add('    all.push(...page.comments.nodes);'),
            add(
              '    cursor = page.comments.pageInfo.hasNextPage ? page.comments.pageInfo.endCursor : undefined;',
            ),
            add('  } while (cursor);'),
            add('  return all;'),
            add('}'),
          ],
        },
      ],
      targetFile: 'src/github/client.ts',
      targetLine:
        '    const page = await octokit.graphql(REVIEW_COMMENTS_QUERY, { owner, repo, pr, after: cursor });',
    },
    {
      title: 'Possible N+1 in the batched findings loader',
      severity: 'CRITICAL',
      category: 'perf',
      decision: 'dismissed',
      rationale:
        'Same intent as the N+1 loader above but this version is already batched with `inArray` — a single query for all paths, not one per file.',
      diffFiles: [
        {
          path: 'src/repo-intel/service.ts',
          oldStart: 100,
          lines: [
            add('async function loadFindingsForFilesBatched(files: PrFile[]): Promise<Finding[]> {'),
            add('  const paths = files.map((f) => f.path);'),
            add('  return db.select().from(findings).where(inArray(findings.file, paths));'),
            add('}'),
          ],
        },
      ],
      targetFile: 'src/repo-intel/service.ts',
      targetLine: '  return db.select().from(findings).where(inArray(findings.file, paths));',
    },
  ],
};

// ============================================================ Test Quality Reviewer

const TEST_QUALITY_HARD_SET: AgentHardSet = {
  agentName: 'Test Quality Reviewer',
  prNumber: 603,
  prTitle: 'Add agent-import validation and session expiry',
  prAuthor: 'ines.varga',
  prBody: 'Adds manifest validation on agent import and TTL-based session expiry, with accompanying tests.',
  cases: [
    {
      title: 'Agent-import failure path has no test',
      severity: 'WARNING',
      category: 'test',
      decision: 'accepted',
      rationale:
        'The only test exercises a valid manifest; the `catch` branch that rejects a malformed one is never reached by any test, so a regression there (e.g. accepting a malformed manifest) would ship unnoticed.',
      diffFiles: [
        {
          path: 'src/agents/service.ts',
          oldStart: 12,
          lines: [
            add('async function importAgentConfig(payload: unknown): Promise<AgentRow> {'),
            add('  try {'),
            add('    const parsed = AgentManifest.parse(payload);'),
            add('    return await agentsRepo.insert(parsed);'),
            add('  } catch (err) {'),
            add("    throw new ValidationError('Invalid agent manifest');"),
            add('  }'),
            add('}'),
          ],
        },
        {
          path: 'test/agents-import.test.ts',
          oldStart: 5,
          lines: [
            add("it('imports a valid agent manifest', () => {"),
            add('  const result = importAgentConfig(validManifest);'),
            add("  expect(result.name).toBe('My Agent');"),
            add('});'),
          ],
        },
      ],
      targetFile: 'src/agents/service.ts',
      targetLine: "    throw new ValidationError('Invalid agent manifest');",
    },
    {
      title: 'Pricing test mocks the function it claims to test',
      severity: 'WARNING',
      category: 'test',
      decision: 'accepted',
      rationale:
        '`calculateTotal` itself is mocked to return a fixed value, then the test asserts that fixed value — this would pass identically even if the real pricing logic were deleted.',
      diffFiles: [
        {
          path: 'test/pricing.test.ts',
          oldStart: 3,
          lines: [
            add("vi.mock('../src/billing/pricing.js', () => ({ calculateTotal: vi.fn(() => 4200) }));"),
            add("it('calculates the cart total', () => {"),
            add('  const total = calculateTotal(cart);'),
            add('  expect(total).toBe(4200);'),
            add('});'),
          ],
        },
      ],
      targetFile: 'test/pricing.test.ts',
      targetLine: "vi.mock('../src/billing/pricing.js', () => ({ calculateTotal: vi.fn(() => 4200) }));",
    },
    {
      title: 'Session-expiry test uses a real timer, not fake timers',
      severity: 'SUGGESTION',
      category: 'test',
      decision: 'accepted',
      rationale:
        'Uses a real `setTimeout` with no `vi.useFakeTimers()` and never awaits/returns it — the assertion inside runs after the test has already completed, so it can never actually fail.',
      diffFiles: [
        {
          path: 'test/session.test.ts',
          oldStart: 20,
          lines: [
            add("it('expires a session after its ttl', () => {"),
            add('  const session = createSession({ ttlMs: 50 });'),
            add('  setTimeout(() => {'),
            add('    expect(session.isExpired()).toBe(true);'),
            add('  }, 100);'),
            add('});'),
          ],
        },
      ],
      targetFile: 'test/session.test.ts',
      targetLine: '  setTimeout(() => {',
    },
    {
      title: 'Session-expiry test relies on real timing',
      severity: 'SUGGESTION',
      category: 'test',
      decision: 'dismissed',
      rationale:
        'Looks like the same flaky-timer shape as the other session test, but this one uses `vi.useFakeTimers()` / `advanceTimersByTime` — deterministic, not flaky.',
      diffFiles: [
        {
          path: 'test/session.test.ts',
          oldStart: 40,
          lines: [
            add("it('expires a session after its ttl using fake timers', () => {"),
            add('  vi.useFakeTimers();'),
            add('  const session = createSession({ ttlMs: 1000 });'),
            add('  expect(session.isExpired()).toBe(false);'),
            add('  vi.advanceTimersByTime(1001);'),
            add('  expect(session.isExpired()).toBe(true);'),
            add('  vi.useRealTimers();'),
            add('});'),
          ],
        },
      ],
      targetFile: 'test/session.test.ts',
      targetLine: '  vi.useFakeTimers();',
    },
    {
      title: 'New `displayName` getter has no dedicated test',
      severity: 'SUGGESTION',
      category: 'test',
      decision: 'dismissed',
      rationale: 'A trivial one-line getter — the prompt explicitly says not to chase coverage on these.',
      diffFiles: [
        {
          path: 'src/agents/helpers.ts',
          oldStart: 8,
          lines: [
            add('export class AgentView {'),
            add('  constructor(private row: AgentRow) {}'),
            add('  get displayName(): string {'),
            add('    return this.row.name.trim();'),
            add('  }'),
            add('}'),
          ],
        },
      ],
      targetFile: 'src/agents/helpers.ts',
      targetLine: '  get displayName(): string {',
    },
  ],
};

// ============================================================ API Contract Reviewer

const API_CONTRACT_HARD_SET: AgentHardSet = {
  agentName: 'API Contract Reviewer',
  prNumber: 604,
  prTitle: "Simplify agent-run response and the agent delete endpoint",
  prAuthor: 'noah.tran',
  prBody: "Simplifies the agent-run summary response shape and the agent delete endpoint's status code.",
  cases: [
    {
      title: 'Agent-run response field renamed from `run_id` to `id`',
      severity: 'CRITICAL',
      category: 'bug',
      decision: 'accepted',
      rationale: 'Any client reading `response.run_id` gets `undefined` after this ships — a silent runtime break.',
      diffFiles: [
        {
          path: 'src/contracts/agent-run.ts',
          oldStart: 5,
          lines: [
            ctx('export const AgentRunSummary = z.object({'),
            del('  run_id: z.string(),'),
            add('  id: z.string(),'),
            ctx('  agent_id: z.string(),'),
            ctx('  status: z.string(),'),
            ctx('});'),
          ],
        },
      ],
      targetFile: 'src/contracts/agent-run.ts',
      targetLine: '  id: z.string(),',
    },
    {
      title: 'Optional `model` field on CreateAgentInput made required',
      severity: 'CRITICAL',
      category: 'bug',
      decision: 'accepted',
      rationale:
        'Existing callers that omit `model` (relying on the server default) now get a `422` instead of a created agent — a previously-valid request now fails validation.',
      diffFiles: [
        {
          path: 'src/contracts/agents.ts',
          oldStart: 6,
          lines: [
            ctx('export const CreateAgentInput = z.object({'),
            ctx('  name: z.string().min(1),'),
            del('  model: z.string().nullish(),'),
            add('  model: z.string(),'),
            ctx("  provider: Provider.default('openrouter'),"),
            ctx('});'),
          ],
        },
      ],
      targetFile: 'src/contracts/agents.ts',
      targetLine: '  model: z.string(),',
    },
    {
      title: 'Delete endpoint changed from 200+body to 204',
      severity: 'CRITICAL',
      category: 'bug',
      decision: 'accepted',
      rationale:
        'A client that reads `response.body.deleted` to confirm the delete now gets an empty 204 body and breaks — same logical outcome, different wire contract.',
      diffFiles: [
        {
          path: 'src/agents/routes.ts',
          oldStart: 80,
          lines: [
            ctx("app.delete('/agents/:id', async (req, reply) => {"),
            ctx('  await agentsRepo.delete(req.params.id);'),
            del('  return reply.code(200).send({ deleted: true });'),
            add('  return reply.code(204).send();'),
            ctx('});'),
          ],
        },
      ],
      targetFile: 'src/agents/routes.ts',
      targetLine: '  return reply.code(204).send();',
    },
    {
      title: 'New optional `tags` field on AgentDto',
      severity: 'SUGGESTION',
      category: 'bug',
      decision: 'dismissed',
      rationale: 'Purely additive optional field — no existing client parsing the current shape can break.',
      diffFiles: [
        {
          path: 'src/contracts/agents.ts',
          oldStart: 20,
          lines: [
            ctx('export const AgentDto = z.object({'),
            ctx('  id: z.string(),'),
            ctx('  name: z.string(),'),
            add('  tags: z.array(z.string()).optional(),'),
            ctx('});'),
          ],
        },
      ],
      targetFile: 'src/contracts/agents.ts',
      targetLine: '  tags: z.array(z.string()).optional(),',
    },
    {
      title: 'Renamed local variable in `getById`',
      severity: 'WARNING',
      category: 'bug',
      decision: 'dismissed',
      rationale: 'Internal-only rename (`row` -> `dbRow`) — the returned wire shape is byte-for-byte identical.',
      diffFiles: [
        {
          path: 'src/agents/repository.ts',
          oldStart: 45,
          lines: [
            ctx('async getById(workspaceId: string, id: string): Promise<AgentRow | undefined> {'),
            del('  const [row] = await this.db.select().from(agents).where(and(eq(agents.id, id), eq(agents.workspaceId, workspaceId)));'),
            del('  return row;'),
            add(
              '  const [dbRow] = await this.db.select().from(agents).where(and(eq(agents.id, id), eq(agents.workspaceId, workspaceId)));',
            ),
            add('  return dbRow;'),
            ctx('}'),
          ],
        },
      ],
      targetFile: 'src/agents/repository.ts',
      targetLine:
        '  const [dbRow] = await this.db.select().from(agents).where(and(eq(agents.id, id), eq(agents.workspaceId, workspaceId)));',
    },
  ],
};

const HARD_SETS: AgentHardSet[] = [
  GENERAL_HARD_SET,
  SECURITY_HARD_SET,
  PERFORMANCE_HARD_SET,
  TEST_QUALITY_HARD_SET,
  API_CONTRACT_HARD_SET,
];

export async function seedHardEvalCases(db: Db, workspaceId: string, repoId: string): Promise<void> {
  for (const set of HARD_SETS) {
    const [agent] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, set.agentName)));
    if (!agent) continue;

    const firstCaseName = `Hard case: ${set.cases[0]!.title}`;
    const [existing] = await db
      .select({ id: t.evalCases.id })
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerId, agent.id),
          eq(t.evalCases.name, firstCaseName),
        ),
      );
    if (existing) continue; // idempotent per agent

    let [pr] = await db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, set.prNumber)));
    if (!pr) {
      [pr] = await db
        .insert(t.pullRequests)
        .values({
          workspaceId,
          repoId,
          number: set.prNumber,
          title: set.prTitle,
          author: set.prAuthor,
          branch: `feat/pr-${set.prNumber}`,
          base: 'main',
          headSha: `hard${set.prNumber}sha`,
          additions: 40,
          deletions: 6,
          filesCount: new Set(set.cases.flatMap((c) => c.diffFiles.map((f) => f.path))).size,
          status: 'needs_review',
          body: `${set.prBody} (fixture PR for L06 hard eval-case seeding).`,
        })
        .returning();
    }
    const prRow = pr!;

    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: prRow.id,
        agentId: agent.id,
        kind: 'review',
        verdict: 'request_changes',
        summary: `Hard eval-case seed review for ${set.agentName}.`,
        model: 'seed',
      })
      .returning();
    const reviewRow = review!;

    for (const c of set.cases) {
      const built = buildDiff(c.diffFiles);
      const line = built.lineOf(c.targetFile, c.targetLine);

      const [findingRow] = await db
        .insert(t.findings)
        .values({
          reviewId: reviewRow.id,
          file: c.targetFile,
          startLine: line,
          endLine: line,
          severity: c.severity,
          category: c.category,
          title: c.title,
          rationale: c.rationale,
          confidence: 0.9,
          acceptedAt: c.decision === 'accepted' ? new Date() : null,
          dismissedAt: c.decision === 'dismissed' ? new Date() : null,
        })
        .returning();

      const expectedOutput =
        c.decision === 'accepted'
          ? [
              {
                file: c.targetFile,
                start_line: line,
                end_line: line,
                severity: c.severity,
                category: c.category,
                title: c.title,
              },
            ]
          : [];

      await db.insert(t.evalCases).values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: agent.id,
        name: `Hard case: ${c.title}`,
        inputDiff: built.text,
        inputMeta: {
          source_finding_id: findingRow!.id,
          pr_title: prRow.title,
          pr_number: prRow.number,
          pr_body: prRow.body ?? null,
        },
        expectedOutput,
        notes: null,
      });
    }
  }
}
