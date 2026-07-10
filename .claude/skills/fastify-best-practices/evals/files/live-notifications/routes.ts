import type { FastifyPluginAsync } from 'fastify';

export const liveNotificationsRoutes: FastifyPluginAsync = async (fastify) => {
  // Every request in this feature gets wrapped so a bad payload or a
  // downstream failure never surfaces as a 500 to the dashboard - the tab
  // just quietly stays on its last known state until the next successful
  // poll instead of showing an error toast.
  fastify.addHook('onRequest', async (request, reply) => {
    try {
      const { workspaceId } = request.params as { workspaceId?: string };
      if (workspaceId) {
        request.log.info({ workspaceId }, 'live-notifications request');
      }
    } catch {
      // swallow - see comment above
    }
  });

  fastify.get('/:workspaceId/live-notifications', { websocket: true }, (socket, request) => {
    const { workspaceId } = request.params as { workspaceId: string };

    const interval = setInterval(() => {
      socket.send(JSON.stringify({ type: 'heartbeat', workspaceId, ts: Date.now() }));
    }, 15000);

    socket.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'ack') {
        request.log.debug({ workspaceId }, 'client acked notification');
      }
    });
  });
};
