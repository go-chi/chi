import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import TurndownService from 'turndown'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import WebRuntime from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchResult } from '@deepseek-ai/dsh-web'
import * as ToolWeb from '@deepseek-ai/dsh-tool-web'
import {
  formatSearchOutput,
  formatFetchOutput,
  parseSearchArgs,
  parseFetchArgs,
  presentSearchCall,
  presentFetchCall,
  presentSearchResult,
  presentFetchResult,
  searchMetaFromValue,
  searchMetaFromResult,
  fetchMetaFromValue,
  fetchMetaFromResult,
  WEB_SEARCH_MAX_RESULTS,
} from '@deepseek-ai/dsh-tool-web'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolResult } from '@deepseek-ai/dsh-tools'

const testToolSignal = new AbortController().signal

const available = true

function searchProvider(result: WebSearchResult, isAvailable = available): WebSearchProvider {
  return { id: 'stub-search', available: () => isAvailable, search: () => Promise.resolve(result) }
}

/** Mount the real registry, seam, and tool-web; return an executor helper. */
async function mountTools(opts: {
  config?: ToolWeb.Config
  webConfig?: ConstructorParameters<typeof WebRuntime>[1]
  search?: WebSearchProvider
  fetchProvider?: import('@deepseek-ai/dsh-web').WebFetchProvider
} = {}): Promise<{ ctx: Context; fiber: Awaited<ReturnType<Context['plugin']>>; call: (name: string, args: unknown) => Promise<ToolExecutionResult> }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(WebRuntime, opts.webConfig ?? {})
  if (opts.search) ctx.web.registerSearchProvider(opts.search)
  if (opts.fetchProvider) ctx.web.registerFetchProvider(opts.fetchProvider)
  const fiber = await ctx.plugin(ToolWeb, opts.config ?? {})
  let counter = 0
  const call = (name: string, args: unknown) => ctx.tools.execute({ signal: testToolSignal, callId: CallId(`call-${++counter}`), name, arguments: args })
  return { ctx, fiber, call }
}

describe('search formatting', () => {
  it('renders content, sources with titles/hostnames, snippets, and a citation reminder', () => {
    const out = formatSearchOutput({
      content: 'an answer', truncated: false,
      sources: [
        { url: 'https://a.test/x', title: 'A', snippet: 'about a', publishedAt: '2026-01-01' },
        { url: 'https://b.test/y' },
      ],
    })
    expect(out).toContain('an answer')
    expect(out).toContain('[A](https://a.test/x) — about a (2026-01-01)')
    expect(out).toContain('[b.test](https://b.test/y)')
    expect(out).toContain('Cite the relevant URLs')
  })

  it('reports no results when there is neither content nor sources', () => {
    expect(formatSearchOutput({ sources: [], truncated: false }))
      .toContain('No results found.')
  })

  it('renders content alone when there are no sources', () => {
    const out = formatSearchOutput({ content: 'just an answer', sources: [], truncated: false })
    expect(out).toContain('just an answer')
    expect(out).not.toContain('No results found.')
    expect(out).not.toContain('Sources:')
  })

  it('notes truncation', () => {
    const out = formatSearchOutput({ sources: [{ url: 'https://a.test' }], truncated: true })
    expect(out).toContain('Showing the first 1 sources')
  })

  it('validates the query', () => {
    expect(() => parseSearchArgs({ query: '   ' })).toThrow('non-empty')
    expect(parseSearchArgs({ query: 'hi' })).toEqual({ query: 'hi' })
  })

  it('falls back to the raw URL as a source label when the URL is unparseable', () => {
    const out = formatSearchOutput({ truncated: false, sources: [{ url: 'not a url' }] })
    expect(out).toContain('[not a url](not a url)')
  })

  it('presents a search call as a search-kind card titled by the query', () => {
    expect(presentSearchCall({ query: 'find me' })).toEqual({ card: 'generic', title: 'find me', kind: 'search', rawInput: 'find me' })
  })
})

/** Build a completed non-error tool result with the given meta and text content. */
function toolResult(meta: unknown, text = 'body', isError = false): ToolResult {
  const content: ContentBlock[] = [{ type: 'text', text }]
  return { content, isError, ...meta !== undefined ? { meta: meta as never } : {} }
}

