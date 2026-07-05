import type { FastifyPluginAsync } from 'fastify';
import { ExportsService } from './service.js';

interface CreateExportBody {
  format: 'pdf' | 'csv';
  digestId: string;
}

const requireWorkspaceAccess = async (req: any, reply: any) => {
  const { workspaceId } = req.params as { workspaceId: string };
  const membership = await req.server.container.membership.check(req.user?.id, workspaceId);

  if (!membership) {
    reply.code(403).send({ error: 'forbidden' });
  }
};

export const digestExportsRoutes: FastifyPluginAsync = async (app) => {
  const service = new ExportsService(app.container);

  // Fetch a single export record. Correctly schema'd and correctly handled -
  // this route should not need any changes.
  app.get('/workspaces/:workspaceId/digest-exports/:exportId', {
    schema: {
      params: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string' },
          exportId: { type: 'string' },
        },
        required: ['workspaceId', 'exportId'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            status: { type: 'string' },
            downloadUrl: { type: ['string', 'null'] },
          },
        },
        404: { $ref: 'httpError#' },
      },
    },
    handler: async (req, reply) => {
      const { workspaceId, exportId } = req.params as { workspaceId: string; exportId: string };
      const record = await service.findById(workspaceId, exportId);
      if (!record) {
        return reply.notFound('Export');
      }
      return record;
    },
  });

  // Kick off a new export job.
  app.post('/workspaces/:workspaceId/digest-exports', {
    preHandler: [requireWorkspaceAccess],
    handler: async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const body = req.body as CreateExportBody;

      try {
        const created = await service.create(workspaceId, body.digestId, body.format);
        reply.code(201);
        return created;
      } catch (error) {
        req.log.error({ err: error }, 'export creation failed');
        return reply.code(500).send({
          error: 'export_failed',
          message: (error as Error).message,
          stack: (error as Error).stack,
        });
      }
    },
  });

  // List exports for a workspace, most recent first.
  app.get('/workspaces/:workspaceId/digest-exports', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      },
    },
    handler: async (req) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const { limit } = req.query as { limit: number };
      return service.listRecent(workspaceId, limit);
    },
  });
};
