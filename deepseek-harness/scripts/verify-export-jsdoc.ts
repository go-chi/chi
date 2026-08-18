/**
 * Enforce JSDoc on every non-vendored package export. Functions and public
 * class methods require parameter and non-void return documentation; exported
 * declarations require description prose. Inline callable types, overload
 * signatures, namespace members, and public class members are included;
 * framework slots, constructors, inherited contracts, augmentations, and source
 * re-exports keep their docs at the declaring contract. Unknown forms fail closed.
 */

import { existsSync, globSync, readFileSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import ts from 'typescript'
import { checkParams, checkReturns, parseJsDoc, parseTags, pointer, rawJsDoc } from './jsdoc.ts'

const root = resolve(import.meta.dirname, '..')

/** Plugin-protocol slot names exempt as statics on an exported class. */
const PROTOCOL_STATICS = new Set(['Config', 'inject', 'name', 'reusable'])

/** Plugin-protocol slot names exempt as top-level exports (const or function). */
const PROTOCOL_EXPORTS = new Set(['Config', 'inject', 'name', 'reusable', 'apply'])

/** Per-file walk state threaded through the scope recursion. */
interface Walk {
  /** Repo-relative path of the file being walked. */
  rel: string
  /** The parsed source file. */
  sf: ts.SourceFile
  /** Raw file text (rawJsDoc reads comment ranges out of it). */
  text: string
  /** The program's checker, consulted only for heritage-member lookups. */
  checker: ts.TypeChecker
  /** The aggregate violation list, appended in place. */
  violations: string[]
}

/** True when a statement carries the `export` modifier. */
function isExported(stmt: ts.Statement): boolean {
  return ts.canHaveModifiers(stmt) && (ts.getModifiers(stmt)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false)
}

/** True for a class member a consumer cannot reach: `private`/`protected`/`#name`. */
function isNonPublic(member: ts.ClassElement): boolean {
  const mods = ts.canHaveModifiers(member) ? ts.getModifiers(member) : undefined
  return (mods?.some(m => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword) ?? false)
    || ('name' in member && ts.isPrivateIdentifier(member.name))
}

/** True when a class member carries the `static` modifier. */
function isStatic(member: ts.ClassElement): boolean {
  const mods = ts.canHaveModifiers(member) ? ts.getModifiers(member) : undefined
  return mods?.some(m => m.kind === ts.SyntaxKind.StaticKeyword) ?? false
}

/** The `this`-receiver exemption every function-like check shares. */
function thisReceiver(p: ts.ParameterDeclaration): boolean {
  return ts.isIdentifier(p.name) && p.name.text === 'this'
}

/**
 * Peel wrapper expressions that define no API of their own — parentheses,
 * `as` / `satisfies` / angle-bracket casts, non-null assertions — so a
 * wrapped function expression is still classified as function-like.
 * @param e - the expression to unwrap.
 * @returns the innermost non-wrapper expression.
 */
function unwrapExpression(e: ts.Expression): ts.Expression {
  let inner = e
  while (
    ts.isParenthesizedExpression(inner) || ts.isAsExpression(inner) || ts.isSatisfiesExpression(inner)
    || ts.isNonNullExpression(inner) || ts.isTypeAssertionExpression(inner)
  ) inner = inner.expression
  return inner
}

/**
 * Classify inline callable annotations. Mixed callable literals fail closed;
 * other annotations are ordinary value types.
 * @param type - the declarator's type annotation.
 * @returns the signature to check, 'refuse' for an unclassifiable callable literal, or null for a non-callable type.
 */
function callableAnnotation(type: ts.TypeNode): ts.SignatureDeclarationBase | 'refuse' | null {
  if (ts.isFunctionTypeNode(type)) return type
  if (!ts.isTypeLiteralNode(type)) return null
  const signatures = type.members.filter(m => ts.isCallSignatureDeclaration(m) || ts.isConstructSignatureDeclaration(m))
  if (signatures.length === 0) return null
  if (signatures.length === 1 && type.members.length === 1 && signatures[0] !== undefined && ts.isCallSignatureDeclaration(signatures[0])) {
    return signatures[0]
  }
  return 'refuse'
}

/**
 * Find inherited documentation for a class member without exempting a newly public API.
 * @param cls - the class whose heritage to search.
 * @param name - the member name to look up.
 * @param staticSide - whether to search the constructor side instead of the instance side.
 * @param checker - the program's type checker.
 * @returns inherited parameter and return coverage, or `null` when none applies.
 */
function heritageExemption(
  cls: ts.ClassDeclaration,
  name: string,
  staticSide: boolean,
  checker: ts.TypeChecker,
): { baseParams: Set<string> | null; baseVoidReturn: boolean | null } | null {
  const isProtected = (d: ts.Declaration): boolean =>
    (ts.canHaveModifiers(d) ? ts.getModifiers(d) : undefined)?.some(m => m.kind === ts.SyntaxKind.ProtectedKeyword) ?? false
  for (const clause of cls.heritageClauses ?? []) {
    for (const t of clause.types) {
      const type = staticSide ? checker.getTypeAtLocation(t.expression) : checker.getTypeAtLocation(t)
      const prop = type.getProperty(name)
      if (prop === undefined) continue
      const decls = prop.declarations ?? []
      if (decls.length > 0 && decls.every(isProtected)) continue // public override of a protected base: new API
      let baseParams: Set<string> | null = null
      let baseVoidReturn: boolean | null = null
      for (const d of decls) {
        let params: readonly ts.ParameterDeclaration[] | undefined
        let returnType: ts.TypeNode | undefined
        if (ts.isMethodDeclaration(d) || ts.isMethodSignature(d)) {
          params = d.parameters
          returnType = d.type
        } else if ((ts.isPropertySignature(d) || ts.isPropertyDeclaration(d)) && d.type !== undefined && ts.isFunctionTypeNode(d.type)) {
          params = d.type.parameters
          returnType = d.type.type
        } else continue
        baseParams ??= new Set()
        // Leading underscores are the deliberately-unused marker (lint
        // argsIgnorePattern), not a rename: `_cwd` overriding `cwd` is the
        // same parameter, so compare underscore-stripped on both sides.
        for (const p of params) if (ts.isIdentifier(p.name)) baseParams.add(p.name.text.replace(/^_+/, ''))
        if (returnType !== undefined) {
          const voidish = /^(void|Promise<void>)$/.test(returnType.getText(d.getSourceFile()).replace(/\s+/g, ' '))
          baseVoidReturn = (baseVoidReturn ?? true) && voidish
        }
      }
      return { baseParams, baseVoidReturn }
    }
  }
  return null
}

/**
 * True when a method's INFERRED return type is void-like (void, undefined,
 * never, or a promise of one) — the one return the walk asks the checker to
 * classify: an unannotated override above a void heritage member, where
 * demanding an annotation just to prove faithfulness would be boilerplate.
 * @param m - a method declaration with no return type annotation.
 * @param checker - the program's type checker.
 * @returns true when the inferred result carries nothing to document.
 */
function inferredReturnIsVoidish(m: ts.MethodDeclaration, checker: ts.TypeChecker): boolean {
  const sig = checker.getSignatureFromDeclaration(m)
  if (sig === undefined) return true // no callable signature: nothing classifiable to document
  const returned = checker.getReturnTypeOfSignature(sig)
  const awaited = checker.getAwaitedType(returned) ?? returned
  return (awaited.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined | ts.TypeFlags.Never)) !== 0
}

