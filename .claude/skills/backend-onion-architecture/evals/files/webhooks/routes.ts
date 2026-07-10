import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import { WebhooksService } from './service.js';

const CreateEndpointBody = z.object({
  url: z.string().url(),
  secret: z.string().min(16).optional(),
});

export const webhooksRoutes: FastifyPluginAsync = async (app) => {
  const service = new WebhooksService(app.container);

  app.post('/workspaces/:workspaceId/webhooks', {
    schema: { body: CreateEndpointBody },
    handler: async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const { url, secret } = req.body as z.infer<typeof CreateEndpointBody>;

      const existing = await app.container.db
        .select()
        .from(t.webhookEndpoints)
        .where(eq(t.webhookEndpoints.workspaceId, workspaceId));

      if (existing.some((e) => e.url === url)) {
        return reply.code(409).send({ error: 'endpoint already registered' });
      }

      const [row] = await app.container.db
        .insert(t.webhookEndpoints)
        .values({ workspaceId, url, secret: secret ?? null })
        .returning();

      return reply.code(201).send(row);
    },
  });

  app.post('/workspaces/:workspaceId/webhooks/:endpointId/retry', async (req, reply) => {
    const { workspaceId } = req.params as { workspaceId: string; endpointId: string };
    const due = await service.retryDueDeliveries(workspaceId);
    return reply.send({ retried: due.length });
  });
};
