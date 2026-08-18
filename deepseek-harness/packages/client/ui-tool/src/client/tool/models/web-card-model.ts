/**
 * Pure derivation of the web-card props from a frozen call slice: the
 * `card:'web'` render intent the `web_search`/`web_fetch` tools declare at
 * result time arrives on the snapshot as `resultView`, and this is the one
 * place that turns it into what {@link WebBlock} draws. Both conversation
 * render sites (the chat tool row's resident/expanded body and the details
 * panel's Output section) call this, so the sources and fetch summary they
 * show are derived once.
 *
 * The web card is result-only by contract: those tools keep a generic pending
 * call view, so there is nothing to derive while the call is still running and
 * a running call always takes the generic path.
 * @module
 */
import type { WebBlockProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallBlock } from './tool-call-model.ts'

/**
 * Derive the web-card props for a tool call, or null when this call is not a
 * web card and belongs on the generic path.
 *
 * The result side supplies the whole card: the sources and answer for a
 * `search`, the URL and status for a `fetch`. Cases producing null, all of
 * them the documented generic-card default:
 *
 * - A running call (no `resultView` yet): the web tools keep a generic pending
 *   card, so nothing web-shaped exists until the call settles.
 * - A settled call whose result view is not a web card — including a `card`
 *   value this UI version does not know, which arrives over the wire and so
 *   cannot be trusted to be one of the compiled variants, and a generic result
 *   view (a web tool's error path returns the generic card, whose text the
 *   generic path preserves).
 * - A web card whose `kind` this UI version does not know (a newer host's
 *   value): the wire cannot be trusted to be `search` or `fetch`, so it takes
 *   the generic path rather than rendering as a malformed fetch.
 * @param block - RunningToolCall or ToolResultNode off the snapshot caches.
 * @returns the web-card props, or null for the generic path.
 */
export function webCardModel(block: ToolCallBlock): WebBlockProps | null {
  // Running calls have no result view; the web card is result-only.
  if (!('kind' in block)) return null
  const result = block.resultView
  if (result?.card !== 'web') return null
  if (result.kind === 'search') {
    return {
      kind: 'search',
      answer: result.answer,
      sources: result.sources.map(source => ({
        url: source.url,
        title: source.title,
        snippet: source.snippet,
        publishedAt: source.publishedAt,
      })),
      truncated: result.truncated,
    }
  }
  // Discriminate `fetch` explicitly rather than treating it as the else of
  // `search`: a `kind` this UI version does not know arrives over the wire from
  // a newer host, and reading it as a fetch would draw an empty URL and
  // `HTTP undefined`. It takes the generic path, the same wire-boundary default
  // an unknown `card` tag takes above. The static union narrows `kind` to
  // `'fetch'` here, but the runtime value is off the wire, so the guard and its
  // null fallthrough are load-bearing despite the type.
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  if (result.kind === 'fetch') {
    return {
      kind: 'fetch',
      url: result.url,
      statusCode: result.statusCode,
      truncated: result.truncated,
    }
  }
  return null
}
