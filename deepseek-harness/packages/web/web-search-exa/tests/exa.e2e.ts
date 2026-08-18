import { describe, expect, it } from 'vitest'
import { ExaSearchProvider, EXA_DEFAULT_BASE_URL, EXA_DEFAULT_HIGHLIGHTS_PER_RESULT, EXA_DEFAULT_SEARCH_TYPE } from '@deepseek-ai/dsh-web-search-exa'

/**
 * Real-API smoke for the Exa search provider. Self-skips without `$EXA_API_KEY`
 * (CI has no secrets), per the with-key e2e policy in docs/testing.md.
 */
const apiKey = process.env.EXA_API_KEY
const maybe = apiKey !== undefined && apiKey.length > 0 ? describe : describe.skip

maybe('ExaSearchProvider real API', () => {
  it('returns sources for a live query', async () => {
    const provider = new ExaSearchProvider({
      apiKey: apiKey!,
      baseURL: process.env.EXA_BASE_URL ?? EXA_DEFAULT_BASE_URL,
      searchType: EXA_DEFAULT_SEARCH_TYPE,
      highlightsPerResult: EXA_DEFAULT_HIGHLIGHTS_PER_RESULT,
    })
    const result = await provider.search({ query: 'DeepSeek Harness', maxResults: 5 })
    expect(result.sources.length).toBeGreaterThan(0)
    for (const source of result.sources) expect(source.url).toMatch(/^https?:\/\//)
  }, 30_000)
})
