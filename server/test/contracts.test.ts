import { describe, it, expect } from 'vitest';
import {
  Review,
  Finding,
  Intent,
  BlastRadius,
  Risks,
  PrHistory,
  SmartDiff,
  Conformance,
  Onboarding,
  EvalRun,
  MemoryItem,
  RunTrace,
  RunSummary,
  PrMeta,
  Settings,
  Repo,
  PrDetail,
  AgentManifest,
  CiResultArtifact,
  CiInstallation,
  CiRun,
  CiRunStatus,
} from '@devdigest/shared';

/**
 * Contract tests — parse/round-trip the fixtures from data.jsx/data2.jsx
 * so feature agents can rely on the schemas matching the prototype data.
 */
describe('AI contracts parse fixtures', () => {
  it('Review + Finding (data.jsx VERDICT/FINDINGS)', () => {
    const review = Review.parse({
      verdict: 'request_changes',
      summary: 'Two blockers before merge.',
      score: 61,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key in commit',
          file: 'src/config.ts',
          start_line: 12,
          end_line: 12,
          rationale: 'Line 12 contains a literal `sk_live_` Stripe key.',
          suggestion: 'Move to env and rotate.',
          confidence: 0.98,
          kind: 'secret_leak',
        },
      ],
    });
    expect(review.findings).toHaveLength(1);
    expect(review.score).toBe(61);
  });

  it('lethal-trifecta Finding variant', () => {
    const f = Finding.parse({
      id: 'f2',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Lethal trifecta',
      file: 'src/api/public/webhooks.ts',
      start_line: 61,
      end_line: 74,
      rationale: 'all three legs present',
      confidence: 0.79,
      kind: 'lethal_trifecta',
      trifecta_components: ['private_data_access', 'untrusted_input', 'exfil_path'],
      evidence: [{ component: 'untrusted_input', file: 'src/api/public/webhooks.ts', line: 61 }],
    });
    expect(f.trifecta_components).toContain('exfil_path');
  });

  it('Intent / BlastRadius / Risks / PrHistory', () => {
    expect(() =>
      Intent.parse({ intent: 'x', in_scope: ['a'], out_of_scope: ['b'] }),
    ).not.toThrow();
    expect(() =>
      BlastRadius.parse({
        changed_symbols: [{ name: 'rateLimit', file: 'a.ts', kind: 'function' }],
        downstream: [
          {
            symbol: 'rateLimit',
            callers: [{ name: 'publicRouter', file: 'b.ts', line: 23 }],
            endpoints_affected: ['GET /x'],
            crons_affected: ['c'],
          },
        ],
        summary: 's',
      }),
    ).not.toThrow();
    expect(() =>
      Risks.parse({
        risks: [{ kind: 'security', title: 't', explanation: 'e', severity: 'high', file_refs: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      PrHistory.parse({
        history: [
          {
            pr_number: 401,
            title: 't',
            merged_at: '2026-03-18',
            author: 'a',
            files_overlap: [],
            notes: 'n',
          },
        ],
      }),
    ).not.toThrow();
  });

  it('SmartDiff (data.jsx DIFF)', () => {
    const d = SmartDiff.parse({
      groups: [
        {
          role: 'core',
          files: [{ path: 'a.ts', additions: 84, deletions: 0, finding_annotations: [{ line: 28, severity: 'warning', finding_id: 'f1' }, { line: 52, severity: 'critical', finding_id: 'f2' }] }],
        },
      ],
      split_suggestion: { too_big: false, total_lines: 285, proposed_splits: [] },
    });
    expect(d.groups[0]!.role).toBe('core');
  });

  it('Conformance / Onboarding / EvalRun / MemoryItem', () => {
    expect(() =>
      Conformance.parse({
        spec_id: 's1',
        spec_title: 'Spec',
        items: [{ requirement: 'r', status: 'implemented' }],
        completeness_pct: 80,
      }),
    ).not.toThrow();
    expect(() =>
      Onboarding.parse({
        sections: [{ kind: 'architecture', title: 'T', body: 'b', links: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      EvalRun.parse({
        recall: 0.82,
        precision: 0.91,
        citation_accuracy: 0.95,
        traces_passed: 17,
        traces_total: 20,
        duration_ms: 12000,
        cost_usd: 0.23,
        per_trace: [{ name: 't01', pass: true, expected: 'x', actual: 'x' }],
      }),
    ).not.toThrow();
    expect(() =>
      MemoryItem.parse({
        content: 'c',
        scope: 'team',
        kind: 'decision',
        confidence: 0.92,
        sources: [{ pr: 401, context: 'ctx' }],
      }),
    ).not.toThrow();
  });

  it('RunTrace (data2.jsx TRACE single-document)', () => {
    const trace = RunTrace.parse({
      config: { agent: 'Security Reviewer', version: 'v7', model: 'gpt-4.1', pr: 482, source: 'local' },
      stats: { duration_ms: 8200, tokens_in: 14820, tokens_out: 1240, findings: 3, grounding: '3/3 passed', cost_usd: 0.06 },
      prompt_assembly: { system: 's', user: 'u' },
      tool_calls: [{ tool: 'read_file', args: "'src/config.ts'", meta: '1,240 bytes', ms: 120 }],
      raw_output: '{}',
      memory_pulled: [{ pr: 288, text: 'verified via stripe-signature' }],
      specs_read: ['specs/security-baseline.md'],
      log: [{ t: '00.00', kind: 'info', msg: 'started' }],
    });
    expect(trace.tool_calls).toHaveLength(1);
    expect(trace.stats.cost_usd).toBe(0.06);
  });

  it('RunSummary carries the per-run cost (null on failed/cancelled)', () => {
    const done = RunSummary.parse({
      run_id: 'r1',
      agent_id: 'a1',
      agent_name: 'Security Reviewer',
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      status: 'done',
      error: null,
      duration_ms: 8200,
      tokens_in: 9119,
      tokens_out: 612,
      findings_count: 2,
      grounding: '2/2 passed',
      ran_at: '2026-06-13T18:52:51.000Z',
      score: 61,
      blockers: 1,
      cost_usd: 0.0013,
      findings_counts: { critical: 1, warning: 1, suggestion: 0 },
    });
    expect(done.cost_usd).toBe(0.0013);
    expect(done.findings_counts).toEqual({ critical: 1, warning: 1, suggestion: 0 });
    const failed = RunSummary.parse({ ...done, status: 'failed', cost_usd: null, findings_counts: null });
    expect(failed.cost_usd).toBeNull();
    expect(failed.findings_counts).toBeNull();
  });

  it('PrMeta carries the aggregate run cost (list endpoint)', () => {
    const pr = PrMeta.parse({
      number: 482,
      title: 'Add rate limiting to public API endpoints',
      author: 'marisa.koch',
      branch: 'feat/rate-limit-public',
      base: 'main',
      head_sha: 'a1b2c3',
      additions: 247,
      deletions: 38,
      files_count: 9,
      status: 'needs_review',
      score: 61,
      cost_usd: 0.014,
    });
    expect(pr.cost_usd).toBe(0.014);
    // null/absent until the PR has a run
    expect(PrMeta.parse({ ...pr, cost_usd: null }).cost_usd).toBeNull();
  });
});

describe('platform DTOs', () => {
  it('Settings defaults + passthrough', () => {
    const s = Settings.parse({ extra_key: 'x' });
    expect(s.theme).toBe('dark');
    expect((s as Record<string, unknown>).extra_key).toBe('x');
  });

  it('Repo + PrDetail', () => {
    expect(() =>
      Repo.parse({
        id: 'r1',
        workspace_id: 'w1',
        owner: 'acme',
        name: 'payments-api',
        full_name: 'acme/payments-api',
        default_branch: 'main',
        clone_path: null,
        last_polled_at: null,
        created_by: null,
      }),
    ).not.toThrow();
    expect(() =>
      PrDetail.parse({
        number: 482,
        title: 't',
        author: 'a',
        branch: 'b',
        base: 'main',
        head_sha: 'sha',
        additions: 1,
        deletions: 0,
        files_count: 1,
        status: 'open',
        files: [],
        commits: [],
      }),
    ).not.toThrow();
  });
});

describe('Export-to-CI contracts (SPEC-05 T1)', () => {
  it('AgentManifest — one contract, two consumers (AC-13)', () => {
    const manifest = AgentManifest.parse({
      name: 'Security Reviewer',
      slug: 'security-reviewer',
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      system_prompt: 'You are a security-focused code reviewer.',
      skills: ['secret-scanning', 'lethal-trifecta'],
      strategy: 'auto',
      ci_fail_on: 'critical',
      workflow_version: 2,
    });
    expect(manifest.slug).toBe('security-reviewer');
    expect(manifest.skills).toEqual(['secret-scanning', 'lethal-trifecta']);
    expect(manifest.workflow_version).toBe(2);

    // Defaults + null-skills normalization (YAML `skills:` with no value → null).
    const minimal = AgentManifest.parse({
      name: 'Minimal Agent',
      slug: 'minimal-agent',
      model: 'gpt-4.1',
      system_prompt: 'Review this diff.',
      skills: null,
    });
    expect(minimal.provider).toBe('openrouter');
    expect(minimal.strategy).toBe('auto');
    expect(minimal.ci_fail_on).toBe('critical');
    expect(minimal.workflow_version).toBe(1);
    expect(minimal.skills).toEqual([]);
  });

  it('CiResultArtifact — devdigest-result.json shape (AC-20/31)', () => {
    const artifact = CiResultArtifact.parse({
      findings_count: 3,
      critical: 1,
      warning: 1,
      suggestion: 1,
      cost_usd: 0.021,
      duration_ms: 9400,
      agent: 'Security Reviewer',
      version: 'v3',
      pr_number: 512,
      status: 'succeeded',
    });
    expect(artifact.findings_count).toBe(3);
    expect(artifact.critical).toBe(1);
    expect(artifact.pr_number).toBe(512);

    // Fork-PR / no-credentials skip artifact (AC-27) — still validates.
    const skipped = CiResultArtifact.parse({
      findings_count: 0,
      cost_usd: null,
      agent: 'Security Reviewer',
      status: 'skipped_no_credentials',
    });
    expect(skipped.status).toBe('skipped_no_credentials');
  });

  it('CiRunStatus covers the full outcome matrix (AC-27/32/33)', () => {
    expect(CiRunStatus.options).toEqual([
      'succeeded',
      'no_findings',
      'failed',
      'running',
      'skipped_no_credentials',
    ]);
  });

  it('CiInstallation — derived status/version/drift fields (AC-39/40)', () => {
    const installation = CiInstallation.parse({
      id: 'inst-1',
      agent_id: 'agent-1',
      repo: 'acme/payments-api',
      target_type: 'gha',
      target: 'gha',
      installed_at: '2026-06-01T00:00:00.000Z',
      workflow_version: 2,
      status: 'succeeded',
      last_run_at: '2026-07-01T00:00:00.000Z',
      update_available: true,
    });
    expect(installation.update_available).toBe(true);
    expect(installation.workflow_version).toBe(2);
  });

  it('CiRun — every CI Runs page column (AC-35)', () => {
    const run = CiRun.parse({
      id: 'run-1',
      ci_installation_id: 'inst-1',
      pr_number: 512,
      pr_title: 'Add rate limiting to public API endpoints',
      ran_at: '2026-07-01T00:00:00.000Z',
      status: 'succeeded',
      findings_count: 3,
      findings_counts: { critical: 1, warning: 1, suggestion: 1 },
      cost_usd: 0.021,
      github_url: 'https://github.com/acme/payments-api/actions/runs/123',
      actions_run_id: '123',
      source: 'ci',
      agent: 'Security Reviewer',
      duration_s: 9.4,
    });
    expect(run.pr_title).toBe('Add rate limiting to public API endpoints');
    expect(run.findings_counts).toEqual({ critical: 1, warning: 1, suggestion: 1 });
    expect(run.actions_run_id).toBe('123');
  });

  it('RunSummary — CI-sourced run (AC-42)', () => {
    const ciRun = RunSummary.parse({
      run_id: 'r2',
      agent_id: 'a1',
      agent_name: 'Security Reviewer',
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      status: 'done',
      error: null,
      duration_ms: 9400,
      tokens_in: null,
      tokens_out: null,
      findings_count: 3,
      grounding: null,
      ran_at: '2026-07-01T00:00:00.000Z',
      score: null,
      blockers: 1,
      cost_usd: 0.021,
      findings_counts: { critical: 1, warning: 1, suggestion: 1 },
      source: 'ci',
    });
    expect(ciRun.source).toBe('ci');

    // Defaults to 'local' when omitted, so pre-existing callers/fixtures still parse.
    const localRun = RunSummary.parse({
      run_id: 'r3',
      agent_id: 'a1',
      agent_name: 'Security Reviewer',
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      status: 'done',
      error: null,
      duration_ms: 1000,
      tokens_in: null,
      tokens_out: null,
      findings_count: 0,
      grounding: null,
      ran_at: '2026-07-01T00:00:00.000Z',
      score: null,
      blockers: null,
      cost_usd: null,
      findings_counts: null,
    });
    expect(localRun.source).toBe('local');
  });
});
