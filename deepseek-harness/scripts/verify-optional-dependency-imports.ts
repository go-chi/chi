/**
 * Reject a static value import of an optional dependency.
 *
 * A dependency declared in `optionalDependencies`, or as a peer carrying
 * `peerDependenciesMeta.<name>.optional`, may be absent from an installed tree —
 * that absence is what "optional" promises a consumer. A static import is
 * evaluated when the importing module loads, so one absent package turns
 * "this capability is unavailable" into a load failure for everything that
 * reaches the importing module.
 *
 * The way out, in order: import it as a type, which emits nothing and is all
 * that declaration merging needs; or restructure so nothing at module scope
 * needs the package. A dynamic `import()` only moves the failure to first use,
 * so it belongs to a caller that genuinely requires the package and handles its
 * absence — it is a last resort, not the default answer, and reaching for it is
 * a sign the dependency is not optional.
 *
 * Value-vs-type is decided against a bound Program rather than the import
 * syntax, because `verbatimModuleSyntax` is off: a named import used only in
 * type positions is elided and does not load anything. The decision is
 * deliberately conservative in one direction — a value binding the compiler
 * would elide because nothing references it in a value position is still
 * reported, and the fix it asks for (`import type`, or dropping the binding) is
 * what the published package wants regardless. Both compiler faces are scanned,
 * and only files that ship — a published package's `src` — are subject.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { TypeScriptProject, type CompilerFace } from './ts-project.ts'

const root = resolve(import.meta.dirname, '..')

/** Directories whose `src` ships as a published package. */
const PUBLISHED_SOURCE = /^(?:packages\/[^/]+\/[^/]+|apps\/[^/]+)\/src\//

/** How a manifest marked a dependency optional, for the violation message. */
type OptionalKind = 'optionalDependencies' | 'peerDependenciesMeta'

/**
 * The package name a module specifier resolves to.
 * @param specifier - an import specifier, possibly a subpath.
 * @returns The bare package name, keeping a leading scope.
 */
function packageOf(specifier: string): string {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0] ?? specifier
}

/**
 * Read a manifest field as a record.
 * @param manifest - parsed manifest.
 * @param field - field name.
 * @returns The field value, or an empty record.
 */
