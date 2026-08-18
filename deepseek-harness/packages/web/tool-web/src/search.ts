/**
 * The model-facing `web_search` tool: discover current information on the web.
 * Execution goes through `ctx.web` — this module owns only the model-facing
 * schema, argument validation, the result-count bound, and result formatting,
 * never provider selection or network access.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, JsonValue, ToolResult, WebSearchResultView, WebSource } from '@deepseek-ai/dsh-tools'
import type { WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import type {} from '@deepseek-ai/dsh-system-prompt'

/**
 * Default upper bound on returned sources (the `searchMaxResults` config).
 * Owned by the consumer (not the provider or model), mirroring `dsh-tool-fs`'s
 * `READ_LIMIT`. The model just asks a question; the product controls how much
 * context returns. The default `8` aligns with OpenCode's Exa default.
 */
export const WEB_SEARCH_MAX_RESULTS = 8

/**
 * Validate value constraints the schema DSL can't express: a non-blank
 * `query`. Throws a plain `Error` otherwise.
 *
 * @param args - the schema-validated `web_search` arguments.
 * @returns the accepted arguments, passed through unchanged.
 */
export function parseSearchArgs(args: { query: string }): { query: string } {
  if (args.query.trim().length === 0) throw new Error('query must be a non-empty string')
  return { query: args.query }
}

/** Display label for a source: its title, else its hostname. */
function sourceLabel(url: string, title: string | undefined): string {
  if (title !== undefined && title.length > 0) return title
  try {
    return new URL(url).hostname
  } catch {
    // A provider should return a valid URL, but never let a malformed one throw
    // out of pure formatting — fall back to the raw string.
    return url
  }
}

/**
 * Format a search result as one model-facing text block.
 *
 * @param result - the seam's search outcome.
 * @returns the provider answer (when any), a markdown source list with snippet
 *   and date metadata (or `No results found.`), a refine-the-query note when
 *   truncated, and a standing cite-your-sources instruction.
 */
export function formatSearchOutput(result: WebSearchResult): string {
  const parts: string[] = []
  if (result.content !== undefined && result.content.length > 0) parts.push(result.content)

  if (result.sources.length > 0) {
    const lines = result.sources.map((source) => {
      const label = sourceLabel(source.url, source.title)
      const meta: string[] = []
      if (source.snippet !== undefined && source.snippet.length > 0) meta.push(source.snippet)
      if (source.publishedAt !== undefined && source.publishedAt.length > 0) meta.push(`(${source.publishedAt})`)
      const suffix = meta.length > 0 ? ` — ${meta.join(' ')}` : ''
      return `- [${label}](${source.url})${suffix}`
    })
    parts.push(`Sources:\n${lines.join('\n')}`)
  } else if (result.content === undefined || result.content.length === 0) {
    parts.push('No results found.')
  }

  if (result.truncated) parts.push(`(Showing the first ${result.sources.length} sources. Refine the query for more.)`)
  parts.push('Cite the relevant URLs above as markdown links in your answer.')
  return parts.join('\n\n')
}

/**
 * Pending-call presentation: a search card titled by the query.
 *
 * @param args - the raw tool arguments; only `query` feeds the view.
 * @returns the generic card view (`kind: 'search'`) shown while the call runs.
 */
export function presentSearchCall(args: { query: string }): GenericCallView {
  return { card: 'generic', title: args.query, kind: 'search', rawInput: args.query }
}

/**
 * The `web_search` tool's private `tool/result` `meta` payload: the structured
 * sources, the optional provider answer, and the truncation flag. Attached
 * opaquely (as `JsonValue`) on the tool result and persisted with the session
 * log, so `presentResult` reproduces the search card on replay. This projection
 * is the only faithful route to the per-source fields, which the lossy render
 * text cannot carry (the owning rationale is the web-result-card Agent Note).
 */
export interface WebSearchMeta {
  /** The faithful structured sources, in result order. */
  sources: WebSource[]
  /** True when the seam cut the source list to honor the result cap. */
  truncated: boolean
  /** The provider-generated answer text, when any. */
  answer?: string
}

/**
 * Project one seam source into a plain object that omits every absent optional
 * field. Shared by the canonical `execute` result and its replayable
 * presentation meta so both carry byte-identical source shapes.
 *
 * @param source - one source from the `ctx.web` search outcome.
 * @returns `{ url }` plus each present optional field.
 */
function projectSource(source: WebSearchSource): {
  url: string
  title?: string
  snippet?: string
  publishedAt?: string
} {
  return {
    url: source.url,
    ...source.title !== undefined ? { title: source.title } : {},
    ...source.snippet !== undefined ? { snippet: source.snippet } : {},
    ...source.publishedAt !== undefined ? { publishedAt: source.publishedAt } : {},
  }
}

/**
 * Project a validated `web_search` output value into its replayable
 * presentation meta ({@link WebSearchMeta} as opaque JSON).
 *
 * @param value - the canonical `web_search` output value (the seam's result shape).
 * @returns the structured sources, the truncation flag, and the answer when present.
 */
