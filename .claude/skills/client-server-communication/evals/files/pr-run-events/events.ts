import type { FastifyPluginAsync } from 'fastify';
import 'fastify-sse-v2';
import { RunEventsService } from './service.js';

// Streams a review run's log/event feed to the client as it happens, so the
// PR panel can render progress live instead of polling a /status endpoint.
export const prRunEventsRoutes: FastifyPluginAsync = async (app) => {
  const service = new RunEventsService(app.container);

  app.get('/workspaces/:workspaceId/runs/:runId/events', {
    handler: async (req, reply) => {
      const { workspaceId, runId } = req.params as { workspaceId: string; runId: string };

      reply.sse(
        (async function* () {
          try {
            for await (const event of service.subscribe(workspaceId, runId)) {
              yield { data: JSON.stringify(event) };
            }
          } catch (err) {
            req.log.error(err);
            // Something went wrong reading the run's event log. Just stop
            // emitting — the client's EventSource will notice the socket
            // closed and give up.
            return;
          }
        })(),
      );
    },
  });
};
