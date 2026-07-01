import { describe, it, expect, afterEach } from 'vitest';
import { McpToolError, toolErrorResult, okResult, runTool } from '../src/errors.js';
import { makeReviewPrTool } from '../src/tools/review-pr.js';
import type { ToolDeps } from '../src/deps.js';
import type { Logger } from '../src/logger.js';

describe('toolErrorResult', () => {
  it('maps a message to { isError: true, content: [text] }', () => {
    const r = toolErrorResult('boom');
    expect(r.isError).toBe(true);
    expect(r.content).toEqual([{ type: 'text', text: 'boom' }]);
  });
});

describe('runTool', () => {
  it('maps a thrown McpToolError to an isError result with its message', async () => {
    const r = await runTool(async () => {
      throw new McpToolError('not found');
    });
    expect(r.isError).toBe(true);
    expect(r.content).toEqual([{ type: 'text', text: 'not found' }]);
  });

  it('maps an unexpected error to a FIXED generic result and never leaks the raw detail', async () => {
    const logged: { obj: unknown; msg?: string }[] = [];
    const logger: Logger = {
      info: () => undefined,
      warn: () => undefined,
      error: (obj, msg) => {
        logged.push({ obj, msg });
      },
      debug: () => undefined,
    };

    const r = await runTool(async () => {
      throw new Error('kaboom secret detail');
    }, logger);

    expect(r.isError).toBe(true);
    const text = (r.content as { text: string }[])[0]!.text;
    // The client sees a fixed, internals-free message…
    expect(text).toBe('An unexpected internal error occurred while running the tool.');
    // …and the raw exception detail NEVER reaches the client.
    expect(text).not.toContain('kaboom');
    // …but it IS logged to stderr for diagnostics.
    expect(JSON.stringify(logged)).toContain('kaboom secret detail');
  });

  it('still returns the generic result when no logger is provided', async () => {
    const r = await runTool(async () => {
      throw new Error('kaboom');
    });
    expect(r.isError).toBe(true);
    const text = (r.content as { text: string }[])[0]!.text;
    expect(text).toBe('An unexpected internal error occurred while running the tool.');
    expect(text).not.toContain('kaboom');
  });

  it('passes through a success result unchanged', async () => {
    const ok = okResult({ a: 1 });
    const r = await runTool(async () => ok);
    expect(r).toBe(ok);
  });
});

describe('okResult', () => {
  const original = process.env.DEVDIGEST_MCP_EMIT_TEXT;
  afterEach(() => {
    if (original === undefined) delete process.env.DEVDIGEST_MCP_EMIT_TEXT;
    else process.env.DEVDIGEST_MCP_EMIT_TEXT = original;
  });

  it('emits structuredContent and empty content by default', () => {
    delete process.env.DEVDIGEST_MCP_EMIT_TEXT;
    const r = okResult({ hello: 'world' });
    expect(r.structuredContent).toEqual({ hello: 'world' });
    expect(r.content).toEqual([]);
    expect(r.isError).toBeUndefined();
  });

  it('also emits a JSON text block when DEVDIGEST_MCP_EMIT_TEXT=true', () => {
    process.env.DEVDIGEST_MCP_EMIT_TEXT = 'true';
    const r = okResult({ hello: 'world' });
    expect(r.content).toEqual([{ type: 'text', text: JSON.stringify({ hello: 'world' }) }]);
  });
});

describe('review_pr agent|all XOR rule', () => {
  // The XOR check runs before any DB access, so a stub deps suffices.
  const tool = makeReviewPrTool({} as ToolDeps);

  it('rejects neither agent nor all', async () => {
    const r = await tool.handler({ pr: 'acme/payments-api#1' });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0]!.text).toContain('exactly one');
  });

  it('rejects both agent and all', async () => {
    const r = await tool.handler({ pr: 'acme/payments-api#1', agent: 'Sec', all: true });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0]!.text).toContain('exactly one');
  });
});
