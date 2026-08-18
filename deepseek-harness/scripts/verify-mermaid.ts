/**
 * Parse every repo-authored Mermaid fence with Mermaid itself, catching syntax that link and fence
 * checks cannot. Scope intentionally matches the Markdown link gate, including standing docs,
 * package/example docs, and agent skills. Run with `tsx scripts/verify-mermaid.ts`.
 */

import { globSync, readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import { JSDOM } from 'jsdom'
import type { Nodes } from 'mdast'
import { isArchivedAgentNotePath } from './repo-files.ts'

const root = resolve(import.meta.dirname, '..')

const PATTERNS = [
  'README.md',
  'README.zh.md',
  '.agents/notes/**/*.md',
  'docs/**/*.md',
  'packages/*/*.md',
  'packages/*/*/*.md',
  'examples/**/*.md',
  'AGENTS.md',
  'packages/AGENTS.md',
  '.agents/skills/**/*.md',
]

interface Block {
  file: string
  line: number
  source: string
}

interface Violation {
  file: string
  line: number
  message: string
}

function extractMermaidBlocks(file: string): Block[] {
  const source = readFileSync(resolve(root, file), 'utf8')
  const tree = fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
  const out: Block[] = []
  const visit = (node: Nodes): void => {
    if (node.type === 'code' && node.lang === 'mermaid') {
      out.push({ file, line: node.position?.start.line ?? 0, source: node.value })
    }
    if ('children' in node) {
      for (const child of node.children) visit(child)
    }
  }
  visit(tree)
  return out
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message.replace(/\s+/g, ' ').trim()
  return String(error).replace(/\s+/g, ' ').trim()
}

const blocks: Block[] = []
const seen = new Set<string>()
let checkedFiles = 0
for (const pattern of PATTERNS) {
  for (const match of globSync(pattern, { cwd: root })) {
    if (isArchivedAgentNotePath(match)) continue
    const real = realpathSync(resolve(root, match))
    if (seen.has(real)) continue
    seen.add(real)
    checkedFiles++
    blocks.push(...extractMermaidBlocks(match))
  }
}

const violations: Violation[] = []
const { window } = new JSDOM('')
Object.defineProperty(globalThis, 'window', { value: window })
Object.defineProperty(globalThis, 'document', { value: window.document })
Object.defineProperty(globalThis, 'navigator', { value: window.navigator })
const mermaid = (await import('mermaid')).default
// maxEdges: mermaid's default 500-edge render guard; the module graph grows
// with every package edge and crossed it legitimately. Raise the guard here
// (a secure config settable only via initialize) rather than trimming edges.
// The graph passed 1000 the same way it passed 500, so the headroom doubles
// again rather than being set to whatever the current count happens to be.
mermaid.initialize({ startOnLoad: false, maxEdges: 2000 })
for (const block of blocks) {
  try {
    await mermaid.parse(block.source, { suppressErrors: false })
  } catch (error: unknown) {
    violations.push({ file: block.file, line: block.line, message: formatError(error) })
  }
}

if (violations.length === 0) {
  console.log(`verify-mermaid: ${blocks.length} mermaid block(s) parsed across ${checkedFiles} file(s).`)
  process.exit(0)
}

console.error('verify-mermaid: Mermaid syntax errors found:')
for (const violation of violations) {
  console.error(`  ${violation.file}:${violation.line}  ${violation.message}`)
}
process.exit(1)