/**
 * Check description-prose presence for one labeled declaration: JSDoc must
 * exist and carry prose above its block tags.
 * @param where - the offender label violations open with.
 * @param raw - the declaration's raw JSDoc block ('' if none).
 * @param w - the walk state violations append to.
 */
function checkDescribed(where: string, raw: string, w: Walk): void {
  if (!raw) w.violations.push(`${where} has no JSDoc.`)
  else if (!parseJsDoc(raw).doc) w.violations.push(`${where} has no description prose above its block tags.`)
}

/**
 * Check the full function contract for one labeled function-like declaration:
 * description prose, `@param` per parameter, `@returns` on a non-void result.
 * @param where - the offender label violations open with.
 * @param raw - the declaration's raw JSDoc block ('' if none).
 * @param parameters - the declaration's parameter list.
 * @param returnType - the return type annotation, or undefined when inferred.
 * @param returnsWaived - suppress the `@returns`/annotation requirement (a
 * declarator-annotated const defers its return contract to the named type).
 * @param w - the walk state violations append to.
 */
function checkFunctionLike(
  where: string,
  raw: string,
  parameters: readonly ts.ParameterDeclaration[],
  returnType: ts.TypeNode | undefined,
  returnsWaived: boolean,
  w: Walk,
): void {
  if (!raw) { w.violations.push(`${where} has no JSDoc.`); return }
  if (!parseJsDoc(raw).doc) w.violations.push(`${where} has no description prose above its block tags.`)
  const { params, returns } = parseTags(raw)
  checkParams(where, 'exported', parameters, params, w.sf, thisReceiver, w.violations)
  if (!returnsWaived) checkReturns(where, returnType, returns, w.sf, w.violations)
}

