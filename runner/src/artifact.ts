import { writeFileSync } from 'node:fs';
// Value import — `CiResultArtifact.parse` is a runtime call (server INSIGHTS.md:99).
import { CiResultArtifact } from '@devdigest/shared';
import type { CiResultArtifact as CiResultArtifactType } from '@devdigest/shared';

/**
 * Write the `devdigest-result.json` result artifact (AC-20), re-validated
 * against the SAME `CiResultArtifact` schema the studio's ingest uses
 * (AC-31) so a bug here can never write a shape the studio would reject —
 * fail loudly at write time instead of silently at ingest time.
 */
export function writeResultArtifact(path: string, artifact: CiResultArtifactType): string {
  const validated = CiResultArtifact.parse(artifact);
  const json = `${JSON.stringify(validated, null, 2)}\n`;
  writeFileSync(path, json, 'utf8');
  return json;
}

export interface UploadArtifactOptions {
  /** Artifact name (default 'devdigest-result'). */
  name?: string;
  runtimeUrl?: string;
  runtimeToken?: string;
  runId?: string;
}

/**
 * Upload the result artifact via the GitHub Actions runtime API
 * (`ACTIONS_RUNTIME_URL`/`ACTIONS_RUNTIME_TOKEN`) — deliberately NOT
 * `actions/upload-artifact` (AC-4/AC-29 forbid a marketplace action). This
 * mirrors the legacy `actions_storage` pipelines-artifacts protocol
 * (create container -> PUT bytes -> PATCH to finalize) that the classic
 * `@actions/artifact` toolkit used server-side:
 *   POST  {runtimeUrl}_apis/pipelines/workflows/{runId}/artifacts
 *   PUT   {fileContainerResourceUrl}?itemPath=<name>/<name>.json
 *   PATCH {runtimeUrl}_apis/pipelines/workflows/{runId}/artifacts?artifactName=<name>
 *
 * Best-effort and NON-FATAL by design: the process exit code is reserved
 * exclusively for the review gate (AC-21..24), never for CI bookkeeping
 * mechanics, so a failed/unsupported upload only logs a warning. Outside a
 * real Actions job (local runs, tests) the runtime env vars are absent and
 * this is a silent no-op — no network call, matching the hermetic test
 * requirement.
 */
export async function uploadResultArtifact(
  contents: string,
  opts: UploadArtifactOptions = {},
): Promise<void> {
  const runtimeUrl = opts.runtimeUrl ?? process.env.ACTIONS_RUNTIME_URL;
  const runtimeToken = opts.runtimeToken ?? process.env.ACTIONS_RUNTIME_TOKEN;
  const runId = opts.runId ?? process.env.GITHUB_RUN_ID;
  const name = opts.name ?? 'devdigest-result';
  if (!runtimeUrl || !runtimeToken || !runId) return;

  try {
    const base = runtimeUrl.replace(/\/$/, '');
    const authHeaders = {
      Authorization: `Bearer ${runtimeToken}`,
      'Content-Type': 'application/json',
    };

    const createRes = await fetch(
      `${base}/_apis/pipelines/workflows/${runId}/artifacts?api-version=6.0-preview`,
      { method: 'POST', headers: authHeaders, body: JSON.stringify({ Type: 'actions_storage', Name: name }) },
    );
    if (!createRes.ok) throw new Error(`create artifact container failed: ${createRes.status}`);
    const created = (await createRes.json()) as { fileContainerResourceUrl: string };

    const bytes = Buffer.from(contents, 'utf8');
    const itemPath = `${name}/${name}.json`;
    const uploadRes = await fetch(
      `${created.fileContainerResourceUrl}?itemPath=${encodeURIComponent(itemPath)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${runtimeToken}`,
          'Content-Type': 'application/octet-stream',
          'Content-Range': `bytes 0-${bytes.length - 1}/${bytes.length}`,
        },
        body: bytes,
      },
    );
    if (!uploadRes.ok) throw new Error(`artifact upload failed: ${uploadRes.status}`);

    const finalizeRes = await fetch(
      `${base}/_apis/pipelines/workflows/${runId}/artifacts?artifactName=${encodeURIComponent(name)}&api-version=6.0-preview`,
      { method: 'PATCH', headers: authHeaders, body: JSON.stringify({ Size: bytes.length }) },
    );
    if (!finalizeRes.ok) throw new Error(`artifact finalize failed: ${finalizeRes.status}`);
  } catch (err) {
    console.warn(`[devdigest] result artifact upload skipped: ${(err as Error).message}`);
  }
}
