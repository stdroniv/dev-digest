import { z } from 'zod'

// Config for the LLM provider used to run a review.
// DevDigest supports OpenAI, Anthropic, and OpenRouter (OpenAI-compatible).
export const llmProviderConfigSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('openai'),
    apiKey: z.string().min(1).transform((key) => key.trim() || undefined),
    model: z.string().min(1),
  }),
  z.object({
    provider: z.literal('anthropic'),
    apiKey: z.string().min(1).transform((key) => key.trim() || undefined),
    model: z.string().min(1),
  }),
])

export type LlmProviderConfig = z.infer<typeof llmProviderConfigSchema>