/**
 * Check one exported class: class-level prose, the function contract on every
 * public method (overload implementations exempt), and description prose on
 * public properties and accessors (a get/set pair is covered by the getter's
 * doc). Heritage-declared members are exempt per heritageExemption (an
 * override's extra parameters keep their @param duty); plugin-protocol
 * statics are exempt; constructors are not checked (framework-constructed
 * plugins, and the class doc owns the story).
 * @param cls - the exported class declaration.
 * @param name - the class's exported name (namespace-qualified).
 * @param w - the walk state violations append to.
 */
function checkClass(cls: ts.ClassDeclaration, name: string, w: Walk): void {
  checkDescribed(`exported class '${name}' (${pointer(w.rel, w.sf, cls)})`, rawJsDoc(w.text, cls), w)
  const overloadSigs = new Set<string>()
  const documentedGetters = new Set<string>()
  for (const m of cls.members) {
    if ('name' in m && ts.isComputedPropertyName(m.name)) continue
    if (ts.isMethodDeclaration(m) && !m.body) overloadSigs.add(m.name.getText(w.sf))
    if (ts.isGetAccessorDeclaration(m)) documentedGetters.add(m.name.getText(w.sf))
  }
  for (const m of cls.members) {
    if (isNonPublic(m) || ts.isConstructorDeclaration(m)) continue
    if (!('name' in m) || ts.isComputedPropertyName(m.name)) continue // computed/symbol members
    const mname = m.name.getText(w.sf)
    if (isStatic(m) && PROTOCOL_STATICS.has(mname)) continue // cordis plugin-protocol slot
    const exemption = heritageExemption(cls, mname, isStatic(m), w.checker)
    if (ts.isMethodDeclaration(m)) {
      if (m.body && overloadSigs.has(mname)) continue // overload implementation: the signatures carry the docs
      const where = `exported class method '${name}.${mname}' (${pointer(w.rel, w.sf, m)})`
      if (exemption !== null) {
        const raw = rawJsDoc(w.text, m)
        // The heritage declaration owns the prose; parameters the base never
        // names — including binding patterns, which no base declaration can
        // name — are new API and keep their @param duty.
        const base = exemption.baseParams
        const inBase = (p: ts.ParameterDeclaration): boolean =>
          base !== null && ts.isIdentifier(p.name) && base.has(p.name.text.replace(/^_+/, ''))
        if (base !== null && m.parameters.some(p => !thisReceiver(p) && !inBase(p))) {
          checkParams(where, 'exported', m.parameters, parseTags(raw).params, w.sf,
            p => thisReceiver(p) || inBase(p), w.violations)
        }
        // A void base return carried no @returns duty, so an override growing a concrete result
        // documents it itself.
        if (exemption.baseVoidReturn === true) {
          if (m.type !== undefined) {
            checkReturns(where, m.type, parseTags(raw).returns, w.sf, w.violations)
          } else if (!inferredReturnIsVoidish(m, w.checker)) {
            w.violations.push(`${where} returns a non-void result its heritage declaration does not document; annotate the return type and add @returns.`)
          }
        }
        continue
      }
      checkFunctionLike(where, rawJsDoc(w.text, m), m.parameters, m.type, false, w)
    } else if (exemption !== null) {
      continue // the heritage declaration owns the doc (properties/accessors carry no own parameters)
    } else if (ts.isGetAccessorDeclaration(m) || ts.isPropertyDeclaration(m)) {
      const kind = ts.isPropertyDeclaration(m) ? 'property' : 'accessor'
      checkDescribed(`exported class ${kind} '${name}.${mname}' (${pointer(w.rel, w.sf, m)})`, rawJsDoc(w.text, m), w)
    } else if (ts.isSetAccessorDeclaration(m) && !documentedGetters.has(mname)) {
      checkDescribed(`exported class accessor '${name}.${mname}' (${pointer(w.rel, w.sf, m)})`, rawJsDoc(w.text, m), w)
    }
    // index signatures / static blocks: no named API
  }
}

