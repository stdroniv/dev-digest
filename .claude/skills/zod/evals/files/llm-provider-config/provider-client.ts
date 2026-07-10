import type { LlmProviderConfig } from './config-schema'

// Builds the client options for whichever provider is configured.
// OpenRouter is OpenAI-compatible, so it needs its own baseURL.
export function buildClientOptions(config: LlmProviderConfig) {
  switch (config.provider) {
    case 'openai':
      return { apiKey: requireKey(config.apiKey), baseURL: undefined }
    case 'anthropic':
      return { apiKey: requireKey(config.apiKey), baseURL: undefined }
    // @ts-expect-error - 'openrouter' isn't a member of LlmProviderConfig yet,
    // but ops has already configured workspaces with provider: 'openrouter'
    // in the secrets file, so this branch is dead code until the schema
    // catches up with what the rest of the system already needs.
    case 'openrouter':
      return { apiKey: requireKey(config.apiKey), baseURL: 'https://openrouter.ai/api/v1' }
    default:
      throw new Error(`Unsupported provider: ${(config as { provider: string }).provider}`)
  }
}

function requireKey(apiKey: string | undefined): string {
  if (!apiKey) {
    throw new Error('Missing API key')
  }
  return apiKey
}
