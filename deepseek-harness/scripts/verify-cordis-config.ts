/**
 * Validate Cordis Loader entry metadata and package resolution.
 *
 * The Loader interpolates a plugin entry's `config` (after declared injections
 * activate, against that plugin context) and the entry `disabled` field (at
 * every mount decision, against the loader context). Every other entry
 * metadata field stays static, so an expression there remains truthy data and
 * silently changes composition. Example configs and the dsh Web composition
 * resolve named plugins from their owning workspace manifests. Local example
 * packages must also be in the root TypeScript project graph.
 */

import { globSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import * as yaml from 'js-yaml'
import ts from 'typescript'
import { cordisConfigFiles } from './cordis-config-files.ts'

interface JsExpr {
  __jsExpr: string
}

interface PackageManifest {
  name?: string
  dependencies?: Record<string, string>
}

interface PluginReference {
  file: string
  name: string
}

const root = resolve(import.meta.dirname, '..')
// These example files are overlays consumed by the built dsh app, so their bare
// specifiers resolve from apps/cli rather than the examples workspace.
const appOverlayFiles = new Set([
  'examples/web-cordis/cordis.yml',
  'examples/web-schedule/cordis.yml',
  ...globSync('examples/mcp-memory/*.cordis.yml', { cwd: root }),
])
const metadataFields = ['id', 'name', 'group', 'inject', 'intercept', 'isolate'] as const

/** The adaptive directory-picker chooser package (mounts a backend row at boot). */
const CHOOSER_PACKAGE = '@deepseek-ai/dsh-host-directory-picker-auto'

/**
 * The packages the chooser mounts by runtime string (mirror of its exported
 * `BACKEND_PACKAGES` and `SURFACE_PACKAGES`), invisible to yml-row scanning: a
 * composition mounting the chooser must resolve every one, or keyless Linux CI
 * (which only ever resolves `browse`) hides a dropped `-native` dependency
 * until a macOS boot.
 */
const CHOOSER_BACKEND_PACKAGES = [
  '@deepseek-ai/dsh-host-directory-picker-native',
  '@deepseek-ai/dsh-host-directory-picker-browse',
  '@deepseek-ai/dsh-client-ui-directory-picker-browse',
  '@deepseek-ai/dsh-client-ui-directory-picker-native',
]
const jsExprType = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: data => typeof data === 'string',
  construct: (data: unknown): JsExpr => {
    if (typeof data !== 'string') throw new TypeError('!!js requires a scalar string')
    return { __jsExpr: data }
  },
})
const schema = yaml.JSON_SCHEMA.extend(jsExprType)

const errors: string[] = []
const pluginReferences: PluginReference[] = []

if (import.meta.main) {
  const files = cordisConfigFiles(root)

  for (const file of files) {
    const document: unknown = yaml.load(readFileSync(resolve(root, file), 'utf8'), { schema })
    if (!isUnknownArray(document)) {
      errors.push(`${file}: root must be a Loader entry array`)
      continue
    }
    for (let index = 0; index < document.length; index++) {
      validateEntry(document[index], file, `[${index}]`)
    }
  }

  errors.push(...validateExampleResolution())
  errors.push(...validateAppResolution())
  errors.push(...validateSourcePlaneResolution())
  errors.push(...validatePresetPlaneSeparation())
  errors.push(...validateClientHalvesDeclared())

  if (errors.length > 0) {
    console.error('verify-cordis-config: invalid Loader metadata or plugin package resolution:')
    for (const error of errors) console.error(`- ${error}`)
    process.exitCode = 1
  } else {
    console.log(`verify-cordis-config: ${files.length} config files passed.`)
  }
}

/**
 * A browser plugin must declare the browser half it ships.
 *
 * The browser roster is discovered by scanning composed packages for a
 * `dsh.client` block, and the node half of a surface plugin is an empty
 * `apply`. A `packages/client` package that exports `./client` without that
 * block therefore composes, activates, and contributes nothing — its bundle is
 * never served and no error is raised anywhere. The mismatch is invisible in
 * the composition file, so it is checked against the manifests instead. Only
 * this group is checked: a Host package's `./client` export is the typed wire
 * face its browser consumers import, not a plugin the roster serves.
 * @returns one violation per client package whose `./client` export and
 * `dsh.client` declaration disagree.
 */