/**
 * Check one exported declaration.
 * @param stmt - exported statement.
 * @param prefix - namespace qualifier.
 * @param overloadSigs - bodyless overload names.
 * @param byName - declarations keyed by name.
 * @param ambient - whether exports are implicit.
 * @param w - walk state.
 * @param only - selected declarators, or all.
 */
function checkDecl(
  stmt: ts.Statement,
  prefix: string,
  overloadSigs: Set<string>,
  byName: Map<string, ts.Statement[]>,
  ambient: boolean,
  w: Walk,
  only: ReadonlySet<string> | null = null,
): void {
  const at = (n: ts.Node): string => ` (${pointer(w.rel, w.sf, n)})`
  if (ts.isFunctionDeclaration(stmt)) {
    const name = stmt.name?.text ?? 'default'
    if (prefix === '' && PROTOCOL_EXPORTS.has(name)) return // cordis plugin-protocol slot
    if (stmt.body && overloadSigs.has(name)) return // overload implementation: the signatures carry the docs
    checkFunctionLike(`exported function '${prefix}${name}'${at(stmt)}`, rawJsDoc(w.text, stmt),
      stmt.parameters, stmt.type, false, w)
    return
  }
  if (ts.isClassDeclaration(stmt)) {
    checkClass(stmt, `${prefix}${stmt.name?.text ?? 'default'}`, w)
    return
  }
  if (ts.isInterfaceDeclaration(stmt)) {
    checkDescribed(`exported interface '${prefix}${stmt.name.text}'${at(stmt)}`, rawJsDoc(w.text, stmt), w)
    return
  }
  if (ts.isTypeAliasDeclaration(stmt)) {
    checkDescribed(`exported type '${prefix}${stmt.name.text}'${at(stmt)}`, rawJsDoc(w.text, stmt), w)
    return
  }
  if (ts.isEnumDeclaration(stmt)) {
    checkDescribed(`exported enum '${prefix}${stmt.name.text}'${at(stmt)}`, rawJsDoc(w.text, stmt), w)
    return
  }
  if (ts.isVariableStatement(stmt)) {
    const raw = rawJsDoc(w.text, stmt) // JSDoc sits on the statement, not the declarator
    for (const d of stmt.declarationList.declarations) {
      const name = ts.isIdentifier(d.name) ? d.name.text : d.name.getText(w.sf)
      if (only !== null && !only.has(name)) continue // sibling declarator the export list never named: not exported API
      if (prefix === '' && PROTOCOL_EXPORTS.has(name)) continue // cordis plugin-protocol slot
      const where = `exported const '${prefix}${name}'${at(d)}`
      const annotation = d.type !== undefined ? callableAnnotation(d.type) : null
      const init = d.initializer !== undefined ? unwrapExpression(d.initializer) : undefined
      if (annotation === 'refuse') {
        // A literal mixing call/construct signatures with other members (or
        // overloading them) has no single signature the walk can hold the
        // tags against — fail closed rather than silently narrow the check.
        w.violations.push(`${where}: its callable type literal is not gate-classifiable; extract a named type and document it there.`)
      } else if (annotation !== null) {
        // An INLINE callable annotation is the exported signature itself: its
        // parameters and result need docs right here. (A NAMED reference
        // type carries its docs at the type's own declaration instead.)
        checkFunctionLike(where, raw, annotation.parameters, annotation.type, false, w)
      } else if (init !== undefined && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
        // A named declarator type annotation (`const f: Handler = …`) hands
        // the return contract to the named type; the arrow's own annotation is
        // still checked when it is the only signature the reader has.
        checkFunctionLike(where, raw, init.parameters, init.type, init.type === undefined && d.type !== undefined, w)
      } else {
        checkDescribed(where, raw, w)
      }
    }
    return
  }
  if (ts.isModuleDeclaration(stmt) && ts.isIdentifier(stmt.name)) {
    // A namespace merging with a documented same-name sibling (the
    // Config-namespace idiom) needs no second doc block of its own.
    const siblings = (byName.get(stmt.name.text) ?? []).filter(s => s !== stmt)
    const merged = siblings.some(s => parseJsDoc(rawJsDoc(w.text, s)).doc !== '')
    if (!merged) checkDescribed(`exported namespace '${prefix}${stmt.name.text}'${at(stmt)}`, rawJsDoc(w.text, stmt), w)
    let body = stmt.body
    let nsPrefix = `${prefix}${stmt.name.text}.`
    while (body !== undefined && ts.isModuleDeclaration(body)) { // dotted `namespace A.B`
      nsPrefix += `${body.name.getText(w.sf)}.`
      body = body.body
    }
    // In an ambient (`declare`) namespace body, members are implicitly
    // exported — no `export` modifier required — so the recursion must treat
    // every statement as exported API.
    const declared = ambient
      || ((ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) : undefined)?.some(m => m.kind === ts.SyntaxKind.DeclareKeyword) ?? false)
    if (body !== undefined && ts.isModuleBlock(body)) checkScope(body.statements, nsPrefix, w, declared)
    return
  }
  if (ts.isImportEqualsDeclaration(stmt)) {
    const where = `exported alias '${prefix}${stmt.name.text}'${at(stmt)}`
    // An alias is a distinct exported name whose target may be a non-exported namespace member
    // no walk ever visits, so it documents ITSELF — which matches the gate's strength only for
    // prose-only target kinds.
    const sym = w.checker.getSymbolAtLocation(stmt.name)
    const target = sym !== undefined && (sym.flags & ts.SymbolFlags.Alias) !== 0 ? w.checker.getAliasedSymbol(sym) : sym
    const RICH_TARGETS = ts.SymbolFlags.Function | ts.SymbolFlags.Class | ts.SymbolFlags.ValueModule | ts.SymbolFlags.NamespaceModule
    const rich = target === undefined
      || (target.flags & RICH_TARGETS) !== 0
      || w.checker.getTypeOfSymbol(target).getCallSignatures().length > 0
    if (rich) {
      w.violations.push(`${where} aliases a callable, class, or namespace target whose signature/member contract the alias cannot carry; export the declaration directly instead.`)
      return
    }
    checkDescribed(where, rawJsDoc(w.text, stmt), w)
    return
  }
  // Fail CLOSED: an exported statement kind this dispatch does not recognize
  // must never pass silently — the gate's whole promise is that unchecked
  // unchecked API cannot exist. New TypeScript export forms extend the gate here.
  w.violations.push(`exported statement${at(stmt)} uses an export form verify-export-jsdoc does not handle; extend the gate.`)
}

