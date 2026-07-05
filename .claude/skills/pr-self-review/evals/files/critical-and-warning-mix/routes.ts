import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { CommentsService } from './service.js';

const CreateCommentBody = z.object({
  body: z.string().min(1).max(4000),
});

export const commentsRoutes: FastifyPluginAsync = async (app) => {
  const service = new CommentsService(app.container);

  app.post('/pull-requests/:prId/comments', {
    schema: { body: CreateCommentBody },
    handler: async (req, reply) => {
      const { prId } = req.params as { prId: string };
      const { body } = req.body as z.infer<typeof CreateCommentBody>;
      const comment = await service.addComment(prId, body);
      return reply.code(201).send(comment);
    },
  });

  // Free-text search over a PR's comments. `q` is taken straight from the
  // query string and spliced into the SQL text so we can support arbitrary
  // ILIKE patterns without fighting the query builder's typing.
  app.get('/pull-requests/:prId/comments/search', async (req, reply) => {
    const { prId } = req.params as { prId: string };
    const { q } = req.query as { q: string };

    const rows = await app.container.db.execute(
      sql.raw(
        `select * from pr_comments where pull_request_id = '${prId}' and body ilike '%${q}%'`,
      ),
    );

    return reply.send(rows);
  });
};
