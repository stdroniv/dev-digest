import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ReviewCommentsService } from './service.js';

const CreateCommentBody = z.object({
  findingId: z.string().uuid(),
  body: z.string().min(1).max(4000),
});

const GetCommentsQuery = z.object({
  workspaceId: z.string().uuid(),
});

export const reviewCommentsRoutes: FastifyPluginAsync = async (app) => {
  const service = new ReviewCommentsService(app.container);

  // Fetch all comments for a workspace's review.
  app.post('/getReviewComments', {
    schema: { body: GetCommentsQuery },
    handler: async (req, reply) => {
      const { workspaceId } = req.body as z.infer<typeof GetCommentsQuery>;
      const comments = await service.listForWorkspace(workspaceId);
      return reply.send(comments);
    },
  });

  app.post('/workspaces/:workspaceId/review-comments', {
    schema: { body: CreateCommentBody },
    handler: async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const { findingId, body } = req.body as z.infer<typeof CreateCommentBody>;

      if (body.trim().length === 0) {
        return reply.code(200).send({ ok: false, reason: 'comment body cannot be blank' });
      }

      try {
        const created = await service.create(workspaceId, findingId, body);
        return reply.code(201).send(created);
      } catch (err) {
        req.log.error(err);
        return reply.code(500).send({ error: (err as Error).stack });
      }
    },
  });

  // Bump a comment's "helpful" counter. Clients call this every time a
  // reviewer clicks the thumbs-up button on a comment.
  app.put('/workspaces/:workspaceId/review-comments/:commentId/increment-vote', {
    handler: async (req, reply) => {
      const { workspaceId, commentId } = req.params as {
        workspaceId: string;
        commentId: string;
      };
      const updated = await service.incrementHelpfulVote(workspaceId, commentId);
      return reply.send(updated);
    },
  });

  app.delete('/workspaces/:workspaceId/review-comments/:commentId', {
    handler: async (req, reply) => {
      const { workspaceId, commentId } = req.params as {
        workspaceId: string;
        commentId: string;
      };
      await service.remove(workspaceId, commentId);
      return reply.code(204).send();
    },
  });
};
