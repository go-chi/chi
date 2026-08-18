/**
 * Find stale root-relative `packages/...` references in repo-authored prose and
 * TypeScript. A missing path is reported only when it names a real package leaf
 * outside its own explaining group directory; globs, placeholders, hypothetical
 * packages, and unbuilt `lib/` output are outside the check.
 */

import { existsSync, globSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  findReferenceViolations,
  isArchivedAgentNotePath,
  uniqueRepoFiles,
  type ReferenceViolation as Violation,
} from './repo-files.ts'

const root = resolve(import.meta.dirname, '..')

/** Markdown + repo-authored TypeScript that may cite package paths. */
const PATTERNS = [
  'README.md',
  '.agents/notes/**/*.md',
  'docs/**/*.md',
  'packages/*/*.md',
  'packages/*/*/*.md',
  'AGENTS.md',
  'packages/AGENTS.md',
  'packages/**/*.ts',
  'examples/**/*.ts',
]

/** Paths excluded from the scan: built output and vendored upstream source. */
const isExcluded = (p: string): boolean =>
  isArchivedAgentNotePath(p) || p.includes('/lib/') || p.endsWith('.d.ts') || p.startsWith('vendor/')

/**
 * Directory names of every real package, `packages/<group>/<pkg>`. A broken
 * reference is only flagged when one of its segments is in this set — that is
 * what scopes the gate to DRIFT (a moved real package) rather than typos or
 * not-yet-existing packages named in a proposal.
 */
function realPackageNames(): Set<string> {
  const names = new Set<string>()
  for (const pkg of globSync('packages/*/*', { cwd: root, withFileTypes: true })) {
    if (pkg.isDirectory()) names.add(pkg.name)
  }
  return names
}

const packageNames = realPackageNames()

/**
 * Match a `packages/<path>` reference token. The character class is plain path
 * characters only, so a glob (`*`), placeholder (`<`, `>`), or brace expansion
 * (`{`, `}`, `,`) terminates the match before those chars and is never probed —
 * those are patterns, not real paths. A trailing `.`/`/` (e.g. a sentence-ending
 * period) is trimmed before the existence check.
 */
const PKG_REF = /\bpackages\/[A-Za-z0-9._/-]+/g

function isDriftedPackageReference(ref: string): boolean {
  if (existsSync(resolve(root, ref))) return false
  // Ignore unbuilt `lib/` paths only under an existing depth-two package root:
  // CI runs this gate before build, while stale group-less paths must still fail.
  const parts = ref.split('/')
  const libAt = parts.indexOf('lib')
  if (libAt === 3 && existsSync(resolve(root, parts.slice(0, 3).join('/')))) return false
  // A missing reference is drift only when a path segment names a live package.
  // A leading segment that is itself an existing group directory is explained by
  // the group, not by a relocated leaf sharing its name (`client` is both the
  // client-modules group and the sdk leaf), so only later segments count.
  const segments = ref.split('/').slice(1)
  const [group] = segments
  const scanned = group !== undefined && segments.length > 1 && existsSync(resolve(root, 'packages', group))
    ? segments.slice(1)
    : segments
  return scanned.some(segment => packageNames.has(segment))
}

/** Find missing package references whose path names a live package; bare paths, typos, and illustrative skeletons do not count. */
function findViolations(absPath: string): Violation[] {
  return findReferenceViolations(
    root,
    absPath,
    PKG_REF,
    // Remove trailing separators or sentence punctuation matched greedily.
    ref => ref.replace(/[./]+$/, ''),
    isDriftedPackageReference,
  )
}

const files = uniqueRepoFiles(root, PATTERNS, isExcluded)
const all = files.flatMap(file => findViolations(file.real))
const checked = files.length

if (all.length === 0) {
  console.log(`verify-package-paths: ${checked} file(s) checked, all packages/* references resolve.`)
  process.exit(0)
}

console.error('verify-package-paths: broken packages/* references found (target does not exist):')
for (const v of all) {
  console.error(`  ${v.file}:${v.line}  ${v.ref}`)
}
process.exit(1)
