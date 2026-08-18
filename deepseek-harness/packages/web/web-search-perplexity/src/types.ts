/**
 * Wire types for the Perplexity search API (`POST https://api.perplexity.ai/chat/completions`,
 * an OpenAI-compatible chat shape). Results prefer structured `search_results` and fall back to
 * URL-only `citations`; the provider-private wire shape does not depend on `ctx.llm`.
 * @module @deepseek-ai/dsh-web-search-perplexity/types
 */

/** Request body sent to Perplexity's chat-completions endpoint. */
export interface PerplexityRequest {
  model: string
  messages: { role: 'user'; content: string }[]
}

/** One structured search result (the preferred citation shape). */
export interface PerplexitySearchResult {
  url: string
  title?: string | null
  snippet?: string | null
  date?: string | null
}

/** Perplexity's response envelope. */
export interface PerplexityResponse {
  choices?: { message?: { content?: string | null } }[]
  /** Structured citation data (preferred). */
  search_results?: PerplexitySearchResult[]
  /** URL-only citation fallback. */
  citations?: string[]
}

/** Perplexity's error response envelope (best-effort; fields vary). */
export interface PerplexityError {
  error?: { message?: string } | string
  message?: string
}