function record(manifest: Record<string, unknown>, field: string): Record<string, unknown> {
  const value = manifest[field]
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

/**
 * The dependencies one manifest allows to be absent.
 * @param manifest - parsed manifest.
 * @returns Each optional package name and how it was marked.
 */
function optionalDependencies(manifest: Record<string, unknown>): Map<string, OptionalKind> {
  const optional = new Map<string, OptionalKind>()
  for (const name of Object.keys(record(manifest, 'optionalDependencies'))) {
    optional.set(name, 'optionalDependencies')
  }
  const peers = record(manifest, 'peerDependencies')
  for (const [name, meta] of Object.entries(record(manifest, 'peerDependenciesMeta'))) {
    if (meta === null || typeof meta !== 'object') continue
    if ((meta as Record<string, unknown>).optional !== true) continue
    // A meta entry for an undeclared peer is check-workspace-constraints' business.
    if (!(name in peers)) continue
    optional.set(name, 'peerDependenciesMeta')
  }
  return optional
}

/** One package directory's optional dependencies, resolved once per directory. */
const optionalByDirectory = new Map<string, Map<string, OptionalKind>>()

/**
 * The optional dependencies of the package owning a source file.
 * @param projectRoot - root the relative path is resolved against.
 * @param relativePath - repository-relative path of a source file.
 * @returns That package's optional dependencies, empty when it declares none.
 */
function optionalFor(projectRoot: string, relativePath: string): Map<string, OptionalKind> {
  const directory = resolve(projectRoot, relativePath.slice(0, relativePath.indexOf('/src/')))
  const cached = optionalByDirectory.get(directory)
  if (cached !== undefined) return cached
  const manifestPath = resolve(directory, 'package.json')
  const parsed: unknown = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {}
  const manifest = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {}
  const optional = optionalDependencies(manifest)
  optionalByDirectory.set(directory, optional)
  return optional
}

/**
 * Whether one binding of an import or re-export names a value.
 * @param name - the local binding name node.
 * @param checker - the program's checker.
 * @returns True when the binding carries value meaning, and on an unresolved
 * symbol, so an unresolvable binding fails closed.
 */
function bindsValue(name: ts.Identifier | ts.StringLiteral, checker: ts.TypeChecker): boolean {
  const symbol = checker.getSymbolAtLocation(name)
  if (symbol === undefined) return true
  const target = (symbol.flags & ts.SymbolFlags.Alias) === 0 ? symbol : checker.getAliasedSymbol(symbol)
  return (target.flags & ts.SymbolFlags.Value) !== 0
}

/**
 * Whether an import declaration loads its module at run time.
 * @param declaration - the import declaration.
 * @param checker - the program's checker.
 * @returns True when the emitted module keeps the import.
 */
function importLoadsModule(declaration: ts.ImportDeclaration, checker: ts.TypeChecker): boolean {
  const clause = declaration.importClause
  // A bare `import 'x'` is kept for its side effects.
  if (clause === undefined) return true
  // Only the type phase erases the import. `import defer` still resolves and
  // links the module, deferring evaluation alone, so an absent package fails
  // exactly as it would without the modifier.
  if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return false
  if (clause.name !== undefined) return true
  const bindings = clause.namedBindings
  if (bindings === undefined || ts.isNamespaceImport(bindings)) return true
  return bindings.elements.some(element => !element.isTypeOnly && bindsValue(element.name, checker))
}

/**
 * Whether a re-export loads its module at run time.
 * @param declaration - the export declaration, which carries a module specifier.
 * @param checker - the program's checker.
 * @returns True when the emitted module keeps the re-export.
 */
function exportLoadsModule(declaration: ts.ExportDeclaration, checker: ts.TypeChecker): boolean {
  if (declaration.isTypeOnly) return false
  const clause = declaration.exportClause
  // `export * from 'x'` re-exports whatever values the module has.
  if (clause === undefined || ts.isNamespaceExport(clause)) return true
  return clause.elements.some(element => !element.isTypeOnly && bindsValue(element.name, checker))
}

/**
 * Collect every static value import of an optional dependency in one face.
 * @param project - a bound repository project.
 * @returns One message per violation, sorted by location.
 */
export function collectOptionalImportViolations(project: TypeScriptProject): string[] {
  const checker = project.checker
  const violations: string[] = []
  for (const sourceFile of project.sourceFiles()) {
    if (sourceFile.isDeclarationFile) continue
    const relativePath = project.relativePath(sourceFile)
    if (!PUBLISHED_SOURCE.test(relativePath)) continue
    const optional = optionalFor(project.projectRoot, relativePath)
    if (optional.size === 0) continue

    for (const statement of sourceFile.statements) {
      const isImport = ts.isImportDeclaration(statement)
      if (!isImport && !ts.isExportDeclaration(statement)) continue
      const specifierNode = statement.moduleSpecifier
      if (specifierNode === undefined || !ts.isStringLiteral(specifierNode)) continue
      const kind = optional.get(packageOf(specifierNode.text))
      if (kind === undefined) continue
      const loads = isImport
        ? importLoadsModule(statement, checker)
        : exportLoadsModule(statement, checker)
      if (!loads) continue
      const { line } = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile))
      violations.push(
        `${relativePath}:${String(line + 1)} loads ${specifierNode.text} at module scope,`
        + ` declared optional in ${kind}; import it as a type, or restructure so module scope does not need it`,
      )
    }
  }
  return violations.sort((left, right) => left.localeCompare(right))
}

/** CLI entry: list every violation and exit 1, or confirm the invariant holds. */
function main(): void {
  const faces: readonly CompilerFace[] = ['host', 'client']
  const violations = new Set<string>()
  for (const face of faces) {
    for (const violation of collectOptionalImportViolations(new TypeScriptProject(root, face))) {
      violations.add(violation)
    }
  }
  if (violations.size === 0) {
    console.log('verify-optional-dependency-imports: no optional dependency is loaded at module scope.')
    return
  }
  console.error(`verify-optional-dependency-imports: ${String(violations.size)} optional dependency load(s) at module scope:`)
  for (const violation of [...violations].sort((left, right) => left.localeCompare(right))) {
    console.error(`  ${violation}`)
  }
  process.exit(1)
}

// Run only when invoked as a script, not when imported by a test.
if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  main()
}
