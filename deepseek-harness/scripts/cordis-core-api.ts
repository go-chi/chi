/** Generate detailed Cordis core API pages from pinned vendor declarations. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { checkParams, checkReturns, parseJsDoc, parseTags, pointer, rawJsDoc, reportViolations } from './jsdoc.ts'
import { cordisModuleBody } from './cordis-walk.ts'

const root = resolve(import.meta.dirname, '..')
const FENCE = 'ts cordis-catalog'

/** One declaration group rendered on a Cordis core API page. */
type CordisCoreApiSection =
  | { kind: 'class'; file: string; symbol: string; prefix?: string; heading?: string }
  | { kind: 'context-merge'; file: string; heading?: string }
  | { kind: 'decl'; file: string; symbol: string }

/** One generated Cordis core API page. */
export interface CordisCoreApiPage {
  out: string
  title: string
  intro: string
  sections: CordisCoreApiSection[]
}

/** Explicit editorial grouping for the pinned Cordis core API. */
export const CORDIS_CORE_API_PAGES: CordisCoreApiPage[] = [
  {
    out: 'docs/cordis-api/context.md',
    title: 'Context',
    intro: 'The context is the core Cordis object: every service, event, and lifecycle API is reached through `ctx`. Event methods are documented on [Events](events.md), effects and the current fiber on [Fiber](fiber.md), and plugin loading on [Registry](registry.md).',
    sections: [
      { kind: 'class', file: 'vendor/cordis/src/context.ts', symbol: 'Context', prefix: 'ctx.' },
      { kind: 'context-merge', file: 'vendor/cordis/src/reflect.ts', heading: 'Service store and mixins' },
    ],
  },
  {
    out: 'docs/cordis-api/events.md',
    title: 'Events',
    intro: 'The event-dispatch API mixed into every context. Harness event declarations and their dispatch modes are generated into each owning [subsystem page](../subsystems/core.md).',
    sections: [
      { kind: 'context-merge', file: 'vendor/cordis/src/events.ts' },
      { kind: 'decl', file: 'vendor/cordis/src/events.ts', symbol: 'EventOptions' },
      { kind: 'decl', file: 'vendor/cordis/src/events.ts', symbol: 'DispatchMode' },
    ],
  },
  {
    out: 'docs/cordis-api/fiber.md',
    title: 'Fiber',
    intro: 'A fiber is one loaded plugin instance: its lifecycle state, validated config, and registered effects. `ctx.fiber` is the current fiber, and `ctx.effect()` delegates to it.',
    sections: [
      { kind: 'context-merge', file: 'vendor/cordis/src/fiber.ts' },
      { kind: 'class', file: 'vendor/cordis/src/fiber.ts', symbol: 'Fiber', heading: 'The Fiber class' },
      { kind: 'decl', file: 'vendor/cordis/src/fiber.ts', symbol: 'Effect' },
      { kind: 'decl', file: 'vendor/cordis/src/fiber.ts', symbol: 'Disposable' },
      { kind: 'decl', file: 'vendor/cordis/src/fiber.ts', symbol: 'EffectMeta' },
      { kind: 'decl', file: 'vendor/cordis/src/fiber.ts', symbol: 'CordisError' },
      { kind: 'decl', file: 'vendor/cordis/src/fiber.ts', symbol: 'ValidationError' },
    ],
  },
  {
    out: 'docs/cordis-api/registry.md',
    title: 'Registry',
    intro: 'Plugin loading and dependency injection.',
    sections: [
      { kind: 'context-merge', file: 'vendor/cordis/src/registry.ts' },
      { kind: 'decl', file: 'vendor/cordis/src/registry.ts', symbol: 'Plugin' },
      { kind: 'decl', file: 'vendor/cordis/src/registry.ts', symbol: 'Inject' },
    ],
  },
  {
    out: 'docs/cordis-api/service.md',
    title: 'Service',
    intro: 'The base class for context services. A subclass loaded as a plugin registers itself as `ctx.<name>`.',
    sections: [
      { kind: 'class', file: 'vendor/cordis/src/service.ts', symbol: 'Service' },
    ],
  },
]