function validateClientHalvesDeclared(): string[] {
  return globSync('packages/client/*/package.json', { cwd: root }).flatMap((manifestPath) => {
    const manifest = readManifest(manifestPath) as PackageManifest & {
      exports?: Record<string, unknown>
      dsh?: { client?: unknown }
    }
    const shipsClient = manifest.exports !== undefined && Object.hasOwn(manifest.exports, './client')
    const declaresClient = manifest.dsh?.client !== undefined
    if (shipsClient === declaresClient) return []
    return [shipsClient
      ? `${manifestPath}: exports "./client" but declares no dsh.client, so its browser half is never served`
      : `${manifestPath}: declares dsh.client but exports no "./client" entry to serve`]
  })
}

/**
 * No shipped agent preset may repeat a row the host composition still runs.
 *
 * A preset contributes what ONE session adds to the host's registries. A row
 * active on both planes is therefore mounted twice — once per process and once
 * per session — and what that costs depends on what the row does: a provider
 * behind an `isolate` realm shadows the host's for its own consumers, so a host
 * contributor to that service reaches nobody; a row that registers into a host
 * singleton registers once per live session, so the second one collides.
 *
 * Both have happened. `shell-env` in a preset realm left `DSH_WEB_URL` reaching
 * no shell, and `tool-subagent-report` handed every child `report` once per live
 * session until the second registration threw. Neither changes a tool catalog,
 * so no catalog assertion can see them — and the shipped presets are near-copies
 * of each other, so a fix applied to three of four is the normal failure.
 * @returns one diagnostic per preset row that is also active on the host plane.
 */
function validatePresetPlaneSeparation(): string[] {
  const problems: string[] = []
  // The shipped Web surface is two bundle patch layers over an empty root.
  const hostFile = 'packages/bundle/base/cordis.patch.yml'
  const overlayFile = 'packages/bundle/web-app/cordis.patch.yml'
  const hostRows = rowIds(hostFile)
  const overlay = loadEntries(overlayFile)
  const disabled = new Set<string>()
  for (const entry of overlay) {
    if (!isRecord(entry)) continue
    if (entry.disabled === true && typeof entry.id === 'string') disabled.add(entry.id)
  }
  // The overlay's own inserts are host-plane too; its disables take them back out.
  const active = new Set([...hostRows, ...rowIds(overlayFile)].filter(id => !disabled.has(id)))
  for (const file of globSync('apps/cli/config/agent-presets/*/agent.cordis.yml', { cwd: root })) {
    for (const id of rowIds(file)) {
      if (!active.has(id)) continue
      problems.push(
        `${file}: row "${id}" is also active in the host composition; `
        + 'a row belongs to exactly one plane',
      )
    }
  }
  return problems
}

/** Every entry of one config file, or an empty list when it is not an entry array. */
function loadEntries(file: string): unknown[] {
  const document: unknown = yaml.load(readFileSync(resolve(root, file), 'utf8'), { schema })
  return isUnknownArray(document) ? document : []
}

/**
 * Row ids declared anywhere in one config file, including inside group `config`
 * lists — a preset nests most of its rows in `isolate` groups.
 * @param file - repository-relative config path.
 * @returns the declared ids.
 */
