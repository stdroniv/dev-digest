import type { FastifyInstance } from 'fastify'
import {
  reviewRequestSchema,
  reviewResultSchema,
  digestPreferenceSchema,
  type ReviewResult,
} from './schemas'

export async function registerReviewRoutes(app: FastifyInstance) {
  app.post('/api/reviews', async (req, reply) => {
    const result = reviewRequestSchema.safeParse(req.body)
    if (!result.success) {
      return reply.code(400).send({ error: 'Validation failed', issues: result.error.issues })
    }

    const review = await app.reviewService.run(result.data)
    return reply.code(201).send(review)
  })

  app.get('/api/digest-preferences/:userId', async (req, reply) => {
    const prefs = digestPreferenceSchema.safeParse(await app.db.getPreferences(req.params.userId))
    if (!prefs.success) {
      return reply.code(500).send({ error: 'Corrupt preference data' })
    }
    return reply.send(prefs.data)
  })

  app.get('/api/reviews/:id', async (req, reply) => {
    const raw = await app.reviewService.get(req.params.id)
    const parsed = reviewResultSchema.parse(raw)

    // Downstream code only knows about the manually declared shape, so
    // `confidence` silently gets dropped before it ever reaches the client.
    const response: ReviewResult = {
      id: parsed.id,
      verdict: parsed.verdict,
      summary: parsed.summary,
    }
    return reply.send(response)
  })
}
