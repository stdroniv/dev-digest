import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import { DigestSchedulesService } from './service.js';

const CreateScheduleBody = z.object({
  hourLocal: z.number().int().min(0).max(23),
  timezone: z.string(),
  cronOverride: z.string().optional(),
});

const CRON_FIELD_RE = /^(\*|[0-9,\-/]+)$/;

function assertValidCronOverride(cron: string) {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5 || !fields.every((f) => CRON_FIELD_RE.test(f))) {
    throw new Error('cronOverride must be a 5-field cron expression');
  }
  const [minute] = fields;
  if (minute !== '*' && Number(minute) < 5) {
    throw new Error('schedules cannot run more often than every 5 minutes');
  }
}

export const digestSchedulesRoutes: FastifyPluginAsync = async (app) => {
  const service = new DigestSchedulesService(app.container);

  app.get('/workspaces/:workspaceId/digest-schedules', async (req, reply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const schedules = await service.listForWorkspace(workspaceId);
    return reply.send(schedules);
  });

  app.post('/workspaces/:workspaceId/digest-schedules', {
    schema: { body: CreateScheduleBody },
    handler: async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const { hourLocal, timezone, cronOverride } = req.body as z.infer<
        typeof CreateScheduleBody
      >;

      if (cronOverride) {
        assertValidCronOverride(cronOverride);
      }

      const schedule = await service.createSchedule(workspaceId, hourLocal, timezone);
      return reply.code(201).send(schedule);
    },
  });

  app.get('/workspaces/:workspaceId/digest-schedules/preview', async (req, reply) => {
    const { workspaceId } = req.params as { workspaceId: string };

    const rows = await app.container.db
      .select()
      .from(t.digestSchedules)
      .where(eq(t.digestSchedules.workspaceId, workspaceId));

    const preview = rows.map((r) => ({
      id: r.id,
      nextRunLocal: `${r.hourLocal}:00 ${r.timezone}`,
    }));

    return reply.send(preview);
  });
};