interface MemberDoc {
  name: string
  heading: string
  signatures: string[]
  jsDoc: string
  doc: string
  params: { name: string; text: string }[]
  returns: string | null
  source: string
}

interface RenderContext {
  scanRoot: string
  cache: Map<string, { sf: ts.SourceFile; text: string }>
  violations: string[]
}

function load(ctx: RenderContext, rel: string): { sf: ts.SourceFile; text: string } {
  const cached = ctx.cache.get(rel)
  if (cached !== undefined) return cached
  const text = readFileSync(resolve(ctx.scanRoot, rel), 'utf8')
  const entry = { sf: ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true), text }
  ctx.cache.set(rel, entry)
  return entry
}

function sourceJsDoc(text: string, sf: ts.SourceFile, node: ts.Node): string {
  const raw = rawJsDoc(text, node)
  if (raw === '') return ''
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
  const lineStart = sf.getPositionOfLineAndCharacter(line, 0)
  const indent = text.slice(lineStart, node.getStart(sf))
  return raw.split('\n')
    .map((sourceLine, index) => index > 0 && sourceLine.startsWith(indent)
      ? sourceLine.slice(indent.length)
      : sourceLine)
    .join('\n')
}

function signatureOf(member: ts.Node, sf: ts.SourceFile): string {
  const full = member.getText(sf)
  const tail = (member as { body?: ts.Node; initializer?: ts.Node }).body
    ?? (member as { initializer?: ts.Node }).initializer
  const signature = tail
    ? full.slice(0, full.length - tail.getText(sf).length).replace(/[=\s]+$/, '')
    : full
  return signature.replace(/\s*;?\s*$/, '').replace(/\s+/g, ' ').trim()
}

function headingParams(parameters: readonly ts.ParameterDeclaration[], sf: ts.SourceFile): string {
  const names = parameters
    .filter(parameter => !(ts.isIdentifier(parameter.name) && parameter.name.text === 'this'))
    .map((parameter) => {
      const rest = parameter.dotDotDotToken ? '...' : ''
      const optional = parameter.questionToken || parameter.initializer ? '?' : ''
      return `${rest}${parameter.name.getText(sf)}${optional}`
    })
  return `(${names.join(', ')})`
}

function isPublicInstance(member: ts.ClassElement): boolean {
  const modifiers = ts.getCombinedModifierFlags(member)
  if (modifiers & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected | ts.ModifierFlags.Static)) return false
  if (!member.name || ts.isComputedPropertyName(member.name) || ts.isPrivateIdentifier(member.name)) return false
  return !member.name.getText().startsWith('_')
}

function isPublicStatic(member: ts.ClassElement): boolean {
  const modifiers = ts.getCombinedModifierFlags(member)
  if (modifiers & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) return false
  if (!(modifiers & ts.ModifierFlags.Static)) return false
  if (!member.name || ts.isComputedPropertyName(member.name) || ts.isPrivateIdentifier(member.name)) return false
  return !member.name.getText().startsWith('_')
}

type Member = ts.MethodDeclaration
  | ts.MethodSignature
  | ts.PropertyDeclaration
  | ts.PropertySignature
  | ts.GetAccessorDeclaration

