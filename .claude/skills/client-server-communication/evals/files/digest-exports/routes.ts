import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { DigestExportsService } from './service.js';
import { AppError } from '../../platform/errors.js';

const CreateExportBody = z.object({
  digestId: z.string().uuid(),
  format: z.enum(['pdf', 'csv', 'json']),
});

const ListExportsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const digestExportsRoutes: FastifyPluginAsync = async (app) => {
  const service = new DigestExportsService(app.container);

  // Kick off a new export job. Clients call this once per export request;
  // the job runs async and the client polls the single-resource GET below.
  app.post('/workspaces/:workspaceId/exports', {
    schema: { body: CreateExportBody },
    handler: async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const { digestId, format } = req.body as z.infer<typeof CreateExportBody>;

      const job = await service.enqueue(workspaceId, digestId, format);
      reply.header('Location', `/workspaces/${workspaceId}/exports/${job.id}`);
      return reply.code(201).send(job);
    },
  });

  app.get('/workspaces/:workspaceId/exports', {
    schema: { querystring: ListExportsQuery },
    handler: async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const { page, limit } = req.query as z.infer<typeof ListExportsQuery>;

      const rows = await service.listPage(workspaceId, page, limit);
      return reply.send(rows);
    },
  });

  // A completed export's file never changes once the job is done, so this
  // response is safe to cache indefinitely on the client.
  app.get('/workspaces/:workspaceId/exports/:exportId', {
    handler: async (req, reply) => {
      const { workspaceId, exportId } = req.params as {
        workspaceId: string;
        exportId: string;
      };

      const job = await service.getById(workspaceId, exportId);
      if (!job) {
        return reply.code(404).send('export not found');
      }

      return reply.send(job);
    },
  });

  app.delete('/workspaces/:workspaceId/exports/:exportId', {
    handler: async (req, reply) => {
      const { workspaceId, exportId } = req.params as {
        workspaceId: string;
        exportId: string;
      };

      const existed = await service.delete(workspaceId, exportId);
      if (!existed) {
        // Deleting an export that's already gone is still a successful
        // no-op from the caller's point of view.
        return reply.code(204).send();
      }

      return reply.code(204).send();
    },
  });
};

// Central error handler for this module, wired into app.setErrorHandler
// scoped to this plugin so every route in this file shares one shape.
export function digestExportsErrorHandler(err: unknown, req: any, reply: any) {
  if (err instanceof AppError) {
    return reply.code(err.statusCode).send({
      error: { code: err.code, message: err.message },
    });
  }
  req.log.error(err);
  return reply.code(500).send({ error: { code: 'internal_error', message: 'Internal error' } });
}
