/** Fail-closed composition of bilingual pairing records during Git merges. */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  GIT_COMMAND_MAX_BUFFER,
  gitBlobHash,
  readGitIndexBlob,
  runGit,
  storeGitBlob,
} from './translation-pairing-git.ts'
import {
  isTranslationScopeFile,
  languageSwitcherTargets,
  linksTo,
  parseTranslationMarkdown,
  requiresSourceLanguageSwitcher,
  translationStructureDiff,
  translationStructureSignature,
} from './translation-pairing.ts'
import {
  parseTranslationPairingRecord,
  renderTranslationPairingRecord,
  translationPairPathsFromMeta,
  type TranslationPairPaths,
  type TranslationPairingRecord,
} from './translation-pairing-record.ts'

const UNMERGED_ENTRY = /^(\d+) ([0-9a-f]+) ([123])\t([\s\S]+)$/

/** A mechanically composed record and the exact merged owner contents it names. */
export interface TranslationPairingMergeResult extends TranslationPairingRecord {
  /** Canonical generated sidecar text. */
  record: string
  /** Clean three-way merge of the English owner. */
  sourceContent: Buffer
  /** Clean three-way merge of the Simplified Chinese owner. */
  zhContent: Buffer
}

interface UnmergedStages {
  ancestor?: string
  current?: string
  other?: string
}

function readGitBlob(root: string, objectId: string, owner: string): Buffer {
  const content = runGit(root, ['cat-file', 'blob', objectId], `reading ${owner} blob ${objectId}`)
  if (gitBlobHash(content) !== objectId) {
    throw new Error(`${owner} record names ${objectId}, which is not its SHA-1 git blob hash`)
  }
  return content
}

function readMergeDefault(root: string): string | undefined {
  const result = spawnSync('git', ['-C', root, 'config', '--get', 'merge.default'], {
    maxBuffer: GIT_COMMAND_MAX_BUFFER,
  })
  if (result.error) {
    throw new Error(`reading merge.default failed: ${result.error.message}`, { cause: result.error })
  }
  if (result.status === 1) return undefined
  if (result.status !== 0) {
    throw new Error(
      `reading merge.default failed with status ${String(result.status)}: ${result.stderr.toString('utf8').trim()}`,
    )
  }
  return result.stdout.toString('utf8').trim()
}

function assertDefaultTextMerge(root: string, paths: TranslationPairPaths): void {
  const output = runGit(
    root,
    ['check-attr', '-z', 'merge', '--', paths.source, paths.zh],
    'checking bilingual owner merge attributes',
  ).toString('utf8')
  const fields = output.split('\0')
  fields.pop()
  let mergeDefault: string | undefined
  for (let index = 0; index < fields.length; index += 3) {
    const path = fields[index]
    const value = fields[index + 2]
    if (path === undefined || value === undefined) {
      throw new Error('git check-attr returned a malformed result')
    }
    if (!['unspecified', 'set', 'text'].includes(value)) {
      throw new Error(`${path} uses merge=${value}; the pairing driver only composes Git's default text merge`)
    }
    if (value === 'unspecified') {
      mergeDefault ??= readMergeDefault(root)
      if (mergeDefault !== undefined && mergeDefault !== 'text') {
        throw new Error(
          `${path} inherits merge.default=${mergeDefault}; the pairing driver only composes Git's default text merge`,
        )
      }
    }
  }
}