function memberDoc(ctx: RenderContext, where: string, name: string, group: Member[], rel: string): MemberDoc {
  const { sf, text } = load(ctx, rel)
  const first = group[0]
  if (first === undefined) throw new Error(`cordis-core-api: empty member group for ${name}.`)
  const rawDocs = group.map(member => sourceJsDoc(text, sf, member))
  const docIndex = rawDocs.findIndex(raw => parseJsDoc(raw).doc !== '')
  const raw = docIndex === -1 ? '' : (rawDocs[docIndex] ?? '')
  const doc = parseJsDoc(raw).doc
  if (doc === '') ctx.violations.push(`${where} has no JSDoc prose.`)
  const { params: tags, returns } = parseTags(raw)
  const functionMembers = group.filter((member): member is ts.MethodDeclaration | ts.MethodSignature =>
    ts.isMethodDeclaration(member) || ts.isMethodSignature(member))
  const docCarrier = functionMembers[docIndex === -1 ? 0 : docIndex]
  const params: { name: string; text: string }[] = []
  if (docCarrier !== undefined) {
    checkParams(where, 'cordis-core-api', docCarrier.parameters, tags, sf,
      parameter => ts.isIdentifier(parameter.name) && parameter.name.text === 'this', ctx.violations)
    if (docCarrier.type !== undefined) {
      checkReturns(where, docCarrier.type, returns, sf, ctx.violations)
    } else if (returns === null && ts.isMethodDeclaration(docCarrier)) {
      ctx.violations.push(`${where} has no return type annotation; document the result with @returns.`)
    }
    for (const parameter of docCarrier.parameters) {
      if (!ts.isIdentifier(parameter.name) || parameter.name.text === 'this') continue
      const text = tags.get(parameter.name.text)
      if (text !== undefined) params.push({ name: parameter.name.text, text })
    }
  }
  const headingSource = docCarrier ?? functionMembers[0]
  const signatures = ts.isMethodDeclaration(first) && functionMembers.length > 1
    ? functionMembers.filter(member => ts.isMethodDeclaration(member) && member.body === undefined)
    : group
  return {
    name,
    heading: headingSource === undefined ? '' : headingParams(headingSource.parameters, sf),
    signatures: signatures.map(member => signatureOf(member, sf)),
    jsDoc: raw,
    doc,
    params,
    returns,
    source: pointer(rel, sf, first),
  }
}

function heritageMembers(
  statement: ts.InterfaceDeclaration,
  sf: ts.SourceFile,
  groups: Map<string, (ts.MethodSignature | ts.PropertySignature | ts.MethodDeclaration)[]>,
): void {
  for (const clause of statement.heritageClauses ?? []) {
    for (const type of clause.types) {
      if (!ts.isIdentifier(type.expression) || type.expression.text !== 'Pick') continue
      const [target, keys] = type.typeArguments ?? []
      if (target === undefined || keys === undefined || !ts.isTypeReferenceNode(target)) continue
      const targetName = target.typeName.getText(sf)
      const cls = sf.statements.find(
        (entry): entry is ts.ClassDeclaration => ts.isClassDeclaration(entry) && entry.name?.text === targetName,
      )
      if (cls === undefined) continue
      const picked = new Set<string>()
      const collect = (node: ts.TypeNode): void => {
        if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) picked.add(node.literal.text)
        if (ts.isUnionTypeNode(node)) node.types.forEach(collect)
      }
      collect(keys)
      for (const member of cls.members) {
        if (!ts.isMethodDeclaration(member)) continue
        const name = member.name.getText(sf)
        if (!picked.has(name)) continue
        const group = groups.get(name) ?? []
        group.push(member)
        groups.set(name, group)
      }
    }
  }
}

function contextMergeMembers(ctx: RenderContext, rel: string): MemberDoc[] {
  const { sf } = load(ctx, rel)
  const body = cordisModuleBody(sf)
  if (body === null) throw new Error(`cordis-core-api: ${rel} has no Context module merge.`)
  const groups = new Map<string, (ts.MethodSignature | ts.PropertySignature | ts.MethodDeclaration)[]>()
  for (const statement of body.statements) {
    if (!ts.isInterfaceDeclaration(statement) || statement.name.text !== 'Context') continue
    heritageMembers(statement, sf, groups)
    for (const member of statement.members) {
      if (!ts.isMethodSignature(member) && !ts.isPropertySignature(member)) continue
      if (ts.isComputedPropertyName(member.name)) continue
      const name = member.name.getText(sf)
      const group = groups.get(name) ?? []
      group.push(member)
      groups.set(name, group)
    }
  }
  return [...groups.entries()].map(([name, group]) =>
    memberDoc(ctx, `ctx.${name} (${rel})`, name, group, rel))
}

