/** Git-blob operations owned by the bilingual pairing workflow. */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const SNAPSHOT_REF_PREFIX = 'refs/dsh/translation-pairing/snapshots'

/** Maximum buffered stdout or stderr for repository-owned Git subprocesses. */
export const GIT_COMMAND_MAX_BUFFER = 1 << 26

/** Full SHA-1 Git blob hash (the 40-hex format used by pairing records). */
export function gitBlobHash(content: Buffer): string {
  const hash = createHash('sha1')
  hash.update(`blob ${content.byteLength}\0`)
  hash.update(content)
  return hash.digest('hex')
}

/**
 * Run one Git subprocess and return its exact stdout bytes.
 *
 * @param root - Repository root used as Git's working directory.
 * @param args - Arguments following the `git` executable.
 * @param operation - Human-readable operation for failure diagnostics.
 * @param input - Optional stdin bytes.
 * @returns Exact stdout bytes.
 * @throws Error when Git cannot start or exits unsuccessfully.
 */
export function runGit(root: string, args: string[], operation: string, input?: Buffer): Buffer {
  const result = spawnSync('git', ['-C', root, ...args], {
    input,
    maxBuffer: GIT_COMMAND_MAX_BUFFER,
  })
  if (result.error) {
    throw new Error(`${operation} failed: ${result.error.message}`, { cause: result.error })
  }
  if (result.status !== 0) {
    throw new Error(`${operation} failed with status ${String(result.status)}: ${result.stderr.toString('utf8').trim()}`)
  }
  return result.stdout
}

/** One regular stage-zero Git index entry and its exact blob bytes. */
export interface GitIndexBlob {
  /** Object ID recorded in the index. */
  objectId: string
  /** Blob bytes stored under that object ID. */
  content: Buffer
}

/**
 * Read one path from the Git index without consulting working-tree bytes.
 *
 * @param root - Repository root.
 * @param path - Repository-relative path.
 * @returns The stage-zero blob, or `undefined` when the path is absent.
 * @throws Error when the path is unmerged or its index entries are not a valid merge state.
 */
export function readGitIndexBlob(root: string, path: string): GitIndexBlob | undefined {
  const output = runGit(
    root,
    ['ls-files', '--stage', '-z', '--', path],
    `git ls-files --stage for ${path}`,
  ).toString('utf8')
  const entries = output.split('\0').filter(Boolean)
  if (entries.length === 0) return undefined
  if (entries.length !== 1) throw new Error(`${path} does not have exactly one resolved index entry`)
  const match = /^(?:\d+) ([0-9a-f]+) 0\t[\s\S]+$/.exec(entries[0] ?? '')
  if (!match?.[1]) throw new Error(`${path} remains unmerged or has an invalid index entry`)
  return {
    objectId: match[1],
    content: runGit(root, ['cat-file', 'blob', match[1]], `reading staged ${path}`),
  }
}

/**
 * Persist exact working-tree bytes so a pairing record can later recover them
 * with `git cat-file`, even when they have never appeared in the index or a
 * commit. The returned object ID is checked against the pairing format's own
 * content hash before the caller writes a sidecar.
 */
export function storeGitBlob(root: string, content: Buffer): string {
  const expected = gitBlobHash(content)
  const stored = runGit(root, ['hash-object', '-w', '--stdin'], 'git hash-object -w --stdin', content)
    .toString('utf8')
    .trim()
  if (stored !== expected) {
    throw new Error(`git hash-object -w --stdin returned unexpected object ID ${JSON.stringify(stored)}; expected ${expected}`)
  }
  runGit(
    root,
    ['update-ref', `${SNAPSHOT_REF_PREFIX}/${stored}`, stored],
    'git update-ref for translation snapshot',
  )
  return stored
}
