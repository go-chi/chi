/** Canonical path-overlap checks that keep workspace and temp capabilities separate. */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { assertPrivateTempDisjoint, assertTempRootOutsideWorkspace } from '../src/path-boundary.ts'

describe('Windows ACL temp path boundary', () => {
  const scratchDirs: string[] = []

  afterEach(() => {
    for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function scratch(): string {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-acl-boundary-'))
    scratchDirs.push(dir)
    return dir
  }

  it('rejects a temp root equal to or below the workspace', () => {
    const workspace = scratch()
    const nested = join(workspace, 'temp')
    mkdirSync(nested)

    expect(() => {
      assertTempRootOutsideWorkspace(workspace, workspace)
    }).toThrow(/temp root must be outside the workspace/u)
    expect(() => {
      assertTempRootOutsideWorkspace(workspace, nested)
    }).toThrow(/temp root must be outside the workspace/u)
  })

  it('accepts a temp parent above the workspace because a fresh child is a sibling', () => {
    const tempRoot = scratch()
    const workspace = join(tempRoot, 'workspace')
    mkdirSync(workspace)

    expect(() => {
      assertTempRootOutsideWorkspace(workspace, tempRoot)
    }).not.toThrow()
  })

  it('requires an actual private temp directory to be disjoint in either direction', () => {
    const root = scratch()
    const workspace = join(root, 'workspace')
    const nestedTemp = join(workspace, 'temp')
    const siblingTemp = join(root, 'sibling-temp')
    mkdirSync(workspace)
    mkdirSync(nestedTemp)
    mkdirSync(siblingTemp)

    expect(() => {
      assertPrivateTempDisjoint([workspace], nestedTemp)
    }).toThrow(/must be disjoint/u)
    expect(() => {
      assertPrivateTempDisjoint([nestedTemp], workspace)
    }).toThrow(/must be disjoint/u)
    expect(() => {
      assertPrivateTempDisjoint([workspace], siblingTemp)
    }).not.toThrow()
  })
})