function classMembers(ctx: RenderContext, rel: string, className: string): {
  doc: string
  instance: MemberDoc[]
  statics: MemberDoc[]
  source: string
} {
  const { sf, text } = load(ctx, rel)
  const cls = sf.statements.find(
    (statement): statement is ts.ClassDeclaration =>
      ts.isClassDeclaration(statement) && statement.name?.text === className,
  )
  if (cls === undefined) throw new Error(`cordis-core-api: class ${className} not found in ${rel}.`)
  const doc = parseJsDoc(rawJsDoc(text, cls)).doc
  if (doc === '') ctx.violations.push(`class ${className} (${pointer(rel, sf, cls)}) has no JSDoc.`)
  const instance = new Map<string, Member[]>()
  const statics = new Map<string, Member[]>()
  for (const member of cls.members) {
    if (!ts.isMethodDeclaration(member) && !ts.isPropertyDeclaration(member) && !ts.isGetAccessorDeclaration(member)) continue
    const name = member.name.getText(sf)
    if (isPublicInstance(member)) {
      const group = instance.get(name) ?? []
      group.push(member)
      instance.set(name, group)
    } else if (isPublicStatic(member) && !ts.isGetAccessorDeclaration(member)) {
      const group = statics.get(name) ?? []
      group.push(member)
      statics.set(name, group)
    }
  }
  const declaration = sf.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === className,
  )
  for (const member of declaration?.members ?? []) {
    if (!ts.isPropertySignature(member) || ts.isComputedPropertyName(member.name)) continue
    const name = member.name.getText(sf)
    const group = instance.get(name) ?? []
    group.push(member)
    instance.set(name, group)
  }
  const render = (groups: Map<string, Member[]>, prefix: string): MemberDoc[] =>
    [...groups.entries()].map(([name, group]) => memberDoc(ctx, `${prefix}${name} (${rel})`, name, group, rel))
  return {
    doc,
    instance: render(instance, `${className}#`),
    statics: render(statics, `${className}.`),
    source: pointer(rel, sf, cls),
  }
}

function stripBodies(node: ts.Node, sf: ts.SourceFile): string {
  const cuts: { start: number; end: number }[] = []
  const visit = (entry: ts.Node): void => {
    const functionLike = ts.isMethodDeclaration(entry)
      || ts.isConstructorDeclaration(entry)
      || ts.isFunctionDeclaration(entry)
      || ts.isGetAccessorDeclaration(entry)
      || ts.isSetAccessorDeclaration(entry)
    if (functionLike && entry.body !== undefined) {
      const signatureEnd = (entry.type ?? entry.parameters.at(-1) ?? entry).getEnd()
      cuts.push({ start: signatureEnd, end: entry.body.getEnd() })
      return
    }
    entry.forEachChild(visit)
  }
  visit(node)
  const base = node.getStart(sf)
  let output = node.getText(sf)
  for (const cut of cuts.sort((left, right) => right.start - left.start)) {
    const head = output.slice(0, cut.start - base)
    const between = output.slice(cut.start - base, cut.end - base)
    const bodyBrace = between.indexOf('{')
    output = head + between.slice(0, bodyBrace).trimEnd() + output.slice(cut.end - base)
  }
  return output
}

function declarationPaste(ctx: RenderContext, rel: string, symbol: string): { doc: string; code: string; source: string } {
  const { sf, text } = load(ctx, rel)
  const matches = sf.statements.filter((statement) => {
    const named = ts.isInterfaceDeclaration(statement)
      || ts.isTypeAliasDeclaration(statement)
      || ts.isClassDeclaration(statement)
      || ts.isEnumDeclaration(statement)
      || ts.isModuleDeclaration(statement)
    return named && statement.name?.getText(sf) === symbol
  })
  const first = matches[0]
  if (first === undefined) throw new Error(`cordis-core-api: declaration ${symbol} not found in ${rel}.`)
  const doc = parseJsDoc(sourceJsDoc(text, sf, first)).doc
  const code = matches.map((statement) => {
    const jsDoc = sourceJsDoc(text, sf, statement)
    const declaration = stripBodies(statement, sf).replace(/^export\s+(default\s+)?/, '')
    return jsDoc === '' ? declaration : `${jsDoc}\n${declaration}`
  }).join('\n\n')
  return { doc, code, source: pointer(rel, sf, first) }
}

