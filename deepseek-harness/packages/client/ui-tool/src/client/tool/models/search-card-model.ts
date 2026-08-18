/**
 * Pure derivation of the search-card props from a frozen call slice: the
 * `card:'search'` render intent the `grep` and `glob` tools declare arrives on
 * the snapshot as `resultView`, and this is the one place that turns it into
 * what {@link SearchBlock} draws. Both conversation render sites (the chat tool
 * row's resident body and the details panel's Output section) call this, so the
 * grouped matches or the path list they show are derived once.
 *
 * The search card is result-time only: a search call has no matches or paths
 * before `execute`, so its pending state stays a `GenericCallView`
 * ({@link module:@deepseek-ai/dsh-tools/src/presentation}). This derivation
 * therefore reads only `resultView` and returns null for a still-running call,
 * unlike the terminal card whose call view carries the command before
 * execution.
 *
 * A capped result also carries a recovery locator (grep/glob's `Full … stored
 * at …` footer) in the raw `tool/result` content, not in the structured
 * matches/paths the view carries. Since both render sites replace that raw
 * result with the card, this derivation surfaces the block's own result text as
 * {@link SearchCardModel.recovery} so the one path to the dropped rows is not
 * lost.
 * @module
 */
import type { SearchBlockProps, SearchFileGroup } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallBlock } from './tool-call-model.ts'

/**
 * Distributive `Omit`: a plain `Omit<A | B, K>` keeps only the keys common to
 * both members, which would drop the `files`/`paths` discriminated fields.
 * Distributing over the naked type parameter `T` preserves each shape.
 */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never

/** The {@link SearchBlockProps} union minus each render site's own fields. */
type SearchBlockModelProps = DistributiveOmit<SearchBlockProps, 'maxLines' | 'className'>

/**
 * Result rows the chat row's resident search body shows before collapsing the
 * middle — half the primitive's own default, which the details panel keeps. A
 * chat row is a summary surface inside the message flow: the flow must stay
 * scannable across many calls, while the details panel is the single-call
 * reading surface. A design constant of this UI's row geometry, not a
 * deployment choice, so it is fixed here rather than a plugin Config field.
 */
export const CHAT_SEARCH_MAX_LINES = 8

/**
 * The {@link SearchBlock} props this derivation owns. Held as a nested object
 * (`card`) so a render site spreads exactly the primitive's own surface and can
 * never leak a neighbouring field into it. `maxLines`/`className` belong to each
 * render site.
 */
export interface SearchCardModel {
  /**
   * The props {@link SearchBlock} draws, minus each render site's own
   * `maxLines`/`className`.
   */
  card: SearchBlockModelProps
  /**
   * The result view's replacement title, which the presentation contract lets a
   * search tool set at settle time. Absent when the presenter supplied none; a
   * row then keeps its args-derived summary.
   */
  title: string | undefined
  /**
   * The raw `tool/result` text, flattened, surfaced only when the search was
   * capped. The card renders the retained matches or paths, but the recovery
   * locator a capped result carries — grep/glob's `Full … stored at: <locator>`
   * footer, the one way to reach the rows the cap dropped — lives only in the raw
   * result text, which the card replaces. A UI that shows the card would
   * otherwise lose it. Absent when the result was not capped (the card holds
   * every result) or the block carries no text.
   */
  recovery: string | undefined
}

/**
 * Whether every file group in a matches view is structurally valid: the wire
 * frame carries `shape` and `card` as strings the host schema checks, but not the
 * grouped `files` fields, so a version mismatch or loose producer could deliver
 * `shape: 'matches'` with a missing or malformed `files`. Rendering that would
 * crash {@link SearchBlock} at `.reduce`/`.map`; invalid fields select the
 * generic path instead.
 * @param files - the candidate `files` field off the untrusted result view.
 * @returns whether `files` is a valid {@link SearchFileGroup} array.
 */
function isValidFiles(files: unknown): files is SearchFileGroup[] {
  return Array.isArray(files) && files.every(file =>
    typeof file === 'object' && file !== null
    && typeof (file as { path?: unknown }).path === 'string'
    && Array.isArray((file as { matches?: unknown }).matches)
    && (file as { matches: unknown[] }).matches.every(match =>
      typeof match === 'object' && match !== null
      && typeof (match as { lineNumber?: unknown }).lineNumber === 'number'
      && typeof (match as { line?: unknown }).line === 'string'))
}

/**
 * Flatten a settled tool result's content blocks to their text, joined by
 * newlines. The search view carries no result text — a UI without a card falls
 * back to the raw `tool/result` content — so the truncation recovery footer is
 * read from the block's own content here. Non-text blocks (a search result
 * carries none) are skipped.
 * @param content - the result node's content blocks.
 * @returns the joined text, or undefined when empty.
 */
function flattenContent(content: readonly { type: string; text?: string }[]): string | undefined {
  const text = content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
  return text === '' ? undefined : text
}

/**
 * Derive the search-card props for a tool call, or null when this call is not a
 * search card and belongs on the generic path.
 *
 * Only the result side matters: the search card carries no call-time state, so
 * a still-running call (no result view) is null, as is a settled call whose
 * result view is not a search card — including a `card` value this UI version
 * does not know, which arrives over the wire and cannot be trusted to be one of
 * the compiled variants, a `card: 'search'` view whose `shape` is neither
 * `matches` nor `paths` (equally untrusted wire data), and a generic result a
 * `grep`/`glob` failure or nested `run_code` dispatch produces (its text keeps
 * the generic path).
 * @param block - RunningToolCall or ToolResultNode off the snapshot caches.
 * @returns the search-card props, or null for the generic path.
 */
export function searchCardModel(block: ToolCallBlock): SearchCardModel | null {
  // Running: no result view exists yet, and a search card is result-only.
  if (!('kind' in block)) return null
  const result = block.resultView?.card === 'search' ? block.resultView : null
  if (result === null) return null
  const common = { truncated: result.truncated, total: result.total }
  // The recovery footer only matters when the tool capped the result: an
  // uncapped card holds every match/path, so the raw text adds nothing the card
  // does not already show. When capped, the raw result's `Full … stored at …`
  // locator is the only way to retrieve the omitted rows, so include it.
  const recovery = result.truncated ? flattenContent(block.content) : undefined
  if (result.shape === 'matches') {
    // `files` rides the untrusted wire frame: the host schema checks `card`/`shape`
    // strings but not the grouped `files` fields, so validate them before
    // SearchBlock, which would crash on a missing or malformed `files`.
    // Invalid fields select the generic view.
    if (!isValidFiles(result.files)) return null
    return { title: result.title, recovery, card: { kind: 'matches', files: result.files, ...common } }
  }
  // `shape` rides the same untrusted wire frame as `card`, so a version mismatch
  // or a loose protocol producer could deliver a `card: 'search'` subtype this
  // client does not compile. Guard the paths shape explicitly: an unknown shape
  // falls to the generic path rather than being rendered as a paths card, which
  // would leave SearchBlock calling `.length`/`.map` on an absent `paths`.
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- shape is wire data; the compiled union cannot prove this exhaustive.
  if (result.shape !== 'paths') return null
  // `paths` is likewise unchecked by the wire schema; a known shape with a
  // missing/malformed array would crash the paths card at `.map`.
  if (!Array.isArray(result.paths) || !result.paths.every((path): path is string => typeof path === 'string')) return null
  return { title: result.title, recovery, card: { kind: 'paths', paths: result.paths, ...common } }
}
