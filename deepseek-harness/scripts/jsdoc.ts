/**
 * Shared JSDoc parsing and completeness checks for the Cordis, persistence,
 * and config catalogs and the exported-API gate.
 */

import ts from 'typescript'

/** Repo-relative source pointer `file:line` for a node's first character. */
export function pointer(rel: string, sf: ts.SourceFile, node: ts.Node): string {
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
  return `${rel}:${line + 1}`
}

/** The raw `/** … *​/` JSDoc block immediately preceding a node, or '' if none. */
export function rawJsDoc(text: string, node: ts.Node): string {
  const ranges = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []
  const jsdoc = ranges.filter(r => text.slice(r.pos, r.pos + 3) === '/**').at(-1)
  return jsdoc ? text.slice(jsdoc.pos, jsdoc.end) : ''
}

/** A dispatch mode, rendered as the badge after an event name in the catalog. */
export type Mode = 'emit' | 'waterfall' | 'parallel' | 'serial' | 'bail'

/**
 * Parse a raw JSDoc block into description prose and an optional `@mode`. Prose
 * ends at the first block tag, paragraphs collapse to one line, bullet items
 * remain separate lines, and `{@link X}` renders as `X`.
 * @param raw - the raw comment text including the JSDoc delimiters.
 * @returns the collapsed description prose, parsed valid `@mode` (or null),
 *   and whether any `@mode` tag was present.
 */
export function parseJsDoc(raw: string): { doc: string; mode: Mode | null; hasMode: boolean } {
  const inner = raw
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map(l => l.replace(/^\s*\*?\s?/, '').replace(/\s+$/, ''))
  let mode: Mode | null = null
  let hasMode = false
  let inTags = false
  const blocks: string[] = []
  let para: string[] = []
  let list: string[] = []
  let item: string[] = []
  const join = (parts: string[]): string => parts.join(' ').replace(/\s+/g, ' ').trim()
  const flushItem = (): void => {
    if (item.length) list.push(join(item))
    item = []
  }
  const flushList = (): void => {
    flushItem()
    if (list.length) blocks.push(list.join('\n')) // one block, items on own lines
    list = []
  }
  const flushPara = (): void => {
    flushList()
    if (para.length) blocks.push(join(para))
    para = []
  }
  for (const line of inner) {
    const tagLine = line.trimStart()
    const m = /^@mode\s+(emit|waterfall|parallel|serial|bail)\s*$/.exec(tagLine)
    if (m) { mode = m[1] as Mode; hasMode = true; flushPara(); inTags = true; continue }
    if (/^@mode\b/.test(tagLine)) { hasMode = true; flushPara(); inTags = true; continue }
    if (tagLine.startsWith('@')) { flushPara(); inTags = true; continue }
    if (inTags) continue // block-tag territory: continuations are never prose
    if (line.trim() === '') { flushPara(); continue }
    if (/^-\s+/.test(line)) {
      // A list item starts: a pending paragraph (e.g. an intro line directly
      // above the list, no blank between) flushes FIRST so it renders above.
      flushItem()
      if (para.length) { blocks.push(join(para)); para = [] }
      item.push(line)
      continue
    }
    if (item.length) { item.push(line); continue } // continuation of current item
    para.push(line)
  }
  flushPara()
  const doc = blocks.join('\n\n').replace(/\{@link\s+([^}]+)\}/g, '$1').trim()
  return { doc, mode, hasMode }
}

/**
 * Parse `@param` and `@returns` descriptions, including continuation lines.
 * Parameter separators are optional and `[optional]` names unwrap.
 * @param raw - the raw comment text including the JSDoc delimiters.
 * @returns the `@param` name→description map plus the `@returns` description
 * (null when the tag is absent, '' when present but empty).
 */