function sourceLink(source: string): string {
  const [file, line] = source.split(':')
  return `[Source](../../${file}${line === undefined ? '' : `#L${line}`})`
}

function unlink(text: string): string {
  return text.replace(/\{@link\s+([^}|\s]+)\s*(?:[|\s]\s*([^}]*))?\}/g, (_match, target: string, label?: string) => {
    const name = label?.trim()
    return name && name !== '' ? name : `\`${target}\``
  })
}

function prose(doc: string): string[] {
  const paragraphs = unlink(doc)
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.replace(/\s*\n\s*/g, ' ').trim())
    .filter(paragraph => paragraph !== '')
  return paragraphs.flatMap((paragraph, index) => index === 0 ? [paragraph] : ['', paragraph])
}

function renderMember(prefix: string, member: MemberDoc): string[] {
  const lines = [`### ${prefix}${member.name}${member.heading}`, '', `\`\`\`${FENCE}`]
  if (member.jsDoc !== '') lines.push(member.jsDoc)
  lines.push(...member.signatures, '```', '')
  if (member.doc !== '') lines.push(...prose(member.doc), '')
  for (const parameter of member.params) lines.push(`- \`${parameter.name}\` — ${unlink(parameter.text)}`)
  if (member.params.length > 0) lines.push('')
  if (member.returns !== null && member.returns !== '') lines.push(`**Returns** ${unlink(member.returns)}`, '')
  lines.push(sourceLink(member.source), '')
  return lines
}

/** Render one detailed Cordis core API page and reject undocumented members. */
export function renderCordisCoreApiPage(
  page: CordisCoreApiPage,
  scanRoot: string = root,
): string {
  const ctx: RenderContext = { scanRoot, cache: new Map(), violations: [] }
  const lines = [
    '<!-- Generated by scripts/gen-cordis-catalog.ts — do not edit by hand.',
    '     Run `pnpm run gen-cordis-catalog` to regenerate. -->',
    '',
    `# ${page.title}`,
    '',
    page.intro,
    '',
  ]
  for (const section of page.sections) {
    if (section.kind !== 'decl' && section.heading !== undefined) lines.push(`## ${section.heading}`, '')
    if (section.kind === 'context-merge') {
      for (const member of contextMergeMembers(ctx, section.file)) lines.push(...renderMember('ctx.', member))
    } else if (section.kind === 'class') {
      const cls = classMembers(ctx, section.file, section.symbol)
      if (cls.doc !== '') lines.push(...prose(cls.doc), '')
      lines.push(sourceLink(cls.source), '')
      const prefix = section.prefix ?? `${section.symbol.toLowerCase()}.`
      for (const member of cls.instance) lines.push(...renderMember(prefix, member))
      if (cls.statics.length > 0) {
        lines.push('## Static members', '')
        for (const member of cls.statics) lines.push(...renderMember(`${section.symbol}.`, member))
      }
    } else {
      const declaration = declarationPaste(ctx, section.file, section.symbol)
      lines.push(`## ${section.symbol}`, '')
      if (declaration.doc !== '') lines.push(...prose(declaration.doc), '')
      lines.push(`\`\`\`${FENCE}`, declaration.code, '```', '', sourceLink(declaration.source), '')
    }
  }
  reportViolations('gen-cordis-catalog', ctx.violations)
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`
}

/** Render every detailed Cordis core API page. */
export function renderCordisCoreApiPages(scanRoot: string = root): Map<string, string> {
  return new Map(CORDIS_CORE_API_PAGES.map(page => [page.out, renderCordisCoreApiPage(page, scanRoot)]))
}
