/**
 * Verify that pnpm-lock.yaml resolves every vendored package name to its
 * workspace `link:` — never a registry copy. `linkWorkspacePackages: true`
 * (pnpm-workspace.yaml) makes matching upstream semver ranges resolve to the
 * pinned vendored sources; a registry copy of the same name coexisting with
 * the vendored one silently forks the framework layer (vendor/README.md).
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import * as yaml from 'js-yaml'

const root = resolve(import.meta.dirname, '..')

async function vendoredNames(): Promise<Set<string>> {
  const names = new Set<string>()
  for (const entry of await readdir(join(root, 'vendor'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    let manifest: { name?: string }
    try {
      manifest = JSON.parse(await readFile(join(root, 'vendor', entry.name, 'package.json'), 'utf8')) as { name?: string }
    } catch {
      continue // not a package directory (e.g. vendor/README.md siblings)
    }
    if (manifest.name !== undefined) names.add(manifest.name)
  }
  return names
}

interface Lockfile {
  importers?: Record<string, Record<string, unknown>>
  packages?: Record<string, unknown>
  snapshots?: Record<string, unknown>
}

const names = await vendoredNames()
if (names.size === 0) throw new Error('verify-vendored-links: no vendored package manifests found under vendor/')
const lockfile = yaml.load(await readFile(join(root, 'pnpm-lock.yaml'), 'utf8')) as Lockfile

const violations: string[] = []

// Importer resolutions: every dependency entry naming a vendored package must
// resolve to a link:, or the build silently uses a registry copy.
for (const [importer, sections] of Object.entries(lockfile.importers ?? {})) {
  for (const [section, dependencies] of Object.entries(sections)) {
    if (typeof dependencies !== 'object' || dependencies === null) continue
    for (const [dependency, entry] of Object.entries(dependencies as Record<string, { version?: string }>)) {
      if (!names.has(dependency)) continue
      const version = entry.version ?? ''
      if (!version.startsWith('link:')) {
        violations.push(`${importer} ${section}.${dependency} resolves to ${JSON.stringify(version)} (expected link:)`)
      }
    }
  }
}

// Package/snapshot keys: a registry copy materializes as a `<name>@<version>`
// key; vendored names must never appear there at all.
for (const section of ['packages', 'snapshots'] as const) {
  for (const key of Object.keys(lockfile[section] ?? {})) {
    const atIndex = key.lastIndexOf('@')
    if (atIndex <= 0) continue
    const packageName = key.slice(0, atIndex)
    if (names.has(packageName)) violations.push(`${section} entry ${key} is a registry copy of a vendored package`)
  }
}

if (violations.length > 0) {
  console.error(`verify-vendored-links: ${String(violations.length)} lockfile resolution(s) bypass the vendored workspaces:`)
  for (const violation of violations) console.error(`  - ${violation}`)
  process.exit(1)
}
console.log(`verify-vendored-links: all ${String(names.size)} vendored package names resolve to workspace links.`)