/**
 * Walk one lexical scope (file top level or a namespace body): check every
 * exported declaration, resolving `export { … }` lists (no module specifier)
 * to their local declarations.
 * @param statements - the scope's statements.
 * @param prefix - the namespace qualification for exported names ('' at top level).
 * @param w - the walk state violations append to.
 * @param ambient - whether this scope is ambient (`declare` namespace or a declaration file), where members export implicitly.
 */
function checkScope(
  statements: readonly ts.Statement[],
  prefix: string,
  w: Walk,
  ambient: boolean,
  allowedNames?: ReadonlySet<string>,
): void {
  const byName = new Map<string, ts.Statement[]>()
  const overloadSigs = new Set<string>()
  const add = (name: string, stmt: ts.Statement): void => {
    byName.set(name, [...(byName.get(name) ?? []), stmt])
  }
  for (const stmt of statements) {
    if (ts.isFunctionDeclaration(stmt)) {
      if (stmt.name) add(stmt.name.text, stmt)
      if (!stmt.body && stmt.name) overloadSigs.add(stmt.name.text)
    } else if (ts.isClassDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)
      || ts.isTypeAliasDeclaration(stmt) || ts.isEnumDeclaration(stmt)) {
      if (stmt.name) add(stmt.name.text, stmt)
    } else if (ts.isModuleDeclaration(stmt) && ts.isIdentifier(stmt.name)) {
      add(stmt.name.text, stmt)
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) add(d.name.text, stmt)
      }
    }
  }
  // Two-phase dispatch.
  const requested = new Map<ts.Statement, Set<string> | null>()
  const request = (stmt: ts.Statement, name: string | null): void => {
    const prior = requested.get(stmt)
    if (name === null || prior === null) {
      requested.set(stmt, null)
      return
    }
    requested.set(stmt, prior === undefined ? new Set([name]) : prior.add(name))
  }
  for (const stmt of statements) {
    if (ts.isModuleDeclaration(stmt)
      && (ts.isStringLiteral(stmt.name) || (stmt.flags & ts.NodeFlags.GlobalAugmentation) !== 0)) {
      continue // `declare module '…'` / `declare global` augmentation: not an export of this package
    }
    if (ts.isExportDeclaration(stmt)) {
      if (stmt.moduleSpecifier) continue // re-export: the defining module is walked on its own
      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          const local = (el.propertyName ?? el.name).text
          for (const decl of byName.get(local) ?? []) request(decl, local)
          // a name with no local declaration is an imported binding re-exported
          // without a specifier — its defining module is walked on its own
        }
      }
      continue
    }
    if (ts.isExportAssignment(stmt)) {
      if (stmt.isExportEquals) {
        // `export =` has no ESM consumer API in this repo and the walk
        // cannot classify its operand's type; refuse rather than fail open.
        w.violations.push(`export-equals assignment (${pointer(w.rel, w.sf, stmt)}) is not a gate-supported export form; use ESM named exports.`)
        continue
      }
      const where = `default export (${pointer(w.rel, w.sf, stmt)})`
      const expr = unwrapExpression(stmt.expression)
      if (ts.isIdentifier(expr)) {
        for (const decl of byName.get(expr.text) ?? []) request(decl, expr.text)
      } else if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
        checkFunctionLike(where, rawJsDoc(w.text, stmt), expr.parameters, expr.type, false, w)
      } else {
        checkDescribed(where, rawJsDoc(w.text, stmt), w)
      }
      continue
    }
    if (isExported(stmt) || (ambient && !ts.isImportDeclaration(stmt))) {
      if (allowedNames === undefined) {
        request(stmt, null)
      } else if (ts.isVariableStatement(stmt)) {
        for (const declaration of stmt.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && allowedNames.has(declaration.name.text)) {
            request(stmt, declaration.name.text)
          }
        }
      } else {
        const name = declarationName(stmt) ?? 'default'
        if (allowedNames.has(name)) request(stmt, null)
      }
    }
  }
  for (const stmt of statements) {
    const only = requested.get(stmt)
    if (only !== undefined) checkDecl(stmt, prefix, overloadSigs, byName, ambient, w, only)
  }
}

