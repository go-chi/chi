import { describe, expect, it } from 'vitest'
import { PerplexitySearchProvider, PERPLEXITY_DEFAULT_BASE_URL, PERPLEXITY_DEFAULT_MAX_TOKENS, PERPLEXITY_DEFAULT_MODEL } from '@deepseek-ai/dsh-web-search-perplexity'

/**
 * Real-API smoke for the Perplexity search provider. Self-skips without
 * `$PERPLEXITY_API_KEY`, per the with-key e2e policy in docs/testing.md.
 */
const apiKey = process.env.PERPLEXITY_API_KEY
const maybe = apiKey !== undefined && apiKey.length > 0 ? describe : describe.skip

maybe('PerplexitySearchProvider real API', () => {
  it('returns a generated answer and sources for a live query', async () => {
    const provider = new PerplexitySearchProvider({
      apiKey: apiKey!,
      baseURL: process.env.PERPLEXITY_BASE_URL ?? PERPLEXITY_DEFAULT_BASE_URL,
      model: process.env.PERPLEXITY_MODEL ?? PERPLEXITY_DEFAULT_MODEL,
      maxTokens: PERPLEXITY_DEFAULT_MAX_TOKENS,
    })
    const result = await provider.search({ query: 'What is DeepSeek Harness?', maxResults: 5 })
    expect(result.content ?? '').not.toBe('')
    for (const source of result.sources) expect(source.url).toMatch(/^https?:\/\//)
  }, 30_000)
})
