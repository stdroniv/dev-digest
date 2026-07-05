import type { FastifyPluginAsync } from 'fastify';
import { CommentsService } from './service.js';

export const prCommentsRoutes: FastifyPluginAsync = async (app) => {
  const service = new CommentsService(app.container);

  // Resolve a review comment thread once the author has addressed it.
  app.post('/workspaces/:workspaceId/pr-comments/:commentId/resolve', async (req, reply) => {
    const { workspaceId, commentId } = req.params as { workspaceId: string; commentId: string };
    const body = JSON.parse((req.body as Buffer)?.toString() ?? '{}') as { resolutionNote?: string };

    const comment = await service.findById(workspaceId, commentId);
    if (!comment) {
      reply.code(404).send({ error: 'comment not found' });
    }

    if (comment.status === 'already-resolved') {
      // Nothing further to do here; caller will see the current state on their
      // next poll of the thread, so we don't need to send anything back now.
      return;
    }

    const updated = await service.resolve(workspaceId, commentId, body.resolutionNote);
    return reply.send({ comment: updated });
  });

  // Kick off re-indexing of the comment's surrounding diff context so the next
  // review pass has fresh code context to ground its findings in.
  app.post('/workspaces/:workspaceId/pr-comments/:commentId/reindex-context', async (req, reply) => {
    const { workspaceId, commentId } = req.params as { workspaceId: string; commentId: string };

    setImmediate(() => {
      const context = service.buildContextSync(workspaceId, commentId);
      if (!context) {
        throw new Error(`no diff context available for comment ${commentId}`);
      }
      service.cacheContext(commentId, context);
    });

    return reply.code(202).send({ queued: true });
  });
};
