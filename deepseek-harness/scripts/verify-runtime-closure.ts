/**
 * Verify that the executable deploy manifest supplies every required workspace
 * peer in its dependency graph. With auto peer installation disabled, a missing
 * root peer can otherwise fail only when Cordis loads the packaged plugin.
 */
import { globSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

interface PackageManifest {
  name?: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

interface WorkspacePackage {
  path: string
  manifest: PackageManifest
}

const root = resolve(import.meta.dirname, '..')
const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { manifest: { type: 'string' } },
})
const runtimeManifestPath = resolve(root, values.manifest ?? 'python/sdk-runtime/package.json')
const runtimeManifest = await loadManifest(runtimeManifestPath)
const runtimeName = runtimeManifest.name ?? 'python/sdk-runtime'
const workspace = await loadWorkspacePackages()
const runtimeDependencies = runtimeManifest.dependencies ?? {}
const parents = new Map<string, string | undefined>()
const queue: string[] = []

for (const dependency of Object.keys(runtimeDependencies).sort()) {
  if (!workspace.has(dependency)) continue
  parents.set(dependency, undefined)
  queue.push(dependency)
}

const failures: string[] = []
for (let index = 0; index < queue.length; index += 1) {
  const packageName = queue[index]
  if (packageName === undefined) continue
  const current = workspace.get(packageName)
  if (current === undefined) continue
  const peers = current.manifest.peerDependencies ?? {}
  const peerMeta = current.manifest.peerDependenciesMeta ?? {}
  for (const peer of Object.keys(peers).sort()) {
    if (!workspace.has(peer) || peerMeta[peer]?.optional === true) continue
    if (runtimeDependencies[peer]?.startsWith('workspace:') === true) continue
    failures.push(`${formatChain(runtimeName, packageName, parents)} -> ${peer}`)
  }
  const dependencies = {
    ...current.manifest.dependencies,
    ...current.manifest.optionalDependencies,
  }
  for (const dependency of Object.keys(dependencies).sort()) {
    if (!workspace.has(dependency) || parents.has(dependency)) continue
    parents.set(dependency, packageName)
    queue.push(dependency)
  }
}

if (failures.length > 0) {
  console.error('verify-runtime-closure: required workspace peers are missing from python/sdk-runtime dependencies:')
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}

console.log(`verify-runtime-closure: ${queue.length} workspace packages form a closed runtime dependency graph.`)

async function loadWorkspacePackages(): Promise<Map<string, WorkspacePackage>> {
  const paths = globSync(['packages/*/*/package.json', 'vendor/*/package.json'], { cwd: root })
    .sort()
    .map(relative => resolve(root, relative))
  const result = new Map<string, WorkspacePackage>()
  for (const path of paths) {
    const manifest = await loadManifest(path)
    if (manifest.name !== undefined) result.set(manifest.name, { path, manifest })
  }
  return result
}

async function loadManifest(path: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(path, 'utf8')) as PackageManifest
}

function formatChain(
  runtimeName: string,
  packageName: string,
  parents: ReadonlyMap<string, string | undefined>,
): string {
  const chain = [packageName]
  let parent = parents.get(packageName)
  while (parent !== undefined) {
    chain.unshift(parent)
    parent = parents.get(parent)
  }
  return [runtimeName, ...chain].join(' -> ')
}