function rowIds(file: string): Set<string> {
  const ids = new Set<string>()
  const walk = (value: unknown): void => {
    if (isUnknownArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (!isRecord(value)) return
    if (typeof value.id === 'string' && typeof value.name === 'string') ids.add(value.id)
    for (const child of Object.values(value)) walk(child)
  }
  walk(loadEntries(file))
  return ids
}

function validateEntry(value: unknown, file: string, path: string): void {
  if (!isRecord(value)) {
    errors.push(`${file}${path}: entry must be an object`)
    return
  }
  recordPlugin(value, file)
  validateMetadata(value, file, path)
  if ((value.group === true || value.name === '@deepseek-ai/cordis-plugin-group') && isUnknownArray(value.config)) {
    for (let index = 0; index < value.config.length; index++) {
      validateEntry(value.config[index], file, `${path}.config[${index}]`)
    }
  }
  if (isUnknownArray(value.insert)) {
    for (let index = 0; index < value.insert.length; index++) {
      validateEntry(value.insert[index], file, `${path}.insert[${index}]`)
    }
  }
  if (value.name !== '@deepseek-ai/cordis-plugin-include') return
  const config = value.config
  if (!isRecord(config) || !isUnknownArray(config.patches)) return
  for (let index = 0; index < config.patches.length; index++) {
    const patch = config.patches[index]
    const patchPath = `${path}.config.patches[${index}]`
    if (!isRecord(patch)) continue
    recordPlugin(patch, file)
    validateMetadata(patch, file, patchPath)
    if (!isUnknownArray(patch.insert)) continue
    for (let insertIndex = 0; insertIndex < patch.insert.length; insertIndex++) {
      validateEntry(patch.insert[insertIndex], file, `${patchPath}.insert[${insertIndex}]`)
    }
  }
}

function recordPlugin(entry: Record<string, unknown>, file: string): void {
  if (typeof entry.name === 'string') pluginReferences.push({ file, name: entry.name })
}

function validateExampleResolution(): string[] {
  const violations: string[] = []
  const exampleManifest = readManifest('examples/package.json')
  const dependencies = exampleManifest.dependencies ?? {}
  const localPackages = localPackageDirectories()
  const rootReferences = rootProjectReferences()
  const exampleReferences = pluginReferences.filter(reference => reference.file.startsWith('examples/') && !appOverlayFiles.has(reference.file))
  violations.push(...missingPluginDependencies(exampleReferences, dependencies, 'examples/package.json'))
  const requiredPackages = new Set(exampleReferences.map(reference => packageNameFromSpecifier(reference.name)))

  const localExamplePackages = new Set([
    ...Object.keys(dependencies),
    ...[...requiredPackages].filter(packageName => packageName !== undefined),
  ])
  for (const packageName of localExamplePackages) {
    const packageDirectory = localPackages.get(packageName)
    if (packageDirectory === undefined || rootReferences.has(packageDirectory)) continue
    const repoPath = relative(root, packageDirectory).replaceAll('\\', '/')
    violations.push(`tsconfig.json: missing project reference for ${packageName} (${repoPath})`)
  }

  return violations
}

function validateAppResolution(): string[] {
  const violations: string[] = []
  // App overlays (and any config left under apps/cli/config) resolve from the
  // dsh app's own dependency surface — the profile module fallback mirrors it.
  const appDependencies = {
    ...readManifest('apps/cli/package.json').dependencies,
    // The fallback also links every bundle's own dependencies (healProfilesModuleFallback).
    ...Object.fromEntries(globSync('packages/bundle/*/package.json', { cwd: root })
      .flatMap(file => Object.entries(readManifest(file).dependencies ?? {}))),
  }
  const shipped = new Set(globSync('*.cordis.yml', { cwd: resolve(root, 'apps/cli/config') })
    .map(file => `apps/cli/config/${file}`))
  const appReferences = pluginReferences.filter(reference => shipped.has(reference.file) || appOverlayFiles.has(reference.file))
  violations.push(...missingPluginDependencies(appReferences, appDependencies, 'apps/cli/package.json or a bundle manifest'))
  // Each bundle's patch rows must resolve from that bundle's own dependencies:
  // per-layer resolution anchors on the bundle package directory.
  for (const manifestPath of globSync('packages/bundle/*/package.json', { cwd: root })) {
    const bundleDir = manifestPath.replace(/\/package\.json$/, '')
    const manifest = readManifest(manifestPath)
    const references = pluginReferences.filter(reference => reference.file.startsWith(`${bundleDir}/`))
    violations.push(...missingPluginDependencies(
      // A bundle may mount its own package (the web-app runtime row).
      references.filter(reference => packageNameFromSpecifier(reference.name) !== manifest.name),
      manifest.dependencies ?? {},
      manifestPath,
    ))
  }
  return violations
}

/**
 * Every configured specifier of a local workspace package must resolve through
 * the tsconfig `paths` facade to a `.ts`/`.tsx` source file. The `dsh` source
 * launch (tsx) and vitest resolve in the source plane; without a `paths` match
 * they fall back to package `exports`, which reach built `lib/` — present on a
 * built dev tree, absent on a clean one — so a missing mapping boots locally
 * yet breaks every clean checkout. Anything but a `.ts`/`.tsx` hit (a `.d.ts`
 * or `.js` under built `lib/`) is that artifact-plane fallback, not source.
 */
function validateSourcePlaneResolution(): string[] {
  const violations: string[] = []
  const localPackages = localPackageDirectories()
  const config = ts.readConfigFile(resolve(root, 'tsconfig.base.json'), path => ts.sys.readFile(path))
  if (config.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  }
  const { options, errors: optionErrors } = ts.convertCompilerOptionsFromJson(
    (config.config as { compilerOptions?: unknown }).compilerOptions,
    root,
    'tsconfig.base.json',
  )
  if (optionErrors.length > 0) {
    throw new Error(optionErrors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'))
  }
  // convertCompilerOptionsFromJson leaves `pathsBasePath` unset, so relative
  // `paths` targets resolve against the host's current directory; anchor it to
  // the repository root to keep the gate cwd-independent.
  const host: ts.ModuleResolutionHost = {
    fileExists: path => ts.sys.fileExists(path),
    readFile: path => ts.sys.readFile(path),
    directoryExists: path => ts.sys.directoryExists(path),
    getCurrentDirectory: () => root,
  }
  const sourceExtensions = new Set<string>([ts.Extension.Ts, ts.Extension.Tsx])
  const containingFile = resolve(root, 'scripts/verify-cordis-config.ts')
  const locationsBySpecifier = new Map<string, Set<string>>()
  for (const reference of pluginReferences) {
    const packageName = packageNameFromSpecifier(reference.name)
    if (packageName === undefined || !localPackages.has(packageName)) continue
    const locations = locationsBySpecifier.get(reference.name) ?? new Set<string>()
    locations.add(reference.file)
    locationsBySpecifier.set(reference.name, locations)
  }
  for (const [specifier, locations] of locationsBySpecifier) {
    const resolved = ts.resolveModuleName(specifier, containingFile, options, host).resolvedModule
    if (resolved !== undefined && sourceExtensions.has(resolved.extension)) continue
    violations.push(`${[...locations].join(', ')}: ${specifier} does not resolve to workspace source through tsconfig.base.json paths (add a mapping so the tsx source launch does not depend on built lib/)`)
  }
  return violations
}

function missingPluginDependencies(
  references: readonly PluginReference[],
  dependencies: Readonly<Record<string, string>>,
  manifestPath: string,
): string[] {
  const requiredPackages = new Map<string, Set<string>>()
  const require = (packageName: string, file: string): void => {
    const locations = requiredPackages.get(packageName) ?? new Set<string>()
    locations.add(file)
    requiredPackages.set(packageName, locations)
  }
  for (const reference of references) {
    const packageName = packageNameFromSpecifier(reference.name)
    if (packageName === undefined) continue
    require(packageName, reference.file)
    if (packageName === CHOOSER_PACKAGE) {
      for (const backend of CHOOSER_BACKEND_PACKAGES) require(backend, reference.file)
    }
  }
  return [...requiredPackages].flatMap(([packageName, locations]) => packageName in dependencies
    ? []
    : `${[...locations].join(', ')}: ${packageName} must be declared in ${manifestPath} dependencies`)
}

function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8')) as PackageManifest
}

function localPackageDirectories(): Map<string, string> {
  const manifests = globSync(['packages/*/*/package.json', 'vendor/*/package.json'], { cwd: root })
  const packages = new Map<string, string>()
  for (const manifestPath of manifests) {
    const manifest = readManifest(manifestPath)
    if (manifest.name !== undefined) packages.set(manifest.name, resolve(root, dirname(manifestPath)))
  }
  return packages
}

function rootProjectReferences(): Set<string> {
  // The root solution references the host and client aggregates (the two
  // sides merge cordis Context under the same keys, so one program cannot see
  // both — but this BFS only collects reference paths, it never forms a
  // program). Seed the solution and follow nested aggregate references to
  // collect the covered leaf project set.
  const collected = new Set<string>()
  const queue = [resolve(root, 'tsconfig.json')]
  const seen = new Set<string>()
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file)) continue
    seen.add(file)
    const config = ts.readConfigFile(file, path => ts.sys.readFile(path))
    if (config.error !== undefined) {
      throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
    }
    const references = (config.config as { references?: Array<{ path?: unknown }> }).references ?? []
    for (const reference of references) {
      if (typeof reference.path !== 'string') continue
      const target = resolve(dirname(file), reference.path)
      if (target.endsWith('.json')) queue.push(target)
      else collected.add(target)
    }
  }
  return collected
}

