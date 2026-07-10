import OpenAI from 'openai';
import type { Container } from '../../platform/container.js';
import { WebhooksRepository } from './repository.js';

/**
 * W1 — webhooks service. Fires a workspace's configured endpoints whenever a
 * review run finishes, with a short LLM-written summary of the findings so
 * the receiving Slack/email doesn't just dump raw JSON.
 */

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export class WebhooksService {
  private repo: WebhooksRepository;

  constructor(private container: Container) {
    this.repo = new WebhooksRepository(container.db);
  }

  async notifyReviewComplete(workspaceId: string, reviewId: string, findingsCount: number) {
    const endpoints = await this.repo.listEndpoints(workspaceId);
    if (endpoints.length === 0) return;

    const summary = await this.summarize(reviewId, findingsCount);

    for (const endpoint of endpoints) {
      const res = await fetch(endpoint.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reviewId, findingsCount, summary }),
      });
      await this.repo.recordDelivery(endpoint.id, { reviewId, summary }, res.status);
    }
  }

  private async summarize(reviewId: string, findingsCount: number): Promise<string> {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: `Write a one-sentence Slack summary for review ${reviewId}, which found ${findingsCount} issues.`,
        },
      ],
    });
    return completion.choices[0]?.message?.content ?? `Review ${reviewId} completed.`;
  }

  async retryDueDeliveries(workspaceId: string) {
    return this.repo.claimDueRetries(workspaceId);
  }
}
