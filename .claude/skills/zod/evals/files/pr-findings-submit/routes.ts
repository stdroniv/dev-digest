import type { FastifyInstance } from 'fastify'
import { findingSchema } from './schema'

export async function registerFindingsRoutes(app: FastifyInstance) {
  app.post('/api/reviews/:reviewId/findings', async (req, reply) => {
    // No try/catch, no safeParse — a malformed body throws a ZodError
    // straight out of the handler.
    const finding = findingSchema.parse(req.body)

    await app.db.insert('findings').values(finding)
    return reply.code(201).send({ ok: true })
  })
}
