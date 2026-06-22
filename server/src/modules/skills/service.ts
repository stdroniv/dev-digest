import type { Container } from '../../platform/container.js';
import type {
  Skill,
  SkillImportPreview,
  SkillSource,
  SkillStats,
  SkillType,
  SkillVersion,
} from '@devdigest/shared';
import { ConflictError } from '../../platform/errors.js';
import { SKILL_STATS_WINDOW_DAYS } from './constants.js';
import { SkillsRepository } from './repository.js';
import { computeSkillStats, toSkillDto, toSkillVersionDto, deriveSkillName } from './helpers.js';
import { ImportError, parseImport } from './import-parse.js';

/**
 * A1 — skills service. Business logic for the Skills page + Skill editor. A skill
 * is name + description + type + markdown body; the body is what gets injected
 * into a reviewing agent's prompt. The token count surfaced on each DTO is the
 * "how many tokens does this skill add" measurement, computed via the tokenizer
 * adapter. Body edits are versioned via `skill_versions` (repository).
 */

// Re-exported for convenience; implementation lives in ./helpers.
export { toSkillDto } from './helpers.js';

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  source?: SkillSource;
  enabled?: boolean;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
}

export interface ImportInput {
  filename: string;
  /** Raw file bytes, base64-encoded (markdown text or a zip archive). */
  content_base64: string;
  /** Optional explicit name; derived from the body's first heading when blank. */
  name?: string;
}

export class SkillsService {
  private repo: SkillsRepository;

  constructor(private container: Container) {
    this.repo = new SkillsRepository(container.db);
  }

  /** Count body tokens for the DTO (heuristic fallback if BPE is unavailable). */
  private tokens(body: string): number {
    return this.container.tokenizer.count(body);
  }

  private dto(row: Parameters<typeof toSkillDto>[0]): Skill {
    return toSkillDto(row, this.tokens(row.body));
  }

  async list(workspaceId: string): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map((r) => this.dto(r));
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? this.dto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const clash = await this.repo.findByName(workspaceId, input.name);
    if (clash) throw new ConflictError(`A skill named "${input.name}" already exists.`);
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type,
      body: input.body,
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    });
    return this.dto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    if (patch.name !== undefined) {
      const clash = await this.repo.findByName(workspaceId, patch.name);
      if (clash && clash.id !== id) {
        throw new ConflictError(`A skill named "${patch.name}" already exists.`);
      }
    }
    const row = await this.repo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    });
    return row ? this.dto(row) : undefined;
  }

  /**
   * Usage statistics for the Stats tab. Undefined when the skill isn't in the
   * workspace (→ 404). The DTO is derived on read; nothing is persisted.
   */
  async getStats(workspaceId: string, id: string): Promise<SkillStats | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const raw = await this.repo.getStats(workspaceId, id, SKILL_STATS_WINDOW_DAYS);
    return computeSkillStats(id, SKILL_STATS_WINDOW_DAYS, raw);
  }

  /** Body version history, newest first. Undefined when the skill isn't in the workspace. */
  async listVersions(workspaceId: string, id: string): Promise<SkillVersion[] | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const rows = await this.repo.listVersions(id);
    return rows.map(toSkillVersionDto);
  }

  /** One body snapshot. Undefined when the skill/version isn't found in the workspace. */
  async getVersion(
    workspaceId: string,
    id: string,
    version: number,
  ): Promise<SkillVersion | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const row = await this.repo.getVersion(id, version);
    return row ? toSkillVersionDto(row) : undefined;
  }

  /**
   * Parse an uploaded file/archive into a PREVIEW — does NOT persist. The drawer
   * shows the preview; the user confirms, then the normal create path stores it
   * (as untrusted data, disabled until vetted). Executable archive entries are
   * ignored here and never reach the DB.
   */
  importPreview(input: ImportInput): SkillImportPreview {
    let buf: Buffer;
    try {
      buf = Buffer.from(input.content_base64, 'base64');
    } catch {
      throw new ImportError('Could not decode the uploaded file.');
    }
    const parsed = parseImport(input.filename, buf);
    const body = parsed.body.trim();
    if (!body) throw new ImportError('The imported file has no usable content.');
    const name = (input.name?.trim() || deriveSkillName(body, parsed.sourceName)).slice(0, 80);
    return {
      name,
      body,
      type: 'custom',
      source: 'imported_url',
      tokens: this.tokens(body),
      ignored_files: parsed.ignoredFiles,
    };
  }
}