function runTextMerge(
  root: string,
  label: string,
  ancestor: Buffer | string,
  current: Buffer | string,
  other: Buffer | string,
): { output: Buffer; status: number | null } {
  const temporary = mkdtempSync(join(tmpdir(), 'dsh-translation-pairing-merge-'))
  try {
    const ancestorPath = join(temporary, 'ancestor')
    const currentPath = join(temporary, 'current')
    const otherPath = join(temporary, 'other')
    writeFileSync(ancestorPath, ancestor)
    writeFileSync(currentPath, current)
    writeFileSync(otherPath, other)
    const result = spawnSync('git', [
      '-C', root,
      'merge-file', '-p',
      '-L', `${label}:current`,
      '-L', `${label}:ancestor`,
      '-L', `${label}:other`,
      currentPath, ancestorPath, otherPath,
    ], { maxBuffer: GIT_COMMAND_MAX_BUFFER })
    if (result.error) {
      throw new Error(`merging ${label} failed: ${result.error.message}`, { cause: result.error })
    }
    return { output: result.stdout, status: result.status }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

function mergeBlobTriplet(
  root: string,
  owner: string,
  ancestor: Buffer,
  current: Buffer,
  other: Buffer,
): Buffer {
  const result = runTextMerge(root, owner, ancestor, current, other)
  if (result.status !== 0) {
    const kind = result.status !== null && result.status > 0 && result.status <= 127
      ? 'has content conflicts'
      : `failed with status ${String(result.status)}`
    throw new Error(`${owner} ${kind}`)
  }
  return result.output
}

function loadRecordOwners(
  root: string,
  label: string,
  content: string,
  paths: TranslationPairPaths,
): { source: Buffer; zh: Buffer } {
  const record = parseTranslationPairingRecord(content, paths)
  if (record === undefined) throw new Error(`${label} ${paths.meta} is not a valid two-hash pairing record`)
  return {
    source: readGitBlob(root, record.sourceHash, `${label} ${paths.source}`),
    zh: readGitBlob(root, record.zhHash, `${label} ${paths.zh}`),
  }
}

function assertMergedPairStructure(paths: TranslationPairPaths, source: Buffer, zh: Buffer): void {
  const sourceTree = parseTranslationMarkdown(source.toString('utf8'))
  const zhTree = parseTranslationMarkdown(zh.toString('utf8'))
  const sourceSwitcherTargets = languageSwitcherTargets(paths.source)
  const zhSwitcherTargets = languageSwitcherTargets(paths.zh)
  if (requiresSourceLanguageSwitcher(paths.source) && !linksTo(sourceTree, zhSwitcherTargets)) {
    throw new Error(`${paths.source} clean merge lost its language-switcher link to ${basename(paths.zh)}`)
  }
  if (!linksTo(zhTree, sourceSwitcherTargets)) {
    throw new Error(`${paths.zh} clean merge lost its language-switcher link to ${basename(paths.source)}`)
  }
  const divergences = translationStructureDiff(
    translationStructureSignature(sourceTree, zhSwitcherTargets),
    translationStructureSignature(zhTree, sourceSwitcherTargets),
  )
  if (divergences.length > 0) {
    throw new Error(`${paths.source} and ${paths.zh} clean merges diverge structurally: ${divergences.join('; ')}`)
  }
}

function normalizeMetaPath(root: string, meta: string): string {
  if (isAbsolute(meta)) throw new Error(`pairing record must be repository-relative: ${JSON.stringify(meta)}`)
  const repositoryRelative = relative(resolve(root), resolve(root, meta))
  if (repositoryRelative === '' || repositoryRelative === '..' || repositoryRelative.startsWith(`..${sep}`)) {
    throw new Error(`pairing record escapes the repository: ${JSON.stringify(meta)}`)
  }
  return repositoryRelative.split(sep).join('/')
}

/**
 * Compose one generated sidecar from the ancestor, current, and other records.
 *
 * Each input record is already a confirmation of its two owner blobs. The
 * result exists only when Git's default text merge succeeds independently for
 * both languages and the composed documents retain the pairing structure.
 *
 * @param root - Repository root containing the referenced Git objects.
 * @param metaPath - Repository-relative sidecar path.
 * @param ancestorRecord - Common-ancestor sidecar text.
 * @param currentRecord - Current-side sidecar text.
 * @param otherRecord - Other-side sidecar text.
 * @returns The canonical record and exact merged owner contents.
 * @throws Error when the input is not mechanically composable.
 */
export function mergeTranslationPairingRecords(
  root: string,
  metaPath: string,
  ancestorRecord: string,
  currentRecord: string,
  otherRecord: string,
): TranslationPairingMergeResult {
  const normalizedMeta = normalizeMetaPath(root, metaPath)
  if (!isTranslationScopeFile(normalizedMeta)) {
    throw new Error(`${normalizedMeta} is outside the active bilingual documentation corpus`)
  }
  const paths = translationPairPathsFromMeta(normalizedMeta)
  assertDefaultTextMerge(root, paths)
  const ancestor = loadRecordOwners(root, 'ancestor', ancestorRecord, paths)
  const current = loadRecordOwners(root, 'current', currentRecord, paths)
  const other = loadRecordOwners(root, 'other', otherRecord, paths)
  const sourceContent = mergeBlobTriplet(root, paths.source, ancestor.source, current.source, other.source)
  const zhContent = mergeBlobTriplet(root, paths.zh, ancestor.zh, current.zh, other.zh)
  assertMergedPairStructure(paths, sourceContent, zhContent)
  const sourceHash = storeGitBlob(root, sourceContent)
  const zhHash = storeGitBlob(root, zhContent)
  return {
    record: renderTranslationPairingRecord(paths, { sourceHash, zhHash }),
    sourceContent,
    sourceHash,
    zhContent,
    zhHash,
  }
}

function unmergedSidecars(root: string): Map<string, UnmergedStages> {
  const output = runGit(root, ['ls-files', '--unmerged', '-z'], 'listing unresolved merge entries').toString('utf8')
  const records = new Map<string, UnmergedStages>()
  for (const entry of output.split('\0')) {
    if (entry === '') continue
    const match = UNMERGED_ENTRY.exec(entry)
    if (!match?.[2] || !match[3] || match[4] === undefined) {
      throw new Error(`git ls-files returned a malformed unmerged entry: ${JSON.stringify(entry)}`)
    }
    const path = match[4]
    if (!path.endsWith('.i18n.yaml')) continue
    const stages = records.get(path) ?? {}
    const field = match[3] === '1' ? 'ancestor' : match[3] === '2' ? 'current' : 'other'
    stages[field] = match[2]
    records.set(path, stages)
  }
  return records
}

function assertUneditedSidecar(
  root: string,
  metaPath: string,
  ancestorRecord: string,
  currentRecord: string,
  otherRecord: string,
): void {
  const worktreeRecord = readFileSync(join(root, metaPath), 'utf8')
  if (worktreeRecord === currentRecord || worktreeRecord === otherRecord) return
  const textMerge = runTextMerge(root, metaPath, ancestorRecord, currentRecord, otherRecord)
  if (textMerge.status === 0 && textMerge.output.toString('utf8') === worktreeRecord) return
  const stageDataLines = [currentRecord, otherRecord]
    .flatMap(record => record.split(/\r?\n/))
    .filter(line => line !== '' && !line.startsWith('#'))
  const hasUneditedConflict = worktreeRecord.includes('<<<<<<<')
    && worktreeRecord.includes('=======')
    && worktreeRecord.includes('>>>>>>>')
    && stageDataLines.every(line => worktreeRecord.includes(line))
  if (!hasUneditedConflict) {
    throw new Error(`${metaPath} has edited conflict content; refusing to overwrite manual work`)
  }
}

/**
 * Resolve every mechanically composable `.i18n.yaml` conflict in the index.
 *
 * The command first proves that Git's already-staged owner merges match the
 * independently composed contents, then writes and stages all sidecars as one
 * batch. Other conflicts remain untouched; after staging the safe records, an
 * aggregate error reports any pairing conflicts that still need manual work.
 *
 * @param root - Repository root with an in-progress merge-like operation.
 * @returns Repository-relative sidecar paths resolved and staged.
 */
export function resolveTranslationPairingConflicts(root: string): string[] {
  const resolutions: { path: string; record: string }[] = []
  const failures: { path: string; reason: string }[] = []
  for (const [metaPath, stages] of [...unmergedSidecars(root)].sort(([left], [right]) => left.localeCompare(right))) {
    try {
      if (stages.ancestor === undefined || stages.current === undefined || stages.other === undefined) {
        throw new Error('is an add/delete or incomplete-stage conflict and requires manual resolution')
      }
      const ancestorRecord = readGitBlob(root, stages.ancestor, `ancestor ${metaPath}`).toString('utf8')
      const currentRecord = readGitBlob(root, stages.current, `current ${metaPath}`).toString('utf8')
      const otherRecord = readGitBlob(root, stages.other, `other ${metaPath}`).toString('utf8')
      assertUneditedSidecar(root, metaPath, ancestorRecord, currentRecord, otherRecord)
      const result = mergeTranslationPairingRecords(
        root,
        metaPath,
        ancestorRecord,
        currentRecord,
        otherRecord,
      )
      const paths = translationPairPathsFromMeta(metaPath)
      if (readGitIndexBlob(root, paths.source)?.objectId !== result.sourceHash) {
        throw new Error(`${paths.source} staged merge does not match the pairing driver's clean merge`)
      }
      if (readGitIndexBlob(root, paths.zh)?.objectId !== result.zhHash) {
        throw new Error(`${paths.zh} staged merge does not match the pairing driver's clean merge`)
      }
      for (const [path, expected] of [[paths.source, result.sourceHash], [paths.zh, result.zhHash]] as const) {
        if (gitBlobHash(readFileSync(join(root, path))) !== expected) {
          throw new Error(`${path} has unstaged content; refusing to confirm bytes outside the merge result`)
        }
      }
      resolutions.push({ path: metaPath, record: result.record })
    } catch (error) {
      failures.push({ path: metaPath, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  for (const resolution of resolutions) writeFileSync(join(root, resolution.path), resolution.record)
  if (resolutions.length > 0) {
    runGit(root, ['add', '--', ...resolutions.map(resolution => resolution.path)], 'staging resolved pairing records')
  }
  if (failures.length > 0) {
    const resolved = resolutions.length === 0
      ? ''
      : `resolved and staged ${resolutions.map(resolution => resolution.path).join(', ')}; `
    throw new Error(
      `${resolved}left ${String(failures.length)} pairing conflict(s) unresolved:\n`
      + failures.map(failure => `- ${failure.path}: ${failure.reason}`).join('\n'),
    )
  }
  return resolutions.map(resolution => resolution.path)
}
