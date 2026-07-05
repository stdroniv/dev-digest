import { z } from 'zod'

export const findingSchema = z.object({
  id: z.string().uuid(),
  filePath: z.string().min(1),
  line: z.number().int().positive(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  message: z.string().min(1),
  confidence: z.number().min(0).max(1),
  // The DB column is `merged_at TIMESTAMP NULL` — the row always has the
  // column, it's just null until the PR is merged.
  mergedAt: z.string().datetime().optional(),
})

// Manually maintained type for the API response layer.
// NOTE: keep in sync with findingSchema above.
export interface ReviewFinding {
  id: string
  filePath: string
  line: number
  severity: 'low' | 'medium' | 'high' | 'critical'
  message: string
  mergedAt?: string
}