export function searchMetaFromValue(value: WebSearchResult): JsonValue {
  return {
    sources: value.sources.map(projectSource),
    truncated: value.truncated,
    ...value.content !== undefined ? { answer: value.content } : {},
  }
}

/** Whether `value` is a valid {@link WebSource} (defensive narrowing from opaque `meta`). */
function isWebSource(value: unknown): value is WebSource {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { url, title, snippet, publishedAt } = value as Record<string, unknown>
  return typeof url === 'string'
    && (title === undefined || typeof title === 'string')
    && (snippet === undefined || typeof snippet === 'string')
    && (publishedAt === undefined || typeof publishedAt === 'string')
}

/**
 * Narrow opaque live or replayed result metadata to a {@link WebSearchMeta}.
 * Malformed metadata returns `undefined` so presentation can fall back to the
 * generic card instead of throwing during replay.
 *
 * @param meta - result metadata.
 * @returns the validated search meta, or `undefined` for absent or malformed data.
 */
export function searchMetaFromResult(meta: unknown): WebSearchMeta | undefined {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const { sources, truncated, answer } = meta as Record<string, unknown>
  if (!Array.isArray(sources) || !sources.every(isWebSource)) return undefined
  if (typeof truncated !== 'boolean') return undefined
  if (answer !== undefined && typeof answer !== 'string') return undefined
  return {
    sources,
    truncated,
    ...answer !== undefined ? { answer } : {},
  }
}

/**
 * Completed-call presentation: a `web` search card carrying the faithful
 * structured sources from `meta`. It sets no `content` copy — a UI without the
 * `web` capability falls back to the raw `tool/result` content, which is the
 * same text (see the web-result-card Agent Note).
 *
 * @param args - the raw tool arguments; `query` becomes the result-state title so
 *   a window-truncated replay that dropped the call head still has one.
 * @param result - the final model-facing tool result; `meta` carries the sources.
 * @returns the search result view, or `undefined` (generic card) on failure or
 *   malformed meta.
 */
export function presentSearchResult(args: { query: string }, result: ToolResult): WebSearchResultView | undefined {
  if (result.isError) return undefined
  const meta = searchMetaFromResult(result.meta)
  if (meta === undefined) return undefined
  return {
    card: 'web',
    kind: 'search',
    title: args.query,
    sources: meta.sources,
    truncated: meta.truncated,
    ...meta.answer !== undefined ? { answer: meta.answer } : {},
  }
}

/**
 * Register the `web_search` tool and its system-prompt guidance.
 *
 * @param ctx - context whose `tools` and `systemPrompt` registries receive the
 *   registrations; both are effect-scoped and unregister on plugin dispose.
 * @param maxResults - the deployment's source cap, sent as every seam
 *   request's `maxResults`.
 * @param timeoutMs - the cooperative tool-call budget (ms) attached as the tool's
 *   `ToolDefinition.timeoutMs` for `@deepseek-ai/dsh-tool-call-timeout-policy` to enforce.
 * @param fetchEnabled - whether the same composition exposes `web_fetch`, which
 *   controls whether search guidance may recommend that follow-up tool.
 */
export function applyWebSearchTool(
  ctx: Context,
  maxResults: number,
  timeoutMs: number,
  fetchEnabled: boolean,
): void {
  ctx.systemPrompt.section({
    name: 'tool:web_search',
    order: 110,
    text: fetchEnabled
      ? 'Use the web_search tool to discover current information on the web. It returns an optional answer plus a list of source URLs. Follow up with web_fetch when you need the full content of a specific result, and cite the relevant URLs as markdown links.'
      : 'Use the web_search tool to discover current information on the web. It returns an optional answer plus a list of source URLs. Use the returned source snippets when available, and cite the relevant URLs as markdown links.',
  })

  ctx.tools.register(defineTool({
    name: 'web_search',
    description: 'Search the web for current information. Returns an optional summary answer and a list of source URLs.',
    parameters: {
      query: { type: 'string', required: true, description: 'The search query.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          content: { type: 'string' },
          sources: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                url: { type: 'string', required: true },
                title: { type: 'string' },
                snippet: { type: 'string' },
                publishedAt: { type: 'string' },
              },
            },
          },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatSearchOutput(value) }],
      presentationMeta: (_args, value) => searchMetaFromValue(value),
    },
    timeoutMs,
    // Provider reads do not mutate parent-agent state.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const input = parseSearchArgs(args)
      const result = await ctx.web.search(
        { query: input.query, maxResults },
        exec.signal,
      )
      return {
        ...result.content !== undefined ? { content: result.content } : {},
        sources: result.sources.map(projectSource),
        truncated: result.truncated,
      }
    },
    presentCall: presentSearchCall,
    presentResult: (args, result) => presentSearchResult(args, result),
  }))
}
