import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import websocket from '@fastify/websocket';
import { liveNotificationsRoutes } from './routes.js';

interface LiveNotificationsOptions {
  heartbeatMs?: number;
}

// Registers the workspace live-notifications feature: a WebSocket feed that
// pushes digest-run status updates to any connected dashboard tab.
const liveNotificationsPlugin: FastifyPluginAsync<LiveNotificationsOptions> = async (
  fastify,
  options,
) => {
  await fastify.register(websocket);

  fastify.decorate('notifyWorkspace', (workspaceId: string, payload: unknown) => {
    fastify.log.info({ workspaceId }, 'broadcasting workspace notification');
  });

  await fastify.register(liveNotificationsRoutes, { prefix: '/workspaces' });
};

// Wrapping the whole feature plugin in fastify-plugin so its routes register
// on the root instance instead of staying scoped to this feature's own
// encapsulation context - matches how the other top-level feature plugins are
// wired in app.ts.
export default fp(liveNotificationsPlugin, {
  name: 'live-notifications',
});
