import type { Container } from '../../platform/container.js';
import { MemoryRepository, type MemoryRow } from './repository.js';

export type LearnFromFindingResult =
  | { status: 'created'; memoryId: string; memory: MemoryRow }
  | { status: 'not_found' };

/**
 * T6 — minimal `memory` module: "Learn" (AC-25). Turns a finding into a
 * durable, attributable memory record. No LLM call — the row is a plain
 * DATA insert (`embedding: null`); reviewer-authored text (finding title +
 * rationale) is stored verbatim, never interpreted as instructions
 * (Untrusted inputs — `security` skill).
 */
export class MemoryService {
  private repo: MemoryRepository;

  constructor(private container: Container) {
    this.repo = new MemoryRepository(container.db);
  }

  private get reviewRepo() {
    return this.container.reviewRepo;
  }

  private get agentsRepo() {
    return this.container.agentsRepo;
  }

  async learnFromFinding(workspaceId: string, findingId: string): Promise<LearnFromFindingResult> {
    const ctx = await this.reviewRepo.findingContext(findingId);
    if (!ctx || ctx.pull.workspaceId !== workspaceId) return { status: 'not_found' };
    const { finding, review, pull } = ctx;

    let agentName = 'an agent';
    if (review.agentId) {
      const agent = await this.agentsRepo.getById(workspaceId, review.agentId);
      if (agent) agentName = agent.name;
    }

    const content = `${finding.title}\n\n${finding.rationale}`;
    const sources = [
      {
        pr: pull.number,
        context: `learned from a ${finding.severity.toLowerCase()} finding by ${agentName}`,
      },
    ];

    const memory = await this.repo.insert({
      workspaceId,
      repoId: pull.repoId,
      scope: 'repo',
      kind: 'learning',
      content,
      confidence: finding.confidence,
      sources,
    });

    return { status: 'created', memoryId: memory.id, memory };
  }
}
