// ReadBlock: the file surface for a read tool result — a banner (label +
// language + a "showing N of M" note when the read is a window + a copy
// control) over line-numbered, syntax-highlighted source. Each row carries the
// file's OWN line number in a gutter, so a windowed read past an offset keeps
// its file numbering rather than re-counting from 1. Highlighting reuses the
// CodeBlock shiki path (highlight.ts) at the per-line granularity a gutter
// needs; an unknown or absent language renders plain monospace. Long content is
// height-capped with the same head/tail arithmetic TerminalBlock uses, so the
// two cards collapse a long body at the same place. Colors resolve through
// --shiki-*/--dsw-* tokens.

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import clsx from 'clsx'
import { writeClipboard } from './clipboard.ts'
import {
  grammarLoadCount,
  highlightLines,
  subscribeGrammarLoaded,
  type HighlightSpan,
} from './markdown/highlight.ts'
import css from './ReadBlock.module.css'

/**
 * Content lines shown before the height cap collapses the middle. Matches
 * TerminalBlock's default so a long read and a long command output cut at the
 * same place in the same flow.
 */
export const DEFAULT_READ_MAX_LINES = 16

/** One line of the read window: its file line number and its text (no trailing newline). */
export interface ReadBlockLine {
  /** 1-based line number in the file (a window past an offset keeps the file's own numbering). */
  number: number
  /** The line's text, already truncated to the read tool's per-line cap. */
  text: string
}

export interface ReadBlockProps {
  /** Banner label (the file path, or a tool-supplied replacement title); omitted draws no label. */
  label?: string | undefined
  /** The returned window's lines, in file order, each keeping its file line number. */
  lines: readonly ReadBlockLine[]
  /** Exact total line count in the file, for the "showing N of M" note when the read is a window. */
  totalLines: number
  /** Grammar hint (a file-extension-derived language id); unknown or absent = plain monospace. */
  lang?: string | undefined
  /** Height cap in content lines before the middle collapses (default {@link DEFAULT_READ_MAX_LINES}). */
  maxLines?: number | undefined
  /** Extra class merged onto the wrapper (callers position; this component draws). */
  className?: string | undefined
}

/**
 * Render one line's highlighted runs. The css-variables theme colors every run,
 * so each run is a styled span; a line with no highlighting at all takes the
 * bare-text path in the caller instead (an unknown or absent language).
 * @param spans - the line's styled runs.
 * @returns the line's children.
 */
function renderSpans(spans: readonly HighlightSpan[]) {
  return spans.map((span, index) => <span key={index} style={span.style}>{span.text}</span>)
}

/**
 * Render a read tool result as a line-numbered, optionally syntax-highlighted
 * file view.
 * @param props - see {@link ReadBlockProps}.
 * @returns the read block element.
 */
export function ReadBlock({
  label,
  lines,
  totalLines,
  lang,
  maxLines = DEFAULT_READ_MAX_LINES,
  className,
}: ReadBlockProps) {
  // The raw text the copy control writes and the highlighter tokenizes: the
  // window's lines joined by newlines, without the file numbers or any chrome.
  // Highlighting the whole window in one call (not line by line) keeps grammar
  // context across lines — a multi-line string or comment stays one construct.
  const raw = useMemo(() => lines.map(line => line.text).join('\n'), [lines])
  // Re-render when a lazy grammar finishes loading, so a read card that showed
  // plain text while its language's grammar imported picks up highlighting. The
  // snapshot value is opaque; only its change across renders drives the memo.
  const loaded = useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount, grammarLoadCount)
  // Per-line highlighted runs aligned 1:1 with `lines`; undefined for an
  // unknown/absent (or not-yet-loaded) language, when every line renders as
  // bare text.
  const highlighted = useMemo(() => highlightLines(raw, lang), [raw, lang, loaded])
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const onCopy = useCallback(() => {
    if (copied) return
    // The window's raw text, never the rendered tree: the gutter numbers and the
    // banner are chrome the file does not contain.
    void writeClipboard(raw).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1000)
    })
  }, [copied, raw])

  const onToggle = useCallback(() => { setExpanded(value => !value) }, [])

  const hidden = lines.length - maxLines
  const capped = hidden > 0 && !expanded
  // Same split arithmetic as TerminalBlock's height cap, so a long read and a
  // long command output slice their head and tail at the same place.
  const headLines = Math.ceil(maxLines / 2)
  const tailLines = maxLines - headLines
  // A read is a window when its returned lines are fewer than the file's total;
  // the note states that so a reader is not misled that the file ends here.
  const windowed = lines.length < totalLines

  /**
   * Render a slice of the line array as gutter-numbered rows.
   * @param slice - the lines to draw, each with its aligned run array.
   * @returns the row elements.
   */
  const rows = (slice: readonly (readonly [ReadBlockLine, readonly HighlightSpan[] | undefined])[]) =>
    slice.map(([line, spans]) => (
      <div key={line.number} className={css.line}>
        <span className={css.gutter} aria-hidden>{line.number}</span>
        <span className={css.content}>{spans === undefined ? line.text : renderSpans(spans)}</span>
      </div>
    ))

  // Pair each line with its aligned run array up front, so head/tail slicing
  // keeps the two in step without re-indexing.
  const paired = lines.map((line, index): readonly [ReadBlockLine, readonly HighlightSpan[] | undefined] =>
    [line, highlighted?.[index]])

  return (
    <div className={clsx(css.block, className)} data-read="">
      <div className={css.banner}>
        <div className={css.label}>{label ?? ''}</div>
        <div className={css.action}>
          {windowed && (
            <span className={css.count}>{`显示 ${lines.length} / ${totalLines} 行`}</span>
          )}
          <span className={css.lang}>{lang ?? ''}</span>
          {/* Hide copy on an empty window, matching TerminalBlock's empty-output
              guard: a successful read of an empty file returns lines: [] with
              card:'read', so this branch is reachable, and copying then would
              wipe the clipboard with an empty string. */}
          {lines.length > 0 && (
            <button type="button" className={css.copyButton} onClick={onCopy}>
              {copied ? '复制成功' : '复制'}
            </button>
          )}
        </div>
      </div>
      <div className={css.body}>
        {rows(capped ? paired.slice(0, headLines) : paired)}
        {hidden > 0 && (
          <button
            type="button"
            className={css.expand}
            aria-expanded={expanded}
            aria-label={expanded ? '收起内容' : `展开其余 ${hidden} 行`}
            onClick={onToggle}
          >
            {expanded ? '收起' : `… 其余 ${hidden} 行`}
          </button>
        )}
        {capped && rows(paired.slice(paired.length - tailLines))}
      </div>
    </div>
  )
}