describe('web_search presentation meta and result view', () => {
  it('projects sources, answer, and truncation into meta, omitting absent optional fields', () => {
    const meta = searchMetaFromValue({
      content: 'an answer', truncated: true,
      sources: [
        { url: 'https://a.test/x', title: 'A', snippet: 'about a', publishedAt: '2026-01-01' },
        { url: 'https://b.test/y' },
      ],
    })
    expect(meta).toEqual({
      answer: 'an answer',
      truncated: true,
      sources: [
        { url: 'https://a.test/x', title: 'A', snippet: 'about a', publishedAt: '2026-01-01' },
        { url: 'https://b.test/y' },
      ],
    })
  })

  it('omits answer from meta when the provider returned none', () => {
    const meta = searchMetaFromValue({ truncated: false, sources: [{ url: 'https://a.test' }] })
    expect(meta).toEqual({ truncated: false, sources: [{ url: 'https://a.test' }] })
  })

  it('round-trips projected meta back to a typed search meta', () => {
    const value = {
      content: 'ans', truncated: false,
      sources: [{ url: 'https://a.test', title: 'A', snippet: 's', publishedAt: '2026-01-01' }],
    }
    expect(searchMetaFromResult(searchMetaFromValue(value))).toEqual({
      answer: 'ans', truncated: false,
      sources: [{ url: 'https://a.test', title: 'A', snippet: 's', publishedAt: '2026-01-01' }],
    })
  })

  it('presents a completed search as a web/search card carrying the structured sources, titled by the query', () => {
    const meta = searchMetaFromValue({
      content: 'an answer', truncated: true,
      sources: [{ url: 'https://a.test', title: 'A', snippet: 'snip', publishedAt: '2026-07-20' }],
    })
    expect(presentSearchResult({ query: 'q' }, toolResult(meta, 'rendered'))).toEqual({
      card: 'web',
      kind: 'search',
      title: 'q',
      answer: 'an answer',
      truncated: true,
      sources: [{ url: 'https://a.test', title: 'A', snippet: 'snip', publishedAt: '2026-07-20' }],
    })
  })

  it('omits the answer from the view when meta carries none', () => {
    const meta = searchMetaFromValue({ truncated: false, sources: [{ url: 'https://a.test' }] })
    const view = presentSearchResult({ query: 'q' }, toolResult(meta))
    expect(view).toBeDefined()
    expect(view && 'answer' in view).toBe(false)
    expect(view && 'content' in view).toBe(false)
  })

  it('falls back to the generic card on an error result', () => {
    const meta = searchMetaFromValue({ truncated: false, sources: [{ url: 'https://a.test' }] })
    expect(presentSearchResult({ query: 'q' }, toolResult(meta, 'body', true))).toBeUndefined()
  })

  it('falls back to the generic card on absent or malformed meta', () => {
    expect(presentSearchResult({ query: 'q' }, toolResult(undefined))).toBeUndefined()
    expect(searchMetaFromResult(undefined)).toBeUndefined()
    expect(searchMetaFromResult(null)).toBeUndefined()
    expect(searchMetaFromResult('nope')).toBeUndefined()
    expect(searchMetaFromResult([])).toBeUndefined()
    expect(searchMetaFromResult({})).toBeUndefined()
    expect(searchMetaFromResult({ sources: 'x', truncated: false })).toBeUndefined()
    expect(searchMetaFromResult({ sources: [], truncated: 'no' })).toBeUndefined()
    expect(searchMetaFromResult({ sources: [], truncated: false, answer: 1 })).toBeUndefined()
    expect(searchMetaFromResult({ sources: [null], truncated: false })).toBeUndefined()
    expect(searchMetaFromResult({ sources: [{ url: 1 }], truncated: false })).toBeUndefined()
    expect(searchMetaFromResult({ sources: [{ url: 'u', title: 2 }], truncated: false })).toBeUndefined()
    expect(searchMetaFromResult({ sources: [{ url: 'u', snippet: 2 }], truncated: false })).toBeUndefined()
    expect(searchMetaFromResult({ sources: [{ url: 'u', publishedAt: 2 }], truncated: false })).toBeUndefined()
  })

  it('accepts an empty source list as valid meta', () => {
    expect(searchMetaFromResult({ sources: [], truncated: false })).toEqual({ sources: [], truncated: false })
  })
})