export function parseTags(raw: string): { params: Map<string, string>; returns: string | null } {
  const inner = raw
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map(l => l.replace(/^\s*\*?\s?/, '').replace(/\s+$/, ''))
  const params = new Map<string, string>()
  let returns: string | null = null
  let sink: ((text: string) => void) | null = null
  for (const line of inner) {
    const param = /^@param\s+(\[?[\w$]+\]?)\s*(?:[-—–]\s*)?(.*)$/.exec(line)
    if (param) {
      const name = (param[1] ?? '').replace(/^\[|\]$/g, '')
      let acc = param[2] ?? ''
      params.set(name, acc)
      sink = (t) => { acc = acc ? `${acc} ${t}` : t; params.set(name, acc) }
      continue
    }
    const ret = /^@returns?(?:\s+[-—–]?\s*(.*))?$/.exec(line)
    if (ret) {
      let acc = ret[1] ?? ''
      returns = acc
      sink = (t) => { acc = acc ? `${acc} ${t}` : t; returns = acc }
      continue
    }
    if (line.startsWith('@') || line.trim() === '') { sink = null; continue }
    sink?.(line.trim())
  }
  return { params, returns }
}

/**
 * Require a non-empty tag for each non-exempt identifier parameter, reject
 * binding-pattern parameters, and reject stale tags. Exempt parameters may
 * still be documented.
 * @param where - the offender label violations open with, e.g. `event 'x' (file:1)`.
 * @param apiKind - API kind used in binding-pattern diagnostics.
 * @param parameters - the declaration's parameter list.
 * @param tags - the parsed `@param` name→description map from parseTags.
 * @param sf - source file used to render binding patterns.
 * @param isExempt - parameters whose tag is optional, such as `this` or waterfall `next`.
 * @param violations - the aggregate list violations append to.
 */
export function checkParams(
  where: string,
  apiKind: string,
  parameters: readonly ts.ParameterDeclaration[],
  tags: Map<string, string>,
  sf: ts.SourceFile,
  isExempt: (p: ts.ParameterDeclaration) => boolean,
  violations: string[],
): void {
  for (const p of parameters) {
    if (!ts.isIdentifier(p.name)) {
      violations.push(`${where}: parameter '${p.name.getText(sf)}' is a binding pattern; the ${apiKind} API needs simple identifier parameters so @param can name them.`)
      continue
    }
    if (isExempt(p)) continue
    const desc = tags.get(p.name.text)
    if (desc === undefined) violations.push(`${where} is missing @param ${p.name.text}.`)
    else if (!desc.trim()) violations.push(`${where}: @param ${p.name.text} has an empty description.`)
  }
  for (const tag of tags.keys()) {
    if (!parameters.some(p => ts.isIdentifier(p.name) && p.name.text === tag)) {
      violations.push(`${where}: @param ${tag} does not match any parameter (stale tag?).`)
    }
  }
}

/**
 * Check the `@returns` half of the completeness contract: a non-`void` / `Promise<void>`
 * return needs a non-empty `@returns`, and the return type must be ANNOTATED — a pure-AST
 * walk cannot classify an inferred return. Void returns may still carry an
 * optional tag, for example to document resolution timing.
 * @param where - the offender label violations open with.
 * @param typeNode - the declared return type annotation, or undefined when inferred.
 * @param returns - the parsed `@returns` description from parseTags (null when absent).
 * @param sf - the source file (for rendering the annotation's text).
 * @param violations - the aggregate list violations append to.
 */
export function checkReturns(
  where: string,
  typeNode: ts.TypeNode | undefined,
  returns: string | null,
  sf: ts.SourceFile,
  violations: string[],
): void {
  if (typeNode === undefined) {
    violations.push(`${where} has no return type annotation; annotate it explicitly so the gate can classify the result.`)
    return
  }
  const rt = typeNode.getText(sf).replace(/\s+/g, ' ')
  if (/^(void|Promise<void>)$/.test(rt)) return
  if (returns === null) violations.push(`${where} is missing @returns (return type: ${rt}).`)
  else if (!returns.trim()) violations.push(`${where}: @returns has an empty description.`)
}

/**
 * Throw one aggregate error for every completeness violation a walk collected.
 * Aggregation (vs failing fast) is deliberate: a remediation pass sees the
 * whole list at once instead of replaying the gate once per offender.
 * @param gate - the reporting gate's name, prefixed to the error message.
 * @param violations - the collected violation lines; no-op when empty.
 */
export function reportViolations(gate: string, violations: string[]): void {
  if (violations.length === 0) return
  throw new Error(
    `${gate}: ${violations.length} JSDoc completeness violation(s) (see AGENTS.md):\n`
    + violations.map(v => `  ${v}`).join('\n'),
  )
}
