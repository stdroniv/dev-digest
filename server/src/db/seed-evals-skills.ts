import { and, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import * as t from './schema.js';
import { add, ctx, del, buildDiff, type Category, type DiffFileSpec, type Severity } from './seed-evals-diff.js';

/**
 * L06 — eval cases for the API Contract Reviewer's four granular SKILLS
 * (`breaking-change`, `response-schema`, `semver-discipline`,
 * `deprecation-policy`; seeded in `seed-skills.ts`). Mirrors the philosophy of
 * `seed-evals-hard.ts`:
 *
 * 1. Every diff fragment carries REAL reviewable code (an actual contract break),
 *    not a `// seeded line N` placeholder — a maintainer who clicks "Run all
 *    evals" against a skill gets a genuine signal, not a decorative number.
 * 2. Each `must_find` case is paired with `must_not_flag` decoys that are the
 *    explicit SAFE side of that skill's own good/bad boundary (additive fields,
 *    a break carried on `/v2`, a properly-annotated deprecation) — so precision,
 *    not just recall, actually gets exercised.
 *
 * A skill eval case runs `GENERAL_REVIEWER_PROMPT` + the skill body against the
 * frozen `input_diff` (`EvalService.runSkillCase`); the scorer matches findings
 * to `expected_output` by file + line-range overlap only. Idempotent per skill:
 * skipped if that skill already has any eval case. Skills seeded ENABLED, so the
 * run path (which refuses a disabled skill's body) can execute them.
 */

interface SkillEvalCase {
  name: string;
  /** Human-readable title, frozen into `input_meta.title` and (for must_find)
   *  the expected finding's `title`. */
  title: string;
  severity: Severity;
  category: Category;
  /** `true` → must_find (one expected finding at `targetLine`); `false` →
   *  must_not_flag (`expected_output: []`). */
  mustFind: boolean;
  diffFiles: DiffFileSpec[];
  /** Required when `mustFind` — the new-side line the expected finding cites. */
  targetFile?: string;
  targetLine?: string;
}

interface SkillEvalSet {
  skillName: string;
  cases: SkillEvalCase[];
}

// ============================================================ breaking-change

const BREAKING_CHANGE_SET: SkillEvalSet = {
  skillName: 'breaking-change',
  cases: [
    {
      name: 'response-field-renamed-must-find',
      title: 'Response field `fullName` renamed to `name` on GET /users/:id',
      severity: 'CRITICAL',
      category: 'bug',
      mustFind: true,
      diffFiles: [
        {
          path: 'src/api/users.ts',
          oldStart: 20,
          lines: [
            ctx("app.get('/users/:id', async (req, reply) => {"),
            ctx('  const user = await usersRepo.getById(req.params.id);'),
            del('  return reply.send({ id: user.id, fullName: user.fullName });'),
            add('  return reply.send({ id: user.id, name: user.fullName });'),
            ctx('});'),
          ],
        },
      ],
      targetFile: 'src/api/users.ts',
      targetLine: '  return reply.send({ id: user.id, name: user.fullName });',
    },
    {
      name: 'new-required-request-field-must-find',
      title: 'New required request field `tenantId` rejects existing callers (422)',
      severity: 'CRITICAL',
      category: 'bug',
      mustFind: true,
      diffFiles: [
        {
          path: 'src/contracts/signup.ts',
          oldStart: 4,
          lines: [
            ctx('export const SignupBody = z.object({'),
            ctx('  email: z.string().email(),'),
            ctx('  password: z.string().min(8),'),
            add('  tenantId: z.string(),'),
            ctx('});'),
          ],
        },
      ],
      targetFile: 'src/contracts/signup.ts',
      targetLine: '  tenantId: z.string(),',
    },
    {
      name: 'route-path-renamed-must-find',
      title: 'Route `/users/:id/profile` renamed to `/users/:id/card` (old URL 404s)',
      severity: 'CRITICAL',
      category: 'bug',
      mustFind: true,
      diffFiles: [
        {
          path: 'src/api/profile.ts',
          oldStart: 6,
          lines: [
            del("app.get('/users/:id/profile', getProfile);"),
            add("app.get('/users/:id/card', getProfile);"),
          ],
        },
      ],
      targetFile: 'src/api/profile.ts',
      targetLine: "app.get('/users/:id/card', getProfile);",
    },
    {
      name: 'optional-request-field-made-required-must-find',
      title: 'Optional request field `secret` made required on webhook registration',
      severity: 'CRITICAL',
      category: 'bug',
      mustFind: true,
      diffFiles: [
        {
          path: 'src/contracts/webhooks.ts',
          oldStart: 3,
          lines: [
            ctx('export const RegisterWebhook = z.object({'),
            ctx('  url: z.string().url(),'),
            del('  secret: z.string().optional(),'),
            add('  secret: z.string(),'),
            ctx('});'),
          ],
        },
      ],
      targetFile: 'src/contracts/webhooks.ts',
      targetLine: '  secret: z.string(),',
    },
    {
      name: 'new-optional-request-field-must-not-flag',
      title: 'New OPTIONAL request field `pronouns` — additive, backward-compatible',
      severity: 'SUGGESTION',
      category: 'bug',
      mustFind: false,
      diffFiles: [
        {
          path: 'src/contracts/profile.ts',
          oldStart: 10,
          lines: [
            ctx('export const UpdateProfileBody = z.object({'),
            ctx('  displayName: z.string(),'),
            add('  pronouns: z.string().optional(),'),
            ctx('});'),
          ],
        },
      ],
    },
    {
      name: 'old-field-kept-alongside-new-must-not-flag',
      title: 'Old response field `fullName` kept alongside the new `name` — additive',
      severity: 'SUGGESTION',
      category: 'bug',
      mustFind: false,
      diffFiles: [
        {
          path: 'src/api/users.ts',
          oldStart: 50,
          lines: [
            del('  return reply.send({ id: user.id, fullName: user.fullName });'),
            add('  return reply.send({ id: user.id, fullName: user.fullName, name: user.fullName });'),
          ],
        },
      ],
    },
    {
      name: 'brand-new-route-must-not-flag',
      title: 'Brand-new route `/orders/:id/receipt` — nothing existing changed',
      severity: 'SUGGESTION',
      category: 'bug',
      mustFind: false,
      diffFiles: [
        {
          path: 'src/api/orders.ts',
          oldStart: 40,
          lines: [
            ctx("app.get('/orders/:id', getOrder);"),
            add("app.get('/orders/:id/receipt', getReceipt);"),
          ],
        },
      ],
    },
  ],
};

// ============================================================ response-schema

const RESPONSE_SCHEMA_SET: SkillEvalSet = {
  skillName: 'response-schema',
  cases: [
    {
      name: 'response-field-renamed-must-find',
      title: 'Response field `verdict` renamed to `decision` — client reads undefined',
      severity: 'CRITICAL',
      category: 'bug',
      mustFind: true,
      diffFiles: [
        {
          path: 'src/reviews/serialize.ts',
          oldStart: 12,
          lines: [
            ctx('function toReviewDto(row: ReviewRow) {'),
            del('  return { id: row.id, verdict: row.verdict, createdAt: row.createdAt.toISOString() };'),
            add('  return { id: row.id, decision: row.verdict, createdAt: row.createdAt.toISOString() };'),
            ctx('}'),
          ],
        },
      ],
      targetFile: 'src/reviews/serialize.ts',
      targetLine: '  return { id: row.id, decision: row.verdict, createdAt: row.createdAt.toISOString() };',
    },
    {
      name: 'envelope-shape-changed-must-find',
      title: 'Response envelope changed from `{ items, nextCursor }` to `{ data, page }`',
      severity: 'CRITICAL',
      category: 'bug',
      mustFind: true,
      diffFiles: [
        {
          path: 'src/findings/list.ts',
          oldStart: 20,
          lines: [
            ctx('  const { items, nextCursor } = await findingsRepo.page(query);'),
            del('  return reply.send({ items, nextCursor });'),
            add('  return reply.send({ data: items, page: { next: nextCursor } });'),
          ],
        },
      ],
      targetFile: 'src/findings/list.ts',
      targetLine: '  return reply.send({ data: items, page: { next: nextCursor } });',
    },
    {
      name: 'nullability-flip-must-find',
      title: '`verifiedAt` flipped from always-present to conditionally omitted',
      severity: 'WARNING',
      category: 'bug',
      mustFind: true,
      diffFiles: [
        {
          path: 'src/users/serialize.ts',
          oldStart: 8,
          lines: [
            del('  return { id, email, verifiedAt };'),
            add('  return { id, email, ...(verifiedAt ? { verifiedAt } : {}) };'),
          ],
        },
      ],
      targetFile: 'src/users/serialize.ts',
      targetLine: '  return { id, email, ...(verifiedAt ? { verifiedAt } : {}) };',
    },
    {
      name: 'date-serialization-changed-must-find',
      title: '`occurredAt` serialization changed from ISO string to epoch millis',
      severity: 'WARNING',
      category: 'bug',
      mustFind: true,
      diffFiles: [
        {
          path: 'src/events/serialize.ts',
          oldStart: 15,
          lines: [
            del('  return { id: e.id, occurredAt: e.occurredAt.toISOString() };'),
            add('  return { id: e.id, occurredAt: e.occurredAt.getTime() };'),
          ],
        },
      ],
      targetFile: 'src/events/serialize.ts',
      targetLine: '  return { id: e.id, occurredAt: e.occurredAt.getTime() };',
    },
    {
      name: 'new-optional-response-field-must-not-flag',
      title: 'New `totalCount` added, `items`/`nextCursor` untouched — additive',
      severity: 'SUGGESTION',
      category: 'bug',
      mustFind: false,
      diffFiles: [
        {
          path: 'src/findings/list.ts',
          oldStart: 40,
          lines: [
            del('  return reply.send({ items, nextCursor });'),
            add('  return reply.send({ items, nextCursor, totalCount });'),
          ],
        },
      ],
    },
    {
      name: 'internal-rename-same-shape-must-not-flag',
      title: 'Internal variable rename — response wire shape byte-identical',
      severity: 'SUGGESTION',
      category: 'bug',
      mustFind: false,
      diffFiles: [
        {
          path: 'src/reviews/serialize.ts',
          oldStart: 30,
          lines: [
            ctx('function toReviewSummary(row: ReviewRow) {'),
            del('  const dto = { id: row.id, verdict: row.verdict };'),
            del('  return dto;'),
            add('  const summary = { id: row.id, verdict: row.verdict };'),
            add('  return summary;'),
            ctx('}'),
          ],
        },
      ],
    },
    {
      name: 'response-keys-reordered-must-not-flag',
      title: 'Response keys reordered — same keys, same shape',
      severity: 'SUGGESTION',
      category: 'bug',
      mustFind: false,
      diffFiles: [
        {
          path: 'src/users/serialize.ts',
          oldStart: 60,
          lines: [
            del('  return { email, id, verifiedAt };'),
            add('  return { id, email, verifiedAt };'),
          ],
        },
      ],
    },
  ],
};

// ============================================================ semver-discipline

const SEMVER_DISCIPLINE_SET: SkillEvalSet = {
  skillName: 'semver-discipline',
  cases: [
    {
      name: 'v1-retyped-in-place-must-find',
      title: '`/v1/orders` response retyped in place instead of on a new `/v2`',
      severity: 'CRITICAL',
      category: 'bug',
      mustFind: true,
      diffFiles: [
        {
          path: 'src/api/v1/orders.ts',
          oldStart: 10,
          lines: [
            del("app.get('/v1/orders/:id', async () => ({ total: cents }));"),
            add("app.get('/v1/orders/:id', async () => ({ total: { amount: cents, currency } }));"),
          ],
        },
      ],
      targetFile: 'src/api/v1/orders.ts',
      targetLine: "app.get('/v1/orders/:id', async () => ({ total: { amount: cents, currency } }));",
    },
    {
      name: 'incompatible-export-patch-bump-must-find',
      title: 'Incompatible export change shipped as a patch bump 2.4.2 (needs 3.0.0)',
      severity: 'WARNING',
      category: 'bug',
      mustFind: true,
      diffFiles: [
        {
          path: 'src/index.ts',
          oldStart: 5,
          lines: [
            ctx('export interface OrderDto {'),
            del('  total: number;'),
            add('  total: { amount: number; currency: string };'),
            ctx('}'),
          ],
        },
        {
          path: 'package.json',
          oldStart: 2,
          lines: [
            ctx('  "name": "@acme/orders-contract",'),
            del('  "version": "2.4.1",'),
            add('  "version": "2.4.2",'),
            ctx('  "main": "dist/index.js",'),
          ],
        },
      ],
      targetFile: 'package.json',
      targetLine: '  "version": "2.4.2",',
    },
    {
      name: 'v1-response-nested-in-place-must-find',
      title: '`/v1/users` response nested in place on the versioned path',
      severity: 'CRITICAL',
      category: 'bug',
      mustFind: true,
      diffFiles: [
        {
          path: 'src/api/v1/users.ts',
          oldStart: 8,
          lines: [
            ctx("app.get('/v1/users/:id', async (req, reply) => {"),
            ctx('  const user = await repo.get(req.params.id);'),
            del('  return reply.send({ id: user.id, name: user.name });'),
            add('  return reply.send({ id: user.id, profile: { name: user.name } });'),
            ctx('});'),
          ],
        },
      ],
      targetFile: 'src/api/v1/users.ts',
      targetLine: '  return reply.send({ id: user.id, profile: { name: user.name } });',
    },
    {
      name: 'break-carried-on-v2-must-not-flag',
      title: 'Break carried on a new `/v2` path, `/v1` left working — correct',
      severity: 'SUGGESTION',
      category: 'bug',
      mustFind: false,
      diffFiles: [
        {
          path: 'src/api/orders.ts',
          oldStart: 20,
          lines: [
            ctx("app.get('/v1/orders/:id', () => ({ total: cents }));"),
            add("app.get('/v2/orders/:id', () => ({ total: { amount, currency } }));"),
          ],
        },
      ],
    },
    {
      name: 'additive-field-on-v1-must-not-flag',
      title: 'Additive optional field on `/v1` — a minor change, allowed in place',
      severity: 'SUGGESTION',
      category: 'bug',
      mustFind: false,
      diffFiles: [
        {
          path: 'src/api/v1/orders.ts',
          oldStart: 30,
          lines: [
            del('  return reply.send({ id, total });'),
            add('  return reply.send({ id, total, currency });'),
          ],
        },
      ],
    },
    {
      name: 'minor-bump-for-additive-must-not-flag',
      title: 'Minor version bump 2.5.0 for an additive-only change — correct',
      severity: 'SUGGESTION',
      category: 'bug',
      mustFind: false,
      diffFiles: [
        {
          path: 'package.json',
          oldStart: 2,
          lines: [
            ctx('  "name": "@acme/orders-contract",'),
            del('  "version": "2.4.1",'),
            add('  "version": "2.5.0",'),
            ctx('  "main": "dist/index.js",'),
          ],
        },
      ],
    },
  ],
};

// ============================================================ deprecation-policy

const DEPRECATION_POLICY_SET: SkillEvalSet = {
  skillName: 'deprecation-policy',
  cases: [
    {
      name: 'field-silently-removed-must-find',
      title: '`legacyToken` silently removed from the response with no window',
      severity: 'CRITICAL',
      category: 'bug',
      mustFind: true,
      diffFiles: [
        {
          path: 'src/users/serialize.ts',
          oldStart: 10,
          lines: [
            ctx('function toUserDto(u: UserRow) {'),
            del('  return { id: u.id, email: u.email, legacyToken: u.legacyToken };'),
            add('  return { id: u.id, email: u.email };'),
            ctx('}'),
          ],
        },
      ],
      targetFile: 'src/users/serialize.ts',
      targetLine: '  return { id: u.id, email: u.email };',
    },
    {
      name: 'route-removed-same-pr-as-replacement-must-find',
      title: '`/users/:id/profile` removed the same PR its replacement is added',
      severity: 'CRITICAL',
      category: 'bug',
      mustFind: true,
      diffFiles: [
        {
          path: 'src/api/profile.ts',
          oldStart: 6,
          lines: [
            del("app.get('/users/:id/profile', getProfile);"),
            add("app.get('/users/:id/card', getCard);"),
          ],
        },
      ],
      targetFile: 'src/api/profile.ts',
      targetLine: "app.get('/users/:id/card', getCard);",
    },
    {
      name: 'enum-value-removed-silently-must-find',
      title: 'Enum value `archived` removed (renamed to `deleted`) with no deprecation',
      severity: 'CRITICAL',
      category: 'bug',
      mustFind: true,
      diffFiles: [
        {
          path: 'src/contracts/status.ts',
          oldStart: 4,
          lines: [
            ctx('export const Status = z.enum(['),
            ctx("  'active',"),
            ctx("  'paused',"),
            del("  'archived',"),
            add("  'deleted',"),
            ctx(']);'),
          ],
        },
      ],
      targetFile: 'src/contracts/status.ts',
      targetLine: "  'deleted',",
    },
    {
      name: 'deprecated-field-kept-must-not-flag',
      title: '`legacyToken` kept and `@deprecated`-annotated for the migration window',
      severity: 'SUGGESTION',
      category: 'bug',
      mustFind: false,
      diffFiles: [
        {
          path: 'src/users/serialize.ts',
          oldStart: 40,
          lines: [
            ctx('function toUserSummary(u: UserRow) {'),
            add('  /** @deprecated use `email`; removed in v3. Still returned through v2.x. */'),
            ctx('  return { id: u.id, email: u.email, legacyToken: u.legacyToken };'),
            ctx('}'),
          ],
        },
      ],
    },
    {
      name: 'sunset-headers-old-route-served-must-not-flag',
      title: 'Deprecation/Sunset headers added, old route still served — correct',
      severity: 'SUGGESTION',
      category: 'bug',
      mustFind: false,
      diffFiles: [
        {
          path: 'src/api/profile.ts',
          oldStart: 30,
          lines: [
            ctx("app.get('/users/:id/profile', async (req, reply) => {"),
            add("  reply.header('Deprecation', 'true');"),
            add("  reply.header('Sunset', 'Wed, 31 Dec 2026 23:59:59 GMT');"),
            ctx('  return getProfile(req.params.id);'),
            ctx('});'),
          ],
        },
      ],
    },
    {
      name: 'internal-route-removed-must-not-flag',
      title: 'Internal-only diagnostics route swapped — never public, no window needed',
      severity: 'SUGGESTION',
      category: 'bug',
      mustFind: false,
      diffFiles: [
        {
          path: 'src/internal/debug.ts',
          oldStart: 5,
          lines: [
            ctx('// Internal-only diagnostics, never exposed publicly (no client depends on it).'),
            del("app.get('/internal/debug/echo', echoHandler);"),
            add("app.get('/internal/debug/health', healthHandler);"),
          ],
        },
      ],
    },
  ],
};

const SKILL_EVAL_SETS: SkillEvalSet[] = [
  BREAKING_CHANGE_SET,
  RESPONSE_SCHEMA_SET,
  SEMVER_DISCIPLINE_SET,
  DEPRECATION_POLICY_SET,
];

/**
 * Seed the API-contract skills' eval cases. Idempotent per skill (skipped once a
 * skill already has any eval case) and per workspace. A skill that isn't seeded
 * in this workspace is quietly skipped — the caller need not gate on it.
 */
export async function seedApiContractSkillEvalCases(db: Db, workspaceId: string): Promise<void> {
  for (const set of SKILL_EVAL_SETS) {
    const [skill] = await db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, set.skillName)));
    if (!skill) continue;

    const [existingCase] = await db
      .select({ id: t.evalCases.id })
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'skill'),
          eq(t.evalCases.ownerId, skill.id),
        ),
      );
    if (existingCase) continue; // idempotent — already seeded

    await db.insert(t.evalCases).values(
      set.cases.map((c) => {
        const built = buildDiff(c.diffFiles);
        const line = c.mustFind ? built.lineOf(c.targetFile!, c.targetLine!) : 0;
        return {
          workspaceId,
          ownerKind: 'skill' as const,
          ownerId: skill.id,
          name: c.name,
          inputDiff: built.text,
          inputMeta: { title: c.title },
          expectedOutput: c.mustFind
            ? [
                {
                  file: c.targetFile!,
                  start_line: line,
                  end_line: line,
                  severity: c.severity,
                  category: c.category,
                  title: c.title,
                },
              ]
            : [],
          notes: null,
        };
      }),
    );
  }
}
