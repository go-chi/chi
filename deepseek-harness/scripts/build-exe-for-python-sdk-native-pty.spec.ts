import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveLinuxNodePtyAddon } from './build-exe-for-python-sdk-native-pty.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('resolveLinuxNodePtyAddon', () => {
  it('prefers the manylinux build produced by the release workflow', () => {
    const root = temporaryPackage()
    const built = createAddon(root, 'build', 'Release', 'pty.node')
    createAddon(root, 'prebuilds', 'linux-x64', 'pty.node')

    expect(resolveLinuxNodePtyAddon(root, 'x64')).toBe(built)
  })

  it('uses the target prebuild after an ordinary beta install', () => {
    const root = temporaryPackage()
    const prebuilt = createAddon(root, 'prebuilds', 'linux-arm64', 'pty.node')

    expect(resolveLinuxNodePtyAddon(root, 'arm64')).toBe(prebuilt)
  })

  it('reports both expected locations when no addon is installed', () => {
    const root = temporaryPackage()

    expect(() => resolveLinuxNodePtyAddon(root, 'x64')).toThrow(
      `node-pty addon is absent from both ${join(root, 'build', 'Release', 'pty.node')} and ${join(root, 'prebuilds', 'linux-x64', 'pty.node')}`,
    )
  })
})

function temporaryPackage(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-node-pty-addon-'))
  roots.push(root)
  return root
}

function createAddon(root: string, ...segments: string[]): string {
  const path = join(root, ...segments)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, '')
  return path
}
