/**
 * Pure parsing and structural helpers for the bilingual-document pairing
 * gate. Kept separate from the CLI so corpus discovery and signature behavior
 * can be regression-tested without reading or mutating the repository tree.
 * Also the one home of the generated-region grammar and the pair-record
 * primitives, shared by the pairing gate and the region-injecting generators.
 */

import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import type { Nodes } from 'mdast'

/** Complete opening marker line: `<!-- BEGIN GENERATED <slug> … -->` (slug captured). */
const GENERATED_REGION_BEGIN_LINE = /^<!-- BEGIN GENERATED (\S+)(?: [^>]*)? -->$/
/** Complete closing marker line: `<!-- END GENERATED <slug> -->` (slug captured). */
const GENERATED_REGION_END_LINE = /^<!-- END GENERATED (\S+) -->$/
/** Loose marker detector: any line that LOOKS like a region marker must parse as one. */
const GENERATED_REGION_MARKER_HINT = /^<!-- (?:BEGIN|END) GENERATED /

/**
 * Extract every generated region (markers included) and the document with
 * those regions removed. Regions are line-delimited: a marker occupies its
 * whole line, must be a complete well-formed marker, and the closing slug
 * must match the opener. The stripped form is what "human content" means for
 * the region-aware pair-record guard.
 *
 * @param content - Full Markdown document text.
 * @returns The regions in document order and the region-free remainder.
 * @throws Error on an unopened END, unclosed BEGIN, nested BEGIN, malformed
 *   marker line, or a closing slug that does not match its opener.
 */
export function partitionGeneratedRegions(content: string): { regions: string[]; stripped: string } {
  const lines = content.split('\n')
  const regions: string[] = []
  const kept: string[] = []
  let open: { slug: string; lines: string[] } | null = null
  for (const line of lines) {
    const begin = GENERATED_REGION_BEGIN_LINE.exec(line)
    if (begin?.[1]) {
      if (open) throw new Error('generated region BEGIN marker nested inside an open region')
      open = { slug: begin[1], lines: [line] }
      continue
    }
    const end = GENERATED_REGION_END_LINE.exec(line)
    if (end?.[1]) {
      if (!open) throw new Error('generated region END marker without a BEGIN')
      if (end[1] !== open.slug) throw new Error(`generated region END slug '${end[1]}' does not match its BEGIN slug '${open.slug}'`)
      open.lines.push(line)
      regions.push(open.lines.join('\n'))
      open = null
      continue
    }
    if (GENERATED_REGION_MARKER_HINT.test(line)) {
      throw new Error(`malformed generated region marker line: ${JSON.stringify(line)}`)
    }
    if (open) open.lines.push(line)
    else kept.push(line)
  }
  if (open) throw new Error('generated region BEGIN marker without an END')
  return { regions, stripped: kept.join('\n') }
}

/**
 * Full git blob hash of file content (what `git hash-object` prints).
 * @param content - Exact file bytes.
 * @returns The 40-hex-digit SHA-1 blob hash.
 */
export function blobHash(content: Buffer): string {
  const hash = createHash('sha1')
  hash.update(`blob ${content.byteLength}\0`)
  hash.update(content)
  return hash.digest('hex')
}

