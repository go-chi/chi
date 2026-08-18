// WebBlock: the surface for a completed web retrieval. One component draws both
// kinds of the `web` render intent, discriminated by `kind`: a `search` shows an
// optional provider answer above a citation list of sources (each a safe
// external link labelled by its title, or its hostname when the provider gave
// none, with the snippet and publication date below it), and a `fetch` shows a
// compact retrieval summary (the linked final URL and its HTTP status). Both
// mark a capped retrieval. Every link is a same-origin-safe external anchor:
// only http(s) URLs become anchors (target/rel set) — the http(s) subset of the
// allowlist MarkdownText applies to untrusted assistant-authored links (it also
// permits mailto, excluded here); an unparseable or non-http URL renders as
// plain text. Geometry, radius, and fonts mirror CodeBlock/TerminalBlock so a
// web card reads as one family with them; the whole source list renders inside a
// fixed-height scroll container (its `.sources` max-height), so a long list
// scrolls in place rather than growing the card — and that container's
// `padding-left` must stay wide enough for the widest `<li>` marker, since a
// scroll container clips inline-start overflow irrecoverably. The card draws every source the
// view carries: the tool already cut the list to its source cap, and `truncated`
// reports that cut. A content-only transform downstream of the tool — spill-policy
// replacing an oversized result's text while leaving its presentationMeta whole —
// can still narrow what the model reads below this list.

import clsx from 'clsx'
import { MarkdownText } from './markdown/MarkdownText.tsx'
import css from './WebBlock.module.css'

/**
 * One citeable source drawn in a search card: the projection of the contract's
 * `WebSource`, with the optional fields kept optional so a provider that
 * returned only a URL still renders (its hostname becomes the label).
 */
export interface WebSourceView {
  /** The source URL; becomes a safe external link when it is http(s). */
  url: string
  /** The source title; when absent the URL's hostname labels the link. */
  title?: string | undefined
  /** A short excerpt or summary shown under the link. */
  snippet?: string | undefined
  /** Publication/crawl timestamp, a provider-supplied string shown under the link. */
  publishedAt?: string | undefined
}

/** A `web_search` card: an optional answer over a capped citation list. */
export interface WebSearchBlockProps {
  kind: 'search'
  /** The provider-generated answer, rendered as markdown above the sources. */
  answer?: string | undefined
  /** The cited sources, in provider order. */
  sources: WebSourceView[]
  /** True when the tool cut the source list to its result cap. */
  truncated: boolean
  /** Extra class merged onto the wrapper (callers position; this component draws). */
  className?: string | undefined
}

/** A `web_fetch` card: the retrieval summary for one fetched URL. */
export interface WebFetchBlockProps {
  kind: 'fetch'
  /** The final URL after allowed redirects; becomes a safe external link when http(s). */
  url: string
  /** HTTP status code of the fetched response. */
  statusCode: number
  /** True when the provider or the output cap cut the fetched content. */
  truncated: boolean
  /** Extra class merged onto the wrapper (callers position; this component draws). */
  className?: string | undefined
}

/** A completed web retrieval card, discriminated by `kind`. */
export type WebBlockProps = WebSearchBlockProps | WebFetchBlockProps

/**
 * The URL to link to, or undefined when the URL must render as plain text. Only
 * http(s) becomes a navigable external anchor, so a `javascript:`/`data:`/`file:`
 * URL or an unparseable string never reaches the DOM as an href. This is the
 * http(s) subset of the allowlist MarkdownText applies to untrusted links —
 * MarkdownText also permits `mailto:`, deliberately excluded here since a
 * retrieval URL is never a mail address.
 * @param url - the source or fetch URL, from tool result content.
 * @returns the href to use, or undefined for plain text.
 */
function safeHref(url: string): string | undefined {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
}