describe('fetch formatting', () => {
  const NO_CAP = 1_000_000
  const HEADER = 'Fetched https://a.test (HTTP 200)\n\n'
  const renderHtml = (content: string) => formatFetchOutput({
    url: 'https://a.test', statusCode: 200, truncated: false,
    body: { kind: 'html', content },
  }, NO_CAP).slice(HEADER.length)

  it('renders an html body to markdown text with a status header', () => {
    const out = formatFetchOutput({
      url: 'https://a.test', statusCode: 200, truncated: false,
      body: { kind: 'html', content: '<h1>Title</h1><p>Body text</p>' },
    }, NO_CAP)
    expect(out).toContain('Fetched https://a.test (HTTP 200)')
    expect(out).toContain('# Title')
    expect(out).toContain('Body text')
  })

  it('passes a text body through and notes truncation', () => {
    const out = formatFetchOutput({
      url: 'https://a.test', statusCode: 200, truncated: true,
      body: { kind: 'text', content: 'plain' },
    }, NO_CAP)
    expect(out).toContain('plain')
    expect(out).toContain('Content truncated')
  })

  it('caps the complete output and notes truncation, even when markdown escaping expands the body', () => {
    // 1,000 underscores render as 2,000 escaped characters — conversion can
    // outgrow a provider-side body cap, so the bound applies to the output.
    const out = formatFetchOutput({
      url: 'https://a.test', statusCode: 200, truncated: false,
      body: { kind: 'html', content: `<p>${'_'.repeat(1000)}</p>` },
    }, 500)
    expect(out.length).toBeLessThanOrEqual(500)
    expect(out).toContain('Fetched https://a.test (HTTP 200)')
    expect(out).toContain('\\_\\_')
    expect(out).toContain('Content truncated')
    // Exact and tiny caps: the complete result is bounded, header and footer included.
    const exact = formatFetchOutput({
      url: 'https://a.test', statusCode: 200, truncated: false,
      body: { kind: 'text', content: 'abc' },
    }, 'Fetched https://a.test (HTTP 200)\n\nabc'.length)
    expect(exact).toBe('Fetched https://a.test (HTTP 200)\n\nabc')
    const tiny = formatFetchOutput({
      url: 'https://a.test', statusCode: 200, truncated: true,
      body: { kind: 'text', content: 'abcdef' },
    }, 10)
    expect(tiny.length).toBeLessThanOrEqual(10)
    expect(tiny).toBe('Fetched ht')
  })

  it('dispatches text and html bodies', () => {
    expect(formatFetchOutput({
      url: 'https://a.test', statusCode: 200, truncated: false,
      body: { kind: 'text', content: 'x' },
    }, NO_CAP)).toBe(`${HEADER}x`)
    expect(renderHtml('<p>y</p>')).toBe('y')
  })

  it('converts html via turndown: entities, links, tables, nesting; drops script/style/noscript', () => {
    expect(renderHtml('<style>.x{}</style><script>bad()</script><noscript>ns</noscript><p>Tom &amp; Jerry &copy; R&eacute;sum&eacute;</p><a href="https://a.test">link</a>'))
      .toBe('Tom & Jerry © Résumé\n\n[link](https://a.test)')
    expect(renderHtml('<h2>Heading</h2><ul><li>one</li><li>two</li></ul>'))
      .toBe('## Heading\n\n-   one\n-   two')
    expect(renderHtml('<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>'))
      .toBe('| A   | B   |\n| --- | --- |\n| 1   | 2   |')
    expect(renderHtml('<table><thead><tr><th align="left">L</th><th align="right">R</th><th style="text-align:center">C</th></tr></thead><tbody><tr><td>1</td><td>2</td><td>3</td></tr></tbody></table>'))
      .toBe('| L   | R   | C   |\n| :--- | ---: | :---: |\n| 1   | 2   | 3   |')
    expect(renderHtml('<p><strong>bold <em>italic</em></strong></p><blockquote><p>quoted</p></blockquote>'))
      .toBe('**bold _italic_**\n\n> quoted')
  })

  it('does not expand numeric colspan attributes into unbounded output', () => {
    const table = '<table><thead><tr><th colspan="1000000">A</th></tr></thead><tbody><tr><td>B</td></tr></tbody></table>'
    expect(renderHtml(table)).toBe('| A   |\n| --- |\n| B   |')
  })

  it('passes deeply nested html through raw without attempting conversion', () => {
    // Unclosed-tag nesting makes the synchronous conversion superlinear
    // (seconds at 20k levels, during which the cooperative timeout cannot
    // fire), so the depth preflight skips conversion entirely; this must
    // return fast, not merely not-throw.
    const depth = 20_000
    const pathological = '<div>'.repeat(depth) + 'x' + '</div>'.repeat(depth)
    const started = Date.now()
    expect(formatFetchOutput({
      url: 'https://a.test', statusCode: 200, truncated: false,
      body: { kind: 'html', content: pathological },
    }, NO_CAP)).toBe(`${HEADER}${pathological}`)
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('comments and mismatched closing tags cannot hide deep nesting from the preflight', () => {
    const pathological = '<div><!-- </div> --></span>'.repeat(600) + 'x'
    expect(formatFetchOutput({
      url: 'https://a.test', statusCode: 200, truncated: false,
      body: { kind: 'html', content: pathological },
    }, NO_CAP)).toBe(`${HEADER}${pathological}`)
    const abruptlyClosedComments = '<div><!-->'.repeat(600) + 'x'
    expect(formatFetchOutput({
      url: 'https://a.test', statusCode: 200, truncated: false,
      body: { kind: 'html', content: abruptlyClosedComments },
    }, NO_CAP)).toBe(`${HEADER}${abruptlyClosedComments}`)
  })

  it('the preflight accepts ordinary closed, void, self-closing, quoted, and raw-text markup', () => {
    const paragraphs = '<p title=\'>\'>x<br   ><img src="x"><input/></p>'.repeat(600)
    const script = `<script>const invalid = '</scriptx>'; const template = '${'<div>'.repeat(600)}'</script >`
    expect(renderHtml(`<!doctype html><?pi><1bad>${paragraphs}${script}`))
      .not.toContain('<p')
    expect(renderHtml('plain text')).toBe('plain text')
    expect(renderHtml('<p>x</p><!-- unfinished')).toBe('x')
    expect(renderHtml('<script>unclosed')).toBe('')
    expect(renderHtml('<script>closed by slash</script/>')).toBe('')
    expect(renderHtml('<script>closed at end</script')).toBe('')
  })

  it('scans malformed unterminated tags in bounded time', () => {
    const malformed = '<a'.repeat(100_000)
    const started = Date.now()
    const out = formatFetchOutput({
      url: 'https://a.test', statusCode: 200, truncated: false,
      body: { kind: 'html', content: malformed },
    }, 200_000)
    expect(out.length).toBeLessThanOrEqual(200_000)
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('falls back to the raw html when turndown throws despite a shallow depth scan', () => {
    const spy = vi.spyOn(TurndownService.prototype, 'turndown').mockImplementation(() => {
      throw new RangeError('Maximum call stack size exceeded')
    })
    try {
      expect(formatFetchOutput({
        url: 'https://a.test', statusCode: 200, truncated: false,
        body: { kind: 'html', content: '<p>x</p>' },
      }, NO_CAP)).toBe(`${HEADER}<p>x</p>`)
    } finally {
      spy.mockRestore()
    }
  })

  it('bounds source conversion work before rendering a custom provider body', () => {
    const spy = vi.spyOn(TurndownService.prototype, 'turndown').mockReturnValue('converted')
    try {
      const out = formatFetchOutput({
        url: 'https://a.test', statusCode: 200, truncated: false,
        body: { kind: 'html', content: `<p>${'x'.repeat(10_000)}</p>` },
      }, 500)
      expect(spy).toHaveBeenCalledWith(`<p>${'x'.repeat(497)}`)
      expect(out.length).toBeLessThanOrEqual(500)
      expect(out).toContain('Content truncated')
    } finally {
      spy.mockRestore()
    }
  })

  it('validates url (non-empty), no timeout parameter', () => {
    expect(() => parseFetchArgs({ url: ' ' })).toThrow('non-empty')
    expect(parseFetchArgs({ url: 'https://a.test' })).toEqual({ url: 'https://a.test' })
  })

  it('presents a fetch call as a fetch-kind card titled by the url', () => {
    expect(presentFetchCall({ url: 'https://a.test' })).toEqual({ card: 'generic', title: 'https://a.test', kind: 'fetch', rawInput: 'https://a.test' })
  })
})

describe('web_fetch presentation meta and result view', () => {
  const NO_CAP = 1_000_000

  it('projects url, status, and the provider truncation into meta', () => {
    expect(fetchMetaFromValue({ url: 'https://a.test', statusCode: 404, truncated: true, body: { kind: 'text', content: 'x' } }, NO_CAP))
      .toEqual({ url: 'https://a.test', statusCode: 404, truncated: true })
  })

  it('projects truncated: true when the output cap cut a body the provider did not, matching the render footer', () => {
    // The provider reports truncated: false, but conversion outgrows the cap, so
    // the render text carries the truncation footer. The meta must agree.
    const value = {
      url: 'https://a.test', statusCode: 200, truncated: false,
      body: { kind: 'html' as const, content: `<p>${'_'.repeat(1000)}</p>` },
    }
    const meta = fetchMetaFromValue(value, 500) as { truncated: boolean }
    expect(meta.truncated).toBe(true)
    expect(formatFetchOutput(value, 500)).toContain('Content truncated')
  })

  it('projects truncated: false when neither the provider nor the cap cut the body', () => {
    const value = {
      url: 'https://a.test', statusCode: 200, truncated: false,
      body: { kind: 'text' as const, content: 'short' },
    }
    const meta = fetchMetaFromValue(value, NO_CAP) as { truncated: boolean }
    expect(meta.truncated).toBe(false)
    expect(formatFetchOutput(value, NO_CAP)).not.toContain('Content truncated')
  })

  it('converts one HTML body once across the render and meta projections of the same result', () => {
    // The registry calls output.render and output.presentationMeta with the same
    // frozen result value; the memo must collapse them into one turndown walk so
    // a large or deeply nested page is not parsed and converted twice. A second
    // cap on the same result is a distinct entry, so it converts again.
    const spy = vi.spyOn(TurndownService.prototype, 'turndown')
    const value = {
      url: 'https://a.test', statusCode: 200, truncated: false,
      body: { kind: 'html' as const, content: '<p>hello</p>' },
    }
    try {
      formatFetchOutput(value, NO_CAP)
      fetchMetaFromValue(value, NO_CAP)
      expect(spy).toHaveBeenCalledTimes(1)
      formatFetchOutput(value, NO_CAP - 1)
      expect(spy).toHaveBeenCalledTimes(2)
    } finally {
      spy.mockRestore()
    }
  })

  it('presents a completed fetch as a web/fetch card carrying the summary, titled by the url, without content', () => {
    const meta = fetchMetaFromValue({ url: 'https://a.test', statusCode: 200, truncated: false, body: { kind: 'text', content: '# Title' } }, NO_CAP)
    expect(presentFetchResult({ url: 'https://a.test' }, toolResult(meta, '# Title'))).toEqual({
      card: 'web',
      kind: 'fetch',
      title: 'https://a.test',
      url: 'https://a.test',
      statusCode: 200,
      truncated: false,
    })
  })

  it('falls back to the generic card on an error result', () => {
    const meta = fetchMetaFromValue({ url: 'https://a.test', statusCode: 200, truncated: false, body: { kind: 'text', content: 'ok' } }, NO_CAP)
    expect(presentFetchResult({ url: 'https://a.test' }, toolResult(meta, 'body', true))).toBeUndefined()
  })

  it('falls back to the generic card on absent or malformed meta', () => {
    expect(presentFetchResult({ url: 'https://a.test' }, toolResult(undefined))).toBeUndefined()
    expect(fetchMetaFromResult(undefined)).toBeUndefined()
    expect(fetchMetaFromResult(null)).toBeUndefined()
    expect(fetchMetaFromResult('nope')).toBeUndefined()
    expect(fetchMetaFromResult([])).toBeUndefined()
    expect(fetchMetaFromResult({})).toBeUndefined()
    expect(fetchMetaFromResult({ url: 1, statusCode: 200, truncated: false })).toBeUndefined()
    expect(fetchMetaFromResult({ url: 'u', statusCode: 'x', truncated: false })).toBeUndefined()
    expect(fetchMetaFromResult({ url: 'u', statusCode: 200, truncated: 'no' })).toBeUndefined()
  })
})

describe('tool-web registration', () => {
  it('registers both tools by default', async () => {
    const { fiber, ctx } = await mountTools()
    const names = ctx.tools.schemas().map(s => s.name)
    expect(names).toContain('web_search')
    expect(names).toContain('web_fetch')
    expect(ctx.tools.executionMode({ signal: testToolSignal, callId: CallId('search-safe'), name: 'web_search', arguments: { query: 'q' } }))
      .toEqual({ kind: 'parallel' })
    expect(ctx.tools.executionMode({ signal: testToolSignal, callId: CallId('fetch-safe'), name: 'web_fetch', arguments: { url: 'https://a.test' } }))
      .toEqual({ kind: 'parallel' })
    await fiber.dispose()
    expect(ctx.tools.schemas().map(s => s.name)).not.toContain('web_search')
  })

  it('registers only enabled tools', async () => {
    const { fiber, ctx } = await mountTools({ config: { search: true, fetch: false } })
    const names = ctx.tools.schemas().map(s => s.name)
    expect(names).toContain('web_search')
    expect(names).not.toContain('web_fetch')
    await fiber.dispose()
  })

  it('registers only web_fetch when search is disabled', async () => {
    const { fiber, ctx } = await mountTools({ config: { search: false, fetch: true } })
    const names = ctx.tools.schemas().map(s => s.name)
    expect(names).not.toContain('web_search')
    expect(names).toContain('web_fetch')
    await fiber.dispose()
  })

  it('registers web_search even when no provider is available (schema follows enablement, not availability)', async () => {
    const { fiber, ctx, call } = await mountTools()
    expect(ctx.tools.schemas().map(s => s.name)).toContain('web_search')
    // No provider is registered: the schema stays visible and execution reports
    // the structured unavailability instead.
    const out = await call('web_search', { query: 'q' })
    expect(out.error?.info?.code).toBe('WEB_PROVIDER_UNAVAILABLE')
    await fiber.dispose()
  })

  it('contributes prompt sections for the enabled tools', async () => {
    const { fiber, ctx } = await mountTools()
    const prompt = await ctx.systemPrompt.assemble()
    const text = prompt.sections.map(s => s.text).join('\n')
    expect(text).toContain('Use the web_search tool to discover current information on the web. It returns an optional answer plus a list of source URLs. Follow up with web_fetch when you need the full content of a specific result, and cite the relevant URLs as markdown links.')
    expect(text).toContain('Use the web_fetch tool to retrieve the content of a specific HTTP(S) URL')
    await fiber.dispose()
  })

  it('does not advertise web_fetch in search-only prompt guidance', async () => {
    const { fiber, ctx } = await mountTools({ config: { search: true, fetch: false } })
    const prompt = await ctx.systemPrompt.assemble()
    const text = prompt.sections.map(s => s.text).join('\n')
    expect(text).toContain('Use the returned source snippets when available')
    expect(text).not.toContain('web_fetch')
    await fiber.dispose()
  })
})

describe('tool-web execution through the real registry', () => {
  it('executes web_search and formats the result', async () => {
    const result: WebSearchResult = {
      content: 'answer', truncated: false,
      sources: [{ url: 'https://a.test', title: 'A', snippet: 'snip', publishedAt: '2026-07-20' }],
    }
    const { fiber, call } = await mountTools({ webConfig: { searchProvider: 'stub-search' }, search: searchProvider(result) })
    const out = await call('web_search', { query: 'q' })
    expect(out.isError).toBe(false)
    expect(out.value).toEqual(result)
    expect(out.content.map(b => b.type === 'text' ? b.text : '').join('')).toContain('[A](https://a.test)')
    await fiber.dispose()
  })

  it('projects the search sources into the tool result meta and derives its web/search view', async () => {
    const result: WebSearchResult = {
      content: 'answer', truncated: true,
      sources: [{ url: 'https://a.test', title: 'A', snippet: 'snip', publishedAt: '2026-07-20' }],
    }
    const { ctx, fiber, call } = await mountTools({ webConfig: { searchProvider: 'stub-search' }, search: searchProvider(result) })
    const out = await call('web_search', { query: 'q' })
    expect(out.meta).toEqual({
      answer: 'answer', truncated: true,
      sources: [{ url: 'https://a.test', title: 'A', snippet: 'snip', publishedAt: '2026-07-20' }],
    })
    const view = ctx.tools.get('web_search')?.presentResult?.({ query: 'q' }, { content: out.content, isError: out.isError, ...out.meta !== undefined ? { meta: out.meta } : {} })
    expect(view).toMatchObject({ card: 'web', kind: 'search', truncated: true, answer: 'answer' })
    await fiber.dispose()
  })

  it('projects the fetch summary into the tool result meta and derives its web/fetch view', async () => {
    const fetchProvider = {
      id: 'stub-fetch',
      available: () => available,
      fetch: (request: { url: string }) => Promise.resolve({
        url: request.url, statusCode: 200, body: { kind: 'text' as const, content: 'ok' }, truncated: true,
      }),
    }
    const { ctx, fiber, call } = await mountTools({ webConfig: { fetchProvider: 'stub-fetch' }, fetchProvider })
    const out = await call('web_fetch', { url: 'https://a.test' })
    expect(out.meta).toEqual({ url: 'https://a.test', statusCode: 200, truncated: true })
    const view = ctx.tools.get('web_fetch')?.presentResult?.({ url: 'https://a.test' }, { content: out.content, isError: out.isError, ...out.meta !== undefined ? { meta: out.meta } : {} })
    expect(view).toMatchObject({ card: 'web', kind: 'fetch', url: 'https://a.test', statusCode: 200, truncated: true })
    await fiber.dispose()
  })

  it('surfaces a structured WebError when no provider is available', async () => {
    const { fiber, call } = await mountTools()
    const out = await call('web_search', { query: 'q' })
    expect(out.isError).toBe(true)
    expect(out.error?.info?.code).toBe('WEB_PROVIDER_UNAVAILABLE')
    await fiber.dispose()
  })

  it('surfaces WEB_PROVIDER_AMBIGUOUS for multiple unconfigured providers', async () => {
    const { ctx, fiber, call } = await mountTools({ search: searchProvider({ sources: [], truncated: false }) })
    ctx.web.registerSearchProvider({ id: 'other', available: () => available, search: () => Promise.resolve({ sources: [], truncated: false }) })
    const out = await call('web_search', { query: 'q' })
    expect(out.isError).toBe(true)
    expect(out.error?.info?.code).toBe('WEB_PROVIDER_AMBIGUOUS')
    await fiber.dispose()
  })

  it('rejects invalid arguments with a structured INVALID_ARGS error', async () => {
    const { fiber, call } = await mountTools({ webConfig: { searchProvider: 'stub-search' }, search: searchProvider({ sources: [], truncated: false }) })
    const out = await call('web_search', { query: 123 })
    expect(out.isError).toBe(true)
    expect(out.error?.info?.code).toBe('INVALID_ARGS')
    await fiber.dispose()
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in ToolWeb).toBe(false)
  })

  it('executes web_fetch, forwarding the url (no timeout param) and the abort signal to the seam', async () => {
    const seen: { request?: { url: string }; signal?: AbortSignal | undefined } = {}
    const fetchProvider = {
      id: 'stub-fetch',
      available: () => available,
      fetch: (request: { url: string }, signal?: AbortSignal) => {
        seen.request = request
        seen.signal = signal
        return Promise.resolve({ url: request.url, statusCode: 200, body: { kind: 'text' as const, content: 'ok' }, truncated: false })
      },
    }
    const { ctx, fiber } = await mountTools({ webConfig: { fetchProvider: 'stub-fetch' }, fetchProvider })
    const controller = new AbortController()
    const out = await ctx.tools.execute({ callId: CallId('fetch-1'), name: 'web_fetch', arguments: { url: 'https://a.test' }, signal: controller.signal })
    expect(out.isError).toBe(false)
    expect(out.value).toEqual({
      url: 'https://a.test',
      statusCode: 200,
      body: { kind: 'text', content: 'ok' },
      truncated: false,
    })
    // The model schema exposes no timeout: the tool forwards only the url; the
    // tool-call budget is owned by dsh-tool-call-timeout-policy over exec.signal.
    expect(seen.request).toEqual({ url: 'https://a.test' })
    expect(seen.signal).toBe(controller.signal)
    await fiber.dispose()
  })

  it('forwards the required caller signal to web_fetch', async () => {
    const seen: { signal?: AbortSignal | undefined; passedSignal?: boolean } = {}
    const fetchProvider = {
      id: 'stub-fetch',
      available: () => available,
      fetch: (request: { url: string }, signal?: AbortSignal) => {
        seen.passedSignal = signal !== undefined
        seen.signal = signal
        return Promise.resolve({ url: request.url, statusCode: 200, body: { kind: 'text' as const, content: 'ok' }, truncated: false })
      },
    }
    const { ctx, fiber } = await mountTools({ webConfig: { fetchProvider: 'stub-fetch' }, fetchProvider })
    const out = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('fetch-2'), name: 'web_fetch', arguments: { url: 'https://a.test' } })
    expect(out.isError).toBe(false)
    expect(out.value).toEqual({
      url: 'https://a.test',
      statusCode: 200,
      body: { kind: 'text', content: 'ok' },
      truncated: false,
    })
    expect(seen.passedSignal).toBe(true)
    expect(seen.signal).toBe(testToolSignal)
    await fiber.dispose()
  })

  it('executes web_search, forwarding the abort signal to the seam', async () => {
    const seen: { signal?: AbortSignal | undefined } = {}
    const provider: WebSearchProvider = {
      id: 'stub-search',
      available: () => available,
      search: (_request, signal) => { seen.signal = signal; return Promise.resolve({ sources: [], truncated: false }) },
    }
    const { ctx, fiber } = await mountTools({ webConfig: { searchProvider: 'stub-search' }, search: provider })
    const controller = new AbortController()
    await ctx.tools.execute({ callId: CallId('search-1'), name: 'web_search', arguments: { query: 'q' }, signal: controller.signal })
    expect(seen.signal).toBe(controller.signal)
    await fiber.dispose()
  })
})

describe('searchMaxResults is plugin config', () => {
  it('forwards the default cap to the seam when unconfigured', async () => {
    const seen: { maxResults?: number | undefined } = {}
    const provider: WebSearchProvider = {
      id: 'stub-search',
      available: () => available,
      search: (request) => { seen.maxResults = request.maxResults; return Promise.resolve({ sources: [], truncated: false }) },
    }
    const { fiber, call } = await mountTools({ webConfig: { searchProvider: 'stub-search' }, search: provider })
    await call('web_search', { query: 'q' })
    expect(seen.maxResults).toBe(WEB_SEARCH_MAX_RESULTS)
    await fiber.dispose()
  })

  it('forwards a configured cap to the seam, which enforces it', async () => {
    const sources = Array.from({ length: 5 }, (_, i) => ({ url: `https://s${i}.test` }))
    const provider: WebSearchProvider = {
      id: 'stub-search',
      available: () => available,
      search: () => Promise.resolve({ sources, truncated: false }),
    }
    const { fiber, call } = await mountTools({ config: { searchMaxResults: 2 }, webConfig: { searchProvider: 'stub-search' }, search: provider })
    const out = await call('web_search', { query: 'q' })
    expect(out.isError).toBe(false)
    const body = out.content.map(b => b.type === 'text' ? b.text : '').join('')
    expect(body).toContain('https://s1.test')
    expect(body).not.toContain('https://s2.test')
    expect(body).toContain('Showing the first 2 sources.')
    await fiber.dispose()
  })

  it.each([
    ['zero', 0],
    ['negative', -3],
    ['fractional', 1.5],
  ])('rejects a %s searchMaxResults at load', async (_label, value) => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(WebRuntime, {})
    await expect(ctx.plugin(ToolWeb, { searchMaxResults: value }))
      .rejects.toThrow(/tool-web: searchMaxResults must be a positive integer/)
  })
})

