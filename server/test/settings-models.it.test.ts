import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import type { SecretsProvider } from '@devdigest/shared';
import {
  resolveFeatureModel,
  resolveFeatureModelWithFallback,
  getFeatureModelOverride,
} from '../src/modules/settings/feature-models.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('Settings: feature models + secrets status (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('resolveFeatureModel: registry default until overridden, then the workspace choice', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: {} });

    // No override yet → registry default; getFeatureModelOverride is undefined.
    expect(await getFeatureModelOverride(app.container, workspaceId, 'onboarding')).toBeUndefined();
    expect(await resolveFeatureModel(app.container, workspaceId, 'onboarding')).toEqual({
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
    });

    // Persist an override through the normal PUT /settings path.
    const put = await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: { feature_models: { onboarding: { provider: 'openrouter', model: 'z-ai/glm-4.7-flash' } } },
    });
    expect(put.statusCode).toBe(200);

    expect(await resolveFeatureModel(app.container, workspaceId, 'onboarding')).toEqual({
      provider: 'openrouter',
      model: 'z-ai/glm-4.7-flash',
    });
    // An unset feature still resolves to its own registry default.
    expect(await resolveFeatureModel(app.container, workspaceId, 'risk_brief')).toEqual({
      provider: 'openai',
      model: 'gpt-4.1',
    });

    await app.close();
  });

  it('resolveFeatureModel: eval_runner registry default until overridden, else the fallback via resolveFeatureModelWithFallback', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: {} });

    // No override yet → registry default; getFeatureModelOverride is undefined.
    expect(await getFeatureModelOverride(app.container, workspaceId, 'eval_runner')).toBeUndefined();
    expect(await resolveFeatureModel(app.container, workspaceId, 'eval_runner')).toEqual({
      provider: 'openai',
      model: 'gpt-4.1',
    });

    // No override → resolveFeatureModelWithFallback returns the caller-supplied
    // "reachable" model (e.g. the agent's own provider/model) with source 'fallback'.
    const reachable = { provider: 'openai' as const, model: 'gpt-4o-mini' };
    expect(
      await resolveFeatureModelWithFallback(app.container, workspaceId, 'eval_runner', reachable),
    ).toEqual({ ...reachable, source: 'fallback' });

    // Persist an override through the normal PUT /settings path.
    const put = await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: { feature_models: { eval_runner: { provider: 'openrouter', model: 'openrouter/eval-runner-x' } } },
    });
    expect(put.statusCode).toBe(200);

    expect(await resolveFeatureModel(app.container, workspaceId, 'eval_runner')).toEqual({
      provider: 'openrouter',
      model: 'openrouter/eval-runner-x',
    });
    // With an override set, resolveFeatureModelWithFallback returns the override
    // (not the reachable model), tagged 'override'.
    expect(
      await resolveFeatureModelWithFallback(app.container, workspaceId, 'eval_runner', reachable),
    ).toEqual({ provider: 'openrouter', model: 'openrouter/eval-runner-x', source: 'override' });

    await app.close();
  });

  it('PUT /settings with a custom root_folders list round-trips through GET /settings', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: {} });

    // Unset → GET reflects no root_folders key (getRootFolders' default lives
    // in the settings module, not on the raw GET response).
    const before = await app.inject({ method: 'GET', url: '/settings' });
    expect(before.statusCode).toBe(200);
    expect(before.json().root_folders).toBeUndefined();

    const put = await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: { root_folders: ['docs', 'adr', 'playbooks'] },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().root_folders).toEqual(['docs', 'adr', 'playbooks']);

    const after = await app.inject({ method: 'GET', url: '/settings' });
    expect(after.statusCode).toBe(200);
    expect(after.json().root_folders).toEqual(['docs', 'adr', 'playbooks']);

    await app.close();
  });

  it('GET /settings/secrets-status returns booleans only — never the key values', async () => {
    const secrets: SecretsProvider = {
      get: async (k) => (k === 'OPENROUTER_API_KEY' ? 'sk-or-secret-value' : undefined),
    };
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { secrets } });

    const res = await app.inject({ method: 'GET', url: '/settings/secrets-status' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({ openai: false, anthropic: false, openrouter: true, github: false });
    // The actual secret must never appear in the response.
    expect(res.payload).not.toContain('sk-or-secret-value');

    await app.close();
  });
});