/**
 * The link's visible label: the title when the provider gave one, otherwise the
 * URL's hostname, falling back to the raw URL when it does not parse OR parses
 * to an empty hostname (a `file:`/`data:`/`javascript:` URL), so a label is
 * never blank.
 * @param url - the source URL.
 * @param title - the provider title, if any.
 * @returns the label text.
 */
function linkLabel(url: string, title: string | undefined): string {
  if (title !== undefined && title !== '') return title
  try {
    const { hostname } = new URL(url)
    return hostname === '' ? url : hostname
  } catch {
    return url
  }
}

/**
 * A single URL rendered as a safe external anchor, or as plain text when the
 * URL is not an http(s) link.
 * @param props.url - the URL to render.
 * @param props.label - the visible label.
 * @param props.className - class for the anchor or the plain span.
 * @returns the anchor or span element.
 */
function SafeLink({ url, label, className }: { url: string; label: string; className?: string | undefined }) {
  const href = safeHref(url)
  if (href === undefined) return <span className={className}>{label}</span>
  return (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  )
}

/**
 * One source row in a search card: the safe link plus its snippet and date. The
 * `<li value>` pins the source's 1-based citation index explicitly rather than
 * relying on the `<ol>`'s implicit numbering, so a row reads by its real index
 * even inside the scroll container.
 * @param props.source - the source to render.
 * @param props.ordinal - the source's 1-based position in the full list.
 * @returns the source list item.
 */
function SourceItem({ source, ordinal }: { source: WebSourceView; ordinal: number }) {
  return (
    <li className={css.source} value={ordinal}>
      <SafeLink url={source.url} label={linkLabel(source.url, source.title)} className={css.sourceLink} />
      {source.snippet !== undefined && source.snippet !== '' && (
        <div className={css.snippet}>{source.snippet}</div>
      )}
      {source.publishedAt !== undefined && source.publishedAt !== '' && (
        <div className={css.published}>{source.publishedAt}</div>
      )}
    </li>
  )
}

/**
 * The search card body: the answer over the full source list, which scrolls in
 * place once it exceeds the `.sources` container height.
 * @param props - see {@link WebSearchBlockProps}.
 * @returns the search card element.
 */
function WebSearchBlock({ answer, sources, truncated, className }: WebSearchBlockProps) {
  // A provider may legitimately return no answer and no sources; the chat WebRow
  // does not show the raw result content, so without this the user would see an
  // empty card. Mirror the backend's `No results found.` render text.
  const empty = (answer === undefined || answer === '') && sources.length === 0
  return (
    <div className={clsx(css.block, className)} data-web="search">
      {answer !== undefined && answer !== '' && (
        <div className={css.answer}><MarkdownText text={answer} /></div>
      )}
      {empty ? (
        <div className={css.empty}>未找到结果</div>
      ) : (
        <ol className={css.sources}>
          {sources.map((source, index) => <SourceItem key={index} source={source} ordinal={index + 1} />)}
        </ol>
      )}
      {truncated && <div className={css.truncated}>来源列表已截断</div>}
    </div>
  )
}

/**
 * The fetch card body: the linked URL and its HTTP status.
 * @param props - see {@link WebFetchBlockProps}.
 * @returns the fetch card element.
 */
function WebFetchBlock({ url, statusCode, truncated, className }: WebFetchBlockProps) {
  return (
    <div className={clsx(css.block, css.fetch, className)} data-web="fetch">
      <SafeLink url={url} label={url} className={css.fetchUrl} />
      <div className={css.fetchMeta}>
        <span className={css.status}>HTTP {statusCode}</span>
        {truncated && <span className={css.truncated}>内容已截断</span>}
      </div>
    </div>
  )
}

/**
 * Render a completed web retrieval as a structured card.
 * @param props - see {@link WebBlockProps}; `kind` selects the search or fetch body.
 * @returns the web card element.
 */
export function WebBlock(props: WebBlockProps) {
  return props.kind === 'search' ? <WebSearchBlock {...props} /> : <WebFetchBlock {...props} />
}