function packageNameFromSpecifier(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('/') || /^[a-z][a-z+.-]*:/i.test(specifier)) return undefined
  const segments = specifier.split('/')
  if (specifier.startsWith('@')) {
    return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : undefined
  }
  return segments[0] || undefined
}

function validateMetadata(entry: Record<string, unknown>, file: string, path: string): void {
  for (const problem of metadataExpressionErrors(entry, path)) {
    errors.push(`${file}${problem}`)
  }
}

/**
 * Expression-node diagnostics for one entry. `disabled` is the single
 * interpolated metadata field: its own `!!js` expression node is allowed and
 * must parse, while expressions nested below it stay truthy data; every other
 * metadata field must stay fully static.
 * @param entry - one loader entry (or patch row).
 * @param path - the entry's diagnostic path prefix.
 * @returns one diagnostic per offending expression.
 */
export function metadataExpressionErrors(entry: Record<string, unknown>, path: string): string[] {
  const problems: string[] = []
  for (const field of metadataFields) {
    if (!(field in entry)) continue
    const expressionPaths: string[] = []
    collectExpressionPaths(entry[field], `${path}.${field}`, expressionPaths)
    for (const expressionPath of expressionPaths) problems.push(`${expressionPath}: !!js is not interpolated here`)
  }
  const disabled = entry.disabled
  if (disabled !== undefined) {
    if (isJsExpr(disabled)) {
      const detail = disabledExpressionProblem(disabled.__jsExpr)
      if (detail !== undefined) problems.push(`${path}.disabled${detail}`)
    } else {
      // A non-expression value gates on Boolean() at mount; an expression
      // nested anywhere below it never evaluates, so it must stay literal.
      const expressionPaths: string[] = []
      collectExpressionPaths(disabled, `${path}.disabled`, expressionPaths)
      for (const expressionPath of expressionPaths) problems.push(`${expressionPath}: !!js is not interpolated here`)
    }
  }
  return problems
}

/**
 * Parse-only validation of a `disabled` expression: the Loader evaluates it
 * at every mount decision, and a syntax error would fail the boot — rejecting
 * it here moves that failure to the earliest resolvable point.
 * @param expression - the `!!js` expression text.
 * @returns the diagnostic suffix, or `undefined` when the expression parses.
 */
function disabledExpressionProblem(expression: string): string | undefined {
  try {
    // Compilation only — the constructor never executes the body.
    // oxlint-disable-next-line typescript/no-implied-eval
    new Function(`return (${expression})`)
    return undefined
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return `: disabled expression does not parse: ${detail}`
  }
}

function collectExpressionPaths(value: unknown, path: string, output: string[]): void {
  if (isJsExpr(value)) {
    output.push(path)
    return
  }
  if (isUnknownArray(value)) {
    for (let index = 0; index < value.length; index++) collectExpressionPaths(value[index], `${path}[${index}]`, output)
    return
  }
  if (!isRecord(value)) return
  for (const [key, child] of Object.entries(value)) collectExpressionPaths(child, `${path}.${key}`, output)
}

function isJsExpr(value: unknown): value is JsExpr {
  return isRecord(value) && typeof value.__jsExpr === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}
