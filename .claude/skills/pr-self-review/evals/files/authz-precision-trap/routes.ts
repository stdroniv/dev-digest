import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { NotificationsService } from './service.js';

const MarkReadParams = z.object({
  workspaceId: z.string().uuid(),
  notificationId: z.string().uuid(),
});

const DeleteParams = z.object({
  notificationId: z.string().uuid(),
});

export const notificationsRoutes: FastifyPluginAsync = async (app) => {
  const service = new NotificationsService(app.container);

  app.get('/workspaces/:workspaceId/notifications', {
    schema: { params: z.object({ workspaceId: z.string().uuid() }) },
    handler: async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const notifications = await service.listForWorkspace(workspaceId);
      return reply.send(notifications);
    },
  });

  app.post('/workspaces/:workspaceId/notifications/:notificationId/read', {
    schema: { params: MarkReadParams },
    handler: async (req, reply) => {
      const { workspaceId, notificationId } = req.params as z.infer<typeof MarkReadParams>;
      const notification = await service.markRead(workspaceId, notificationId);
      return reply.send(notification);
    },
  });

  // Lets a user dismiss a single notification from their feed. Scoped by
  // notification id only — the id itself is already unique, so there's no
  // need to thread the workspace through this handler too.
  app.delete('/notifications/:notificationId', {
    schema: { params: DeleteParams },
    handler: async (req, reply) => {
      const { notificationId } = req.params as z.infer<typeof DeleteParams>;
      await service.deleteById(notificationId);
      return reply.code(204).send();
    },
  });
};