describe('tool-call timeout budget is plugin config', () => {
  it('attaches the default 30s budget to web_fetch and web_search', async () => {
    const { fiber, ctx } = await mountTools()
    expect(ctx.tools.get('web_fetch')?.timeoutMs).toBe(30_000)
    expect(ctx.tools.get('web_search')?.timeoutMs).toBe(30_000)
    await fiber.dispose()
  })

  it('honors per-tool timeout overrides from config', async () => {
    const { fiber, ctx } = await mountTools({ config: { fetchTimeoutMs: 60_000, searchTimeoutMs: 10_000 } })
    expect(ctx.tools.get('web_fetch')?.timeoutMs).toBe(60_000)
    expect(ctx.tools.get('web_search')?.timeoutMs).toBe(10_000)
    await fiber.dispose()
  })

  it.each([
    ['fetchTimeoutMs', { fetchTimeoutMs: 0 }],
    ['searchTimeoutMs', { searchTimeoutMs: -5 }],
  ])('rejects a non-positive-integer %s at load', async (key, config) => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(WebRuntime, {})
    await expect(ctx.plugin(ToolWeb, config))
      .rejects.toThrow(new RegExp(`tool-web: ${key} must be a positive integer`))
  })
})

describe('fetchMaxOutputChars is plugin config', () => {
  it('bounds the rendered output of the registered web_fetch tool', async () => {
    const fetchProvider = {
      id: 'stub-fetch',
      available: () => available,
      fetch: (request: { url: string }) => Promise.resolve({
        url: request.url,
        statusCode: 200,
        body: { kind: 'html' as const, content: `<p>${'_'.repeat(1_000)}</p>` },
        truncated: false,
      }),
    }
    const { fiber, call } = await mountTools({
      config: { fetchMaxOutputChars: 100 },
      webConfig: { fetchProvider: 'stub-fetch' },
      fetchProvider,
    })
    const out = await call('web_fetch', { url: 'https://a.test' })
    expect(out.content.map(block => block.type === 'text' ? block.text : '').join('')).toHaveLength(100)
    await fiber.dispose()
  })

  it.each([0, -1, 1.5])('rejects an invalid fetchMaxOutputChars value %s at load', async (value) => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(WebRuntime, {})
    await expect(ctx.plugin(ToolWeb, { fetchMaxOutputChars: value }))
      .rejects.toThrow(/tool-web: fetchMaxOutputChars must be a positive integer/)
  })
})