function exportedTargets(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (!value || typeof value !== 'object') return []
  return Object.values(value).flatMap(exportedTargets)
}

function sourceEntry(target: string): string | undefined {
  if (target.startsWith('./lib/types/') && target.endsWith('.d.ts')) {
    return `src/${target.slice('./lib/types/'.length, -'.d.ts'.length)}.ts`
  }
  if (target.startsWith('./lib/') && target.endsWith('.js')) {
    return `src/${target.slice('./lib/'.length, -'.js'.length)}.ts`
  }
  return undefined
}

function declarationName(declaration: ts.Node): string | undefined {
  const name = (declaration as ts.NamedDeclaration).name
  if (name && ts.isIdentifier(name)) return name.text
  return undefined
}

/** Resolve the declarations reachable through packages that do not export src/*. */
function restrictedPublicNames(
  scanRoot: string,
  rels: readonly string[],
  program: ts.Program,
  checker: ts.TypeChecker,
): { restrictedPackages: Set<string>; namesByFile: Map<string, Set<string>> } {
  const restrictedPackages = new Set<string>()
  const namesByFile = new Map<string, Set<string>>()
  const packages = new Set(rels.map(rel => rel.split('/').slice(0, 3).join('/')))
  for (const packageDir of packages) {
    const manifestPath = resolve(scanRoot, packageDir, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { exports?: Record<string, unknown> }
    if (!manifest.exports || manifest.exports['./src/*'] !== undefined) continue
    restrictedPackages.add(packageDir)
    const entries = new Set(Object.values(manifest.exports).flatMap(exportedTargets).flatMap((target) => {
      const entry = sourceEntry(target)
      return entry ? [`${packageDir}/${entry}`] : []
    }))
    for (const entry of entries) {
      const source = program.getSourceFile(resolve(scanRoot, entry))
      const moduleSymbol = source && checker.getSymbolAtLocation(source)
      if (!source || !moduleSymbol) continue
      for (const exported of checker.getExportsOfModule(moduleSymbol)) {
        const target = (exported.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(exported) : exported
        for (const declaration of target.declarations ?? []) {
          const name = declarationName(declaration)
          const file = declaration.getSourceFile().fileName
          const rel = relative(scanRoot, file).split(sep).join('/')
          if (!name || !rel.startsWith(`${packageDir}/src/`)) continue
          namesByFile.set(rel, new Set([...(namesByFile.get(rel) ?? []), name]))
        }
      }
    }
  }
  return { restrictedPackages, namesByFile }
}

/**
 * Compiler options for the walk's program.
 *
 * @param scanRoot - the root being scanned.
 * @returns compiler options for ts.createProgram.
 */
function loadCompilerOptions(scanRoot: string): ts.CompilerOptions {
  const cfgPath = resolve(scanRoot, 'tsconfig.base.json')
  if (!existsSync(cfgPath)) return { skipLibCheck: true, noLib: true, types: [] }
  const cfg = ts.readConfigFile(cfgPath, ts.sys.readFile.bind(ts.sys)) as { config?: unknown }
  const parsed = ts.parseJsonConfigFileContent(cfg.config ?? {}, ts.sys, scanRoot)
  return {
    ...parsed.options,
    noEmit: true,
    composite: false,
    declaration: false,
    declarationMap: false,
    sourceMap: false,
    incremental: false,
  }
}

/**
 * Walk every non-vendored package source file and collect JSDoc-completeness
 * violations for its module-level exports. Returns findings instead of
 * throwing so tests assert on the list; the CLI entry turns a non-empty list
 * into exit 1.
 * @param scanRoot - the repo root to scan; tests pass a fixture dir.
 * @returns every violation, in file order, one human-readable line each.
 */
export function collectExportJsdocViolations(scanRoot: string = root): string[] {
  const violations: string[] = []
  const rels = globSync('packages/*/*/src/**/*.ts', { cwd: scanRoot })
    .map(path => path.split(sep).join('/'))
    .sort()
  const program = ts.createProgram(rels.map(rel => resolve(scanRoot, rel)), loadCompilerOptions(scanRoot))
  const checker = program.getTypeChecker()
  const { restrictedPackages, namesByFile } = restrictedPublicNames(scanRoot, rels, program, checker)
  for (const rel of rels) {
    const sf = program.getSourceFile(resolve(scanRoot, rel))
    if (!sf) continue // program root files always resolve; guard for narrowing
    // A script-style declaration file (no imports/exports) is one big ambient
    // scope; a module-style .d.ts still honors explicit export modifiers.
    const packageDir = rel.split('/').slice(0, 3).join('/')
    const allowedNames = restrictedPackages.has(packageDir) ? namesByFile.get(rel) ?? new Set<string>() : undefined
    checkScope(
      sf.statements,
      '',
      { rel, sf, text: sf.text, checker, violations },
      sf.isDeclarationFile && !ts.isExternalModule(sf),
      allowedNames,
    )
  }
  return violations
}

/** CLI entry: list every violation and exit 1, or confirm a documented API. */
function main(): void {
  const violations = collectExportJsdocViolations()
  if (violations.length === 0) {
    console.log('verify-export-jsdoc: every exported name in each package API is documented.')
    return
  }
  console.error(`verify-export-jsdoc: ${violations.length} JSDoc completeness violation(s) (see AGENTS.md):`)
  for (const v of violations) console.error(`  ${v}`)
  process.exit(1)
}

// Run only when invoked as a script, not when imported by a test.
if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  main()
}
