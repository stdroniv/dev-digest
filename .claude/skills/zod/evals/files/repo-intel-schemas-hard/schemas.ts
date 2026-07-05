import { z } from 'zod'

// GitHub webhook payload verification
export const webhookEventSchema = z
  .object({
    action: z.string(),
    repository: z.object({
      id: z.number(),
      fullName: z.string(),
    }),
    metadata: z.any(),
  })
  .refine((event) => {
    if (!event.action) {
      throw new Error('action is required')
    }
    return true
  })

// Review finding severity — accepts any string today
export const findingSeveritySchema = z.object({
  findingId: z.string().uuid(),
  severity: z.string(),
  reviewerNotes: z.string(),
})

// New review request payload submitted from the studio UI
export const reviewRequestSchema = z.object({
  repoId: z.string().uuid().optional(),
  prNumber: z.number().int().positive().optional(),
  provider: z.string().optional(),
  promptVersion: z.string().optional(),
  requestedBy: z.string().optional(),
})

// Digest delivery preferences
export const digestPreferenceSchema = z.object({
  channel: z.enum(['email', 'slack', 'in-app']),
  quietHoursStart: z.string().nullable(),
  quietHoursEnd: z.string().nullable(),
  timezone: z.string().min(1),
})
export type DigestPreference = z.infer<typeof digestPreferenceSchema>

// Review result returned to the client
export const reviewResultSchema = z.object({
  id: z.string().uuid(),
  verdict: z.enum(['approve', 'request-changes', 'comment']),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
})

// Manually declared so the API layer doesn't need to import zod types
export interface ReviewResult {
  id: string
  verdict: 'approve' | 'request-changes' | 'comment'
  summary: string
}