const PAIR_META_LINE = /^([^:#]+\.md): ([0-9a-f]{40})$/

/**
 * Parse a `foo.i18n.yaml` consistency record into basename → recorded blob
 * hash, or undefined when any non-comment line deviates from the exact
 * `<basename>.md: <40-hex>` format or repeats a key. Consumers must
 * additionally require exactly the two expected basenames — a renamed key is
 * a malformed record, never a silently-missing entry.
 * @param content - Sidecar file text.
 * @returns The recorded map, or undefined for a malformed record.
 */
export function parsePairMeta(content: string): Map<string, string> | undefined {
  const out = new Map<string, string>()
  for (const line of content.split('\n')) {
    if (line === '' || line.startsWith('#')) continue
    const match = PAIR_META_LINE.exec(line)
    if (!match?.[1] || !match[2]) return undefined
    if (out.has(match[1])) return undefined
    out.set(match[1], match[2])
  }
  return out
}

/**
 * Render a `foo.i18n.yaml` consistency record.
 * @param source - Repo-relative English path.
 * @param sourceHash - Blob hash of the English side.
 * @param zh - Repo-relative Chinese path.
 * @param zhHash - Blob hash of the Chinese side.
 * @returns The exact sidecar file content.
 */
export function renderPairMeta(source: string, sourceHash: string, zh: string, zhHash: string): string {
  return [
    '# Bilingual-pair consistency record (docs/i18n/README.md): the git blob hash of each',
    '# side as of the last confirmed-consistent state. Both languages carry equal authority;',
    '# after editing either side, bring the other along and re-record with:',
    `#   pnpm run verify-translation-pairing --write ${source}`,
    `${basename(source)}: ${sourceHash}`,
    `${basename(zh)}: ${zhHash}`,
    '',
  ].join('\n')
}

/** Validated fields of `scripts/translation-pairing.manifest.json`. */
export interface TranslationPairingManifest {
  /** Source documents exempt from pairing because they are generated, instructional, or bilingual by construction. */
  excluded: string[]
}

const README_ARTIFACT = /(?:^|\/)readme(?:\.md|\.zh\.md|\.i18n\.yaml)$/i
const ROOT_CONTRIBUTING_ARTIFACT = /^contributing(?:\.md|\.zh\.md|\.i18n\.yaml)$/i
const NON_SOURCE_DIRECTORIES = new Set([
  'node_modules',
  'lib',
  '.pnpm-store',
  '.cache',
  'coverage',
  '.sessions',
  '.storages',
  'tmp',
  'dist-exe',
  '__pycache__',
  '.pytest_cache',
  '.artifacts',
  'vendor',
])

/** Glob traversal exclusions corresponding to the non-source path predicate. */
export const TRANSLATION_SCOPE_GLOB_EXCLUDES = [
  '.agents/notes/archived/**',
  '**/node_modules/**',
  '**/lib/**',
  '**/.pnpm-store/**',
  '**/.cache/**',
  '**/coverage/**',
  '**/.doc-typecheck-*/**',
  '**/.node-next-types-*/**',
  '**/.sessions/**',
  '**/.storages/**',
  '**/tmp/**',
  '**/dist-exe/**',
  '**/__pycache__/**',
  '**/.pytest_cache/**',
  'apps/web/dist/**',
  '.artifacts/**',
  'python/sdk-runtime/src/deepseek_harness_runtime/runtime/dsh-jsonrpc-agent-*/**',
  'python/sdk-runtime/src/deepseek_harness_runtime/runtime/node/**',
  'vendor/**',
]

/** Whether a repository-relative path belongs to a dependency or generated tree. */
function isTranslationSourceExcluded(file: string): boolean {
  const segments = file.split('/')
  return segments.some(segment => NON_SOURCE_DIRECTORIES.has(segment)
      || segment.startsWith('.doc-typecheck-')
    || segment.startsWith('.node-next-types-'))
    || file.startsWith('apps/web/dist/')
    || file.startsWith('python/sdk-runtime/src/deepseek_harness_runtime/runtime/dsh-jsonrpc-agent-')
    || file.startsWith('python/sdk-runtime/src/deepseek_harness_runtime/runtime/node/')
}

/** Whether one discovered Markdown or sidecar path belongs to the bilingual source corpus. */
export function isTranslationScopeFile(file: string): boolean {
  return !file.startsWith('.agents/notes/archived/')
    && !isTranslationSourceExcluded(file) && (README_ARTIFACT.test(file)
    || ROOT_CONTRIBUTING_ARTIFACT.test(file)
    || file.startsWith('.agents/notes/')
    || file.startsWith('docs/')
    || file.startsWith('python/'))
}

/** Read the manifest exclusion list or fail before enforcement starts. */
function excludedField(record: Record<string, unknown>): string[] {
  const value = record.excluded
  if (!Array.isArray(value)) {
    throw new Error('translation-pairing.manifest.json: excluded must be an array of strings')
  }
  const entries: unknown[] = value
  if (!entries.every((entry): entry is string => typeof entry === 'string')) {
    throw new Error('translation-pairing.manifest.json: excluded must be an array of strings')
  }
  return entries
}

/** Parse and validate the checked-in bilingual manifest. */
export function parseTranslationPairingManifest(content: string): TranslationPairingManifest {
  const value: unknown = JSON.parse(content)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('translation-pairing.manifest.json: expected an object')
  }
  const record = value as Record<string, unknown>
  const unsupported = Object.keys(record).filter(field => field !== 'excluded')
  if (unsupported.length > 0) {
    throw new Error(`translation-pairing.manifest.json: unsupported field(s): ${unsupported.join(', ')}; every in-scope document is required`)
  }
  return { excluded: excludedField(record) }
}

/**
 * Normalize one CLI pair argument to its English anchor path: any of the
 * pair's three files (`foo.md`, `foo.zh.md`, `foo.i18n.yaml`) or the bare
 * `foo` stem names the same pair, and platform separators are accepted.
 *
 * @param argument - Repo-relative path as passed on a command line.
 * @returns The pair's `foo.md` anchor path with `/` separators.
 */
export function pairAnchorOfArgument(argument: string): string {
  const normalized = argument.split('\\').join('/').replace(/^\.\//, '')
  if (normalized.endsWith('.zh.md')) return `${normalized.slice(0, -'.zh.md'.length)}.md`
  if (normalized.endsWith('.i18n.yaml')) return `${normalized.slice(0, -'.i18n.yaml'.length)}.md`
  if (normalized.endsWith('.md')) return normalized
  return `${normalized}.md`
}

/** A parsed `verify-translation-pairing` invocation. */
export interface TranslationPairingCliRequest {
  /** Content plane read by the check. Writes and corpus checks use the working tree. */
  input: 'worktree' | 'index'
  mode: 'check' | 'list' | 'write'
  /** `corpus` runs discovery over the whole tree; `pairs` touches only the named anchors. */
  scope: 'corpus' | 'pairs'
  /** English anchor paths, empty for corpus scope. */
  anchors: string[]
}

/**
 * Parse and validate `verify-translation-pairing` CLI arguments.
 *
 * Check accepts optional pair paths; `--write` requires either pair paths or
 * `--all` so a bulk re-record is always an explicit choice — a bare
 * `--write` would silently bless every drifted pair in the tree, including
 * ones the caller never confirmed. `--list` is corpus-only.
 *
 * @param argv - Arguments after the script name.
 * @returns The validated request.
 * @throws Error when flags or their combination are invalid.
 */
export function parseTranslationPairingCliArgs(argv: string[]): TranslationPairingCliRequest {
  const flags = argv.filter(argument => argument.startsWith('--'))
  const anchors = [...new Set(argv.filter(argument => !argument.startsWith('--')).map(pairAnchorOfArgument))].sort()
  const unknown = flags.filter(flag => !['--list', '--write', '--all', '--cached'].includes(flag))
  if (unknown.length > 0) throw new Error(`unknown flag(s): ${unknown.join(', ')}`)
  const listMode = flags.includes('--list')
  const writeMode = flags.includes('--write')
  const allMode = flags.includes('--all')
  const cachedMode = flags.includes('--cached')
  if (listMode && (writeMode || allMode || cachedMode || anchors.length > 0)) {
    throw new Error('--list reports the whole corpus and takes no other flags or paths')
  }
  if (allMode && !writeMode) throw new Error('--all only applies to --write')
  if (cachedMode && writeMode) throw new Error('--cached is a read-only index check and cannot be combined with --write')
  if (cachedMode && anchors.length === 0) throw new Error('--cached requires the staged pair paths to check')
  if (writeMode) {
    if (anchors.length > 0 && allMode) throw new Error('--write takes either pair paths or --all, not both')
    if (anchors.length === 0 && !allMode) {
      throw new Error('--write requires the pair(s) you confirmed (any file of a pair), or --all to re-record every complete pair; recording pairs you did not review blesses unconfirmed content')
    }
    return { input: 'worktree', mode: 'write', scope: allMode ? 'corpus' : 'pairs', anchors }
  }
  if (listMode) return { input: 'worktree', mode: 'list', scope: 'corpus', anchors: [] }
  return {
    input: cachedMode ? 'index' : 'worktree',
    mode: 'check',
    scope: anchors.length > 0 ? 'pairs' : 'corpus',
    anchors,
  }
}

/** The structural signature compared between the two sides of a pair. */
export interface TranslationStructureSignature {
  /** Heading depths in document order (h2 -> 2). */
  headings: number[]
  /** Fenced code blocks verbatim: info string plus content, in order. */
  code: string[]
  /** Row and column count of each table, in order. */
  tables: string[]
  /** Kind, ordered-list start, and direct item count of each list, in order. */
  lists: string[]
  /** Every link target in order; the language switcher is excluded. */
  links: string[]
}

/** Parse Markdown with the same GFM extensions used by the pairing gate. */
export function parseTranslationMarkdown(content: string): Nodes {
  return fromMarkdown(content, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
}

const PUBLIC_REPOSITORY_BLOB_ROOT = 'https://github.com/deepseek-ai/deepseek-harness/blob/master/'

/** Return the accepted relative and public-repository links to one counterpart. */
export function languageSwitcherTargets(counterpart: string): string[] {
  return [basename(counterpart), `${PUBLIC_REPOSITORY_BLOB_ROOT}${counterpart}`]
}

/** Whether the tree contains a link to any accepted target. */
export function linksTo(tree: Nodes, targets: string | readonly string[]): boolean {
  const accepted = new Set(typeof targets === 'string' ? [targets] : targets)
  let found = false
  const visit = (node: Nodes): void => {
    if (node.type === 'link' && accepted.has(node.url)) found = true
    if ('children' in node) for (const child of node.children) visit(child)
  }
  visit(tree)
  return found
}

/** Generated English sources cannot carry a switcher without making their generator stale. */
export function requiresSourceLanguageSwitcher(source: string): boolean {
  return ![
    'docs/agent-lifecycle.md',
    'docs/capability-seams.md',
    'docs/config-catalog.md',
    'docs/cordis-api/context.md',
    'docs/cordis-api/events.md',
    'docs/cordis-api/fiber.md',
    // Excluded from pairing, but kept here for generated-category completeness and direct spec coverage.
    'docs/cordis-api/inherited.md',
    'docs/cordis-api/registry.md',
    'docs/cordis-api/service.md',
    'docs/event-producer-consumer.md',
    'docs/graph-atlas.md',
    'docs/module-graph.md',
    'docs/persistence-catalog.md',
    'docs/tool-catalog.md',
    'docs/tool-execution-pipeline.md',
  ].includes(source)
}

/** Collect the ordered structural signature, skipping accepted switcher targets. */
export function translationStructureSignature(
  tree: Nodes,
  switcherTargets: string | readonly string[],
): TranslationStructureSignature {
  const acceptedSwitchers = new Set(
    typeof switcherTargets === 'string' ? [switcherTargets] : switcherTargets,
  )
  const sig: TranslationStructureSignature = { headings: [], code: [], tables: [], lists: [], links: [] }
  const visit = (node: Nodes): void => {
    switch (node.type) {
      case 'heading':
        sig.headings.push(node.depth)
        break
      case 'code':
        sig.code.push(`\`\`\`${node.lang ?? ''}${node.meta ? ` ${node.meta}` : ''}\n${node.value}`)
        break
      case 'table':
        sig.tables.push(`${node.children.length}x${node.children[0]?.children.length ?? 0}`)
        break
      case 'list':
        sig.lists.push(node.ordered
          ? `ordered:start=${node.start ?? 1}:items=${node.children.length}`
          : `bullet:items=${node.children.length}`)
        break
      case 'link':
        if (!acceptedSwitchers.has(node.url)) sig.links.push(node.url)
        break
      default:
        // Every other node kind is prose or a container, not part of the signature.
        break
    }
    if ('children' in node) for (const child of node.children) visit(child)
  }
  visit(tree)
  return sig
}

/** Render a signature element for an error message, truncated for readability. */
function show(value: string | number | undefined): string {
  if (value === undefined) return 'nothing'
  const text = JSON.stringify(value)
  return text.length > 72 ? `${text.slice(0, 72)}…` : text
}

/** Return the first divergence for each structural field; empty means equal. */
export function translationStructureDiff(
  source: TranslationStructureSignature,
  zh: TranslationStructureSignature,
): string[] {
  const out: string[] = []
  const fields: [string, (string | number)[], (string | number)[]][] = [
    ['heading (depth)', source.headings, zh.headings],
    ['code block', source.code, zh.code],
    ['table (row x column count)', source.tables, zh.tables],
    ['list (kind, start, item count)', source.lists, zh.lists],
    ['link target', source.links, zh.links],
  ]
  for (const [field, sourceValues, zhValues] of fields) {
    const length = Math.max(sourceValues.length, zhValues.length)
    for (let index = 0; index < length; index++) {
      if (sourceValues[index] !== zhValues[index]) {
        out.push(`${field} #${index + 1} diverges between the pair: ${show(sourceValues[index])} vs ${show(zhValues[index])}`)
        break
      }
    }
  }
  return out
}
