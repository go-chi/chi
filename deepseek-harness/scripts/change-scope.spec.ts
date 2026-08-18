import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { renderChangeScope } from './change-scope.ts'

interface Report {
  formatVersion: number
  repositoryRoot: string
  input: { base: string; head: string }
  resolved: { baseSha: string; headSha: string; mergeBaseSha: string }
  paths: { committed: string[]; staged: string[]; unstaged: string[]; untracked: string[] }
}

interface Fixture {
  container: string
  root: string
}

const fixtureRoots: string[] = []

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function git(cwd: string, args: string[], input?: string | Buffer): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C' },
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
}

function gitBytes(cwd: string, args: string[], input?: Buffer): Buffer {
  return execFileSync('git', ['-C', cwd, ...args], {
    env: { ...process.env, LANG: 'C', LC_ALL: 'C' },
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

function write(path: string, content: string, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, mode === undefined ? undefined : { mode })
}

function fixture(worktreeName = 'worktree'): Fixture {
  const container = mkdtempSync(join(tmpdir(), 'dsh-change-scope-'))
  fixtureRoots.push(container)
  const origin = join(container, 'origin.git')
  const root = join(container, worktreeName)
  const hooks = join(container, 'hooks')
  mkdirSync(hooks)
  git(container, ['init', '--bare', '--initial-branch=master', origin])
  git(container, ['init', '--initial-branch=master', root])
  git(root, ['config', 'user.email', 'change-scope@example.com'])
  git(root, ['config', 'user.name', 'Change Scope Tests'])
  git(root, ['config', 'commit.gpgsign', 'false'])
  git(root, ['config', 'core.hooksPath', hooks])
  write(join(root, 'README.md'), '# Fixture\n')
  git(root, ['add', 'README.md'])
  git(root, ['commit', '-m', 'initial'])
  git(root, ['remote', 'add', 'origin', origin])
  git(root, ['push', '--set-upstream', 'origin', 'master'])
  return { container, root }
}

function commit(root: string, path: string, content: string): string {
  write(join(root, path), content)
  git(root, ['add', '--', path])
  git(root, ['commit', '-m', `add ${path}`])
  return git(root, ['rev-parse', 'HEAD'])
}

function invoke(root: string, args: string[]): string {
  return renderChangeScope(args, root)
}

function jsonReport(root: string, base: string, head?: string): Report {
  const args = ['--base', base]
  if (head !== undefined) args.push('--head', head)
  return JSON.parse(invoke(root, args)) as Report
}

function repositoryState(root: string): Record<string, string> {
  const status = git(root, ['status', '--porcelain=v2', '--branch', '-z'])
  return {
    status,
    head: git(root, ['rev-parse', 'HEAD']),
    refs: git(root, ['for-each-ref', '--format=%(refname) %(objectname)']),
    index: readFileSync(join(root, '.git/index')).toString('base64'),
    config: readFileSync(join(root, '.git/config')).toString('base64'),
  }
}

describe('change-scope', () => {
  it('uses an explicit base on a fresh branch without a same-name remote and after its first push', { timeout: 20_000 }, () => {
    const { root } = fixture()
    git(root, ['switch', '-c', 'feature'])
    git(root, ['branch', '--set-upstream-to=origin/master'])
    const headSha = commit(root, 'feature.txt', 'feature\n')

    const fresh = jsonReport(root, 'origin/master')
    expect(realpathSync.native(fresh.repositoryRoot)).toBe(realpathSync.native(root))
    expect(fresh.resolved).toEqual({
      baseSha: git(root, ['rev-parse', 'origin/master']),
      headSha,
      mergeBaseSha: git(root, ['rev-parse', 'origin/master']),
    })
    expect(fresh.paths).toEqual({ committed: ['feature.txt'], staged: [], unstaged: [], untracked: [] })
    expect(git(root, ['for-each-ref', '--format=%(refname)', 'refs/remotes/origin/feature'])).toBe('')

    git(root, ['push', '--set-upstream', 'origin', 'feature'])
    const pushed = jsonReport(root, 'origin/master')
    expect(pushed.paths.committed).toEqual(['feature.txt'])
  })

  it.skipIf(process.platform === 'win32')('preserves trailing spaces in the worktree path', () => {
    const { root } = fixture('worktree ')
    const report = jsonReport(root, 'HEAD')

    expect(realpathSync.native(report.repositoryRoot)).toBe(realpathSync.native(root))
    expect(report.paths).toEqual({ committed: [], staged: [], unstaged: [], untracked: [] })
  })

  it('reports an exact head above a non-master stacked base while dirty paths remain worktree-local', () => {
    const { root } = fixture()
    git(root, ['switch', '-c', 'foundation'])
    const baseSha = commit(root, 'foundation.txt', 'foundation\n')
    git(root, ['switch', '-c', 'topic'])
    const headSha = commit(root, 'topic.txt', 'topic\n')
    commit(root, 'later.txt', 'later\n')
    write(join(root, 'current-worktree.txt'), 'current worktree\n')

    const report = jsonReport(root, 'foundation', headSha)
    expect(report.input).toEqual({ base: 'foundation', head: headSha })
    expect(report.resolved).toEqual({ baseSha, headSha, mergeBaseSha: baseSha })
    expect(report.paths.committed).toEqual(['topic.txt'])
    expect(report.paths.untracked).toEqual(['current-worktree.txt'])
  })

  it('keeps committed, staged, unstaged, and untracked paths independent and does not mutate state', () => {
    const { root } = fixture()
    commit(root, 'unstaged.txt', 'before\n')
    const baseSha = git(root, ['rev-parse', 'HEAD'])
    commit(root, 'committed.txt', 'committed\n')
    write(join(root, 'staged.txt'), 'staged\n')
    write(join(root, 'mixed.txt'), 'staged part\n')
    git(root, ['add', 'staged.txt', 'mixed.txt'])
    write(join(root, 'mixed.txt'), 'staged part\nunstaged part\n')
    write(join(root, 'unstaged.txt'), 'unstaged\n')
    write(join(root, 'untracked.txt'), 'untracked\n')
    const before = repositoryState(root)

    const report = jsonReport(root, baseSha)

    expect(report.paths).toEqual({
      committed: ['committed.txt'],
      staged: ['mixed.txt', 'staged.txt'],
      unstaged: ['mixed.txt', 'unstaged.txt'],
      untracked: ['untracked.txt'],
    })
    expect(repositoryState(root)).toEqual(before)
  })

  it.skipIf(process.platform === 'win32')('does not execute a configured filesystem monitor', () => {
    const { container, root } = fixture()
    const monitor = join(container, 'fsmonitor.sh')
    const sideEffect = `${monitor}.ran`
    write(monitor, '#!/bin/sh\ntouch "$0.ran"\n', 0o755)
    git(root, ['config', 'core.fsmonitor', monitor])

    const report = jsonReport(root, 'HEAD')

    expect(report.paths).toEqual({ committed: [], staged: [], unstaged: [], untracked: [] })
    expect(existsSync(sideEffect)).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('rejects distinct non-UTF-8 Git paths', () => {
    const { root } = fixture()
    const blobSha = git(root, ['hash-object', '-w', '--stdin'], 'content')
    const entry = Buffer.from(`100644 ${blobSha}\t`, 'ascii')
    const firstPath = Buffer.from([0x80])
    const secondPath = Buffer.from([0x81])
    gitBytes(root, ['update-index', '-z', '--index-info'], Buffer.concat([
      entry,
      firstPath,
      Buffer.from([0]),
      entry,
      secondPath,
      Buffer.from([0]),
    ]))
    expect(gitBytes(root, ['diff', '--cached', '--name-only', '-z', '--'])).toEqual(Buffer.concat([
      firstPath,
      Buffer.from([0]),
      secondPath,
      Buffer.from([0]),
    ]))
    expect(() => {
      renderChangeScope(['--base', 'HEAD'], root)
    }).toThrow('cannot inspect staged paths: Git path 1 is not valid UTF-8')
  })

  it('rejects missing, ambiguous, and non-commit refs', () => {
    const { root } = fixture()
    git(root, ['branch', 'collision'])
    git(root, ['tag', 'collision'])
    write(join(root, 'blob.txt'), 'blob\n')
    const blobSha = git(root, ['hash-object', '-w', 'blob.txt'])
    git(root, ['tag', 'blob-ref', blobSha])

    for (const { args, message } of [
      { args: ['--base', 'missing'], message: /base ref .* does not resolve to a commit/u },
      { args: ['--base', 'collision'], message: /base ref .* is ambiguous/u },
      { args: ['--base', 'blob-ref'], message: /base ref .* does not resolve to a commit/u },
      { args: ['--base', 'HEAD', '--head', 'missing'], message: /head ref .* does not resolve to a commit/u },
    ]) {
      expect(() => {
        renderChangeScope(args, root)
      }).toThrow(message)
    }
  })

  it('renders deterministic versioned JSON', () => {
    const { root } = fixture()
    git(root, ['switch', '-c', 'format'])
    commit(root, 'zeta.txt', 'zeta\n')
    commit(root, 'alpha.txt', 'alpha\n')

    const json = invoke(root, ['--base', 'origin/master'])
    const repeatedJson = invoke(root, ['--base', 'origin/master'])
    const report = JSON.parse(json) as Report

    expect(json).toBe(repeatedJson)
    expect(report.formatVersion).toBe(1)
    expect(report.paths.committed).toEqual(['alpha.txt', 'zeta.txt'])
  })
})
