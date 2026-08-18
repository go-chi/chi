/**
 * Rendering and traversal over the compiler-independent TypeGraph. Emitters
 * use this module instead of reaching back into TypeScript AST nodes.
 * @module @deepseek-ai/dsh-typert-generator/renderer
 */

import { childTypeNodeIds } from './model.ts'
import type {
  MemberModel,
  ParameterModel,
  SignatureModel,
  SymbolId,
  TypeDeclarationModel,
  TypeGraph,
  TypeNodeId,
  TypeNodeModel,
  TypeParameterModel,
} from './model.ts'

/** Failure to render or traverse an internally inconsistent TypeGraph. */
export class TypeGraphRenderError extends Error {
  override name = 'TypeGraphRenderError'
}

/** Read and render one TypeGraph without compiler objects. */
export class TypeGraphRenderer {
  private readonly nodes: ReadonlyMap<TypeNodeId, TypeNodeModel>
  private readonly declarations: ReadonlyMap<SymbolId, TypeDeclarationModel>
  private readonly members: ReadonlyMap<string, MemberModel>
  private readonly parameterNames = new Map<string, string>()

  /**
   * Index one complete graph.
   * @param graph - compiler-independent graph to render.
   */
  constructor(readonly graph: TypeGraph) {
    this.nodes = new Map(graph.nodes.map(node => [node.id, node]))
    this.declarations = new Map(graph.declarations.map(declaration => [declaration.id, declaration]))
    this.members = new Map(graph.declarations.flatMap(declaration => declaration.members.map(member => [member.id, member] as const)))
    for (const declaration of graph.declarations) {
      this.indexParameters(declaration.typeParameters)
      for (const member of declaration.members) {
        if ('signature' in member) this.indexParameters(member.signature.typeParameters)
      }
    }
  }

  /**
   * Resolve a node id or fail with the broken edge.
   * @param id - graph-local type node id.
   * @returns the referenced node.
   */
  node(id: TypeNodeId): TypeNodeModel {
    const node = this.nodes.get(id)
    if (node === undefined) throw new TypeGraphRenderError(`type graph references missing node ${id}`)
    return node
  }

  /**
   * Resolve a declaration id or fail with the broken edge.
   * @param id - workspace symbol id.
   * @returns the referenced declaration.
   */
  declaration(id: SymbolId): TypeDeclarationModel {
    const declaration = this.declarations.get(id)
    if (declaration === undefined) throw new TypeGraphRenderError(`type graph references missing declaration ${id}`)
    return declaration
  }

  /**
   * Resolve a public member id.
   * @param id - declaration member id.
   * @returns the referenced member.
   */
  member(id: string): MemberModel {
    const member = this.members.get(id)
    if (member === undefined) throw new TypeGraphRenderError(`type graph references missing member ${id}`)
    return member
  }

  /**
   * Render one type expression from the retained source structure.
   * @param id - type node id.
   * @param references - optional generated names for declaration references.
   * @returns TypeScript type text.
   */
  renderType(id: TypeNodeId, references?: ReadonlyMap<SymbolId, string>): string {
    const node = this.node(id)
    switch (node.kind) {
      case 'keyword': return node.name
      case 'literal': return node.text
      case 'parenthesized': return `(${this.renderType(node.type, references)})`
      case 'reference': {
        const name = node.target.kind === 'type-parameter'
          ? this.parameterNames.get(node.target.parameter) ?? node.name
          : node.target.kind === 'declaration'
            ? references?.get(node.target.symbol) ?? node.name
            : node.name
        return node.arguments.length === 0
          ? name
          : `${name}<${node.arguments.map(argument => this.renderType(argument, references)).join(', ')}>`
      }
      case 'union': return node.types.map(type => this.renderType(type, references)).join(' | ')
      case 'intersection': return node.types.map(type => this.renderType(type, references)).join(' & ')
      case 'array': {
        const element = this.renderType(node.element, references)
        const wrapped = needsArrayParentheses(this.node(node.element)) ? `(${element})` : element
        return `${wrapped}[]`
      }
      case 'tuple': {
        const elements = node.elements.map((element) => {
          const type = this.renderType(element.type, references)
          if (element.name !== undefined) {
            return `${element.rest ? '...' : ''}${element.name}${element.optional ? '?' : ''}: ${type}`
          }
          return `${element.rest ? '...' : ''}${type}${element.optional ? '?' : ''}`
        })
        return `[${elements.join(', ')}]`
      }
      case 'object': return this.renderObject(node.members, references)
      case 'function': return `${this.renderSignatureHead(node.signature, references)} => ${this.renderType(node.signature.returns, references)}`
      case 'constructor': return `${node.abstract ? 'abstract ' : ''}new ${this.renderSignatureHead(node.signature, references)} => ${this.renderType(node.signature.returns, references)}`
      case 'indexed-access': return `${this.renderType(node.object, references)}[${this.renderType(node.index, references)}]`
      case 'operator': return `${node.operator} ${this.renderType(node.type, references)}`
      case 'conditional': {
        return `${this.renderType(node.check, references)} extends ${this.renderType(node.extends, references)} ? ${this.renderType(node.whenTrue, references)} : ${this.renderType(node.whenFalse, references)}`
      }
      case 'infer': return `infer ${this.renderTypeParameter(node.parameter, false, references)}`
      case 'mapped': {
        const readonly = node.readonly === 'preserve' ? '' : node.readonly === 'remove' ? '-readonly ' : 'readonly '
        const optional = node.optional === 'preserve' ? '' : node.optional === 'remove' ? '-?' : '?'
        if (node.parameter.constraint === undefined) {
          throw new TypeGraphRenderError(`mapped type parameter ${node.parameter.name} has no constraint`)
        }
        const parameter = `${node.parameter.name} in ${this.renderType(node.parameter.constraint, references)}`
        const nameType = node.nameType === undefined ? '' : ` as ${this.renderType(node.nameType, references)}`
        const value = node.value === undefined ? 'unknown' : this.renderType(node.value, references)
        return `{ ${readonly}[${parameter}${nameType}]${optional}: ${value} }`
      }
      case 'template-literal': {
        const spans = node.spans.map(span => `\${${this.renderType(span.type, references)}}${escapeTemplate(span.text)}`).join('')
        return `\`${escapeTemplate(node.head)}${spans}\``
      }
      case 'type-query': {
        const argumentsText = node.arguments.length === 0
          ? ''
          : `<${node.arguments.map(argument => this.renderType(argument, references)).join(', ')}>`
        return `typeof ${node.expression}${argumentsText}`
      }
      case 'import-type': {
        const attributes = node.attributes === undefined ? '' : `, ${node.attributes}`
        const imported = `import(${quote(node.module)}${attributes})${node.qualifier === undefined ? '' : `.${node.qualifier}`}`
        const argumentsText = node.arguments.length === 0
          ? ''
          : `<${node.arguments.map(argument => this.renderType(argument, references)).join(', ')}>`
        return `${node.typeof ? 'typeof ' : ''}${imported}${argumentsText}`
      }
      case 'predicate': {
        const assertion = node.asserts ? 'asserts ' : ''
        return node.type === undefined
          ? `${assertion}${node.parameter}`
          : `${assertion}${node.parameter} is ${this.renderType(node.type, references)}`
      }
      case 'this': return 'this'
      default: return assertNever(node)
    }
  }

  /**
   * Render a callable signature without a member name.
   * @param signature - modeled signature.
   * @param references - optional generated names for declaration references.
   * @returns parameter list and return type.
   */
  renderSignature(signature: SignatureModel, references?: ReadonlyMap<SymbolId, string>): string {
    return `${this.renderSignatureHead(signature, references)}: ${this.renderType(signature.returns, references)}`
  }

  /**
   * Render one class/interface member as a body-free declaration.
   * @param member - modeled member.
   * @param sourceModifiers - retain source-only modifiers for reflection text.
   * @param references - optional generated names for declaration references.
   * @returns one-line TypeScript member text.
   */
  renderMember(member: MemberModel, sourceModifiers = false, references?: ReadonlyMap<SymbolId, string>): string {
    if (sourceModifiers) return member.text
    const name = renderPropertyName(member.name)
    const optional = member.optional ? '?' : ''
    const readonly = member.readonly ? 'readonly ' : ''
    const abstract = member.abstract ? 'abstract ' : ''
    switch (member.kind) {
      case 'property': return `${abstract}${readonly}${name}${optional}: ${this.renderType(member.type, references)}`
      case 'method': return `${abstract}${name}${optional}${this.renderSignature(member.signature, references)}`
      case 'getter': return `${abstract}get ${name}()${this.renderReturn(member.signature, references)}`
      case 'setter': return `${abstract}set ${name}${this.renderSignatureHead(member.signature, references)}`
      case 'call': return this.renderSignature(member.signature, references)
      case 'construct': return `new ${this.renderSignature(member.signature, references)}`
      case 'index': {
        const parameters = member.signature.parameters.map(parameter => this.renderParameter(parameter, references)).join(', ')
        return `${readonly}[${parameters}]: ${this.renderType(member.signature.returns, references)}`
      }
      default: return assertNever(member)
    }
  }

  /**
   * Render a named declaration without JSDoc.
   * @param id - declaration symbol id.
   * @returns exported TypeScript declaration text.
   */
  renderDeclaration(id: SymbolId): string {
    const declaration = this.declaration(id)
    const parameters = this.renderTypeParameters(declaration.typeParameters)
    if (declaration.kind === 'enum') {
      const members = declaration.enumMembers?.map(member =>
        `    ${renderPropertyName(member.name)}${member.initializer === undefined ? '' : ` = ${member.initializer}`},`) ?? []
      return [`export enum ${declaration.name} {`, ...members, '}'].join('\n')
    }
    if (declaration.kind === 'alias') {
      if (declaration.type === undefined) throw new TypeGraphRenderError(`alias ${id} has no type node`)
      return `export type ${declaration.name}${parameters} = ${this.renderType(declaration.type)};`
    }
    const extendsTypes = declaration.extends.map(type => this.renderType(type))
    const implementsTypes = declaration.implements.map(type => this.renderType(type))
    const heritage = [
      extendsTypes.length === 0 ? '' : ` extends ${extendsTypes.join(', ')}`,
      implementsTypes.length === 0 ? '' : ` implements ${implementsTypes.join(', ')}`,
    ].join('')
    const prefix = declaration.kind === 'class' && declaration.abstract ? 'abstract ' : ''
    const members = declaration.members.map(member => `    ${this.renderMember(member)};`)
    return [`export ${prefix}${declaration.kind} ${declaration.name}${parameters}${heritage} {`, ...members, '}'].join('\n')
  }

  /**
   * Find the transitive declaration closure referenced by members.
   * @param memberIds - business-API member ids.
   * @returns declarations in graph order, excluding no roots implicitly.
   */
  declarationClosureForMembers(memberIds: readonly string[]): TypeDeclarationModel[] {
    return this.declarationClosure(memberIds, [])
  }

  /**
   * Find the transitive declaration closure referenced by type roots.
   * @param typeIds - graph type roots.
   * @returns declarations in graph order.
   */
  declarationClosureForTypes(typeIds: readonly TypeNodeId[]): TypeDeclarationModel[] {
    return this.declarationClosure([], typeIds)
  }

  private declarationClosure(
    memberIds: readonly string[],
    typeIds: readonly TypeNodeId[],
  ): TypeDeclarationModel[] {
    const found = new Set<SymbolId>()
    const visiting = new Set<SymbolId>()
    const visitNode = (id: TypeNodeId): void => {
      const node = this.node(id)
      if (node.kind === 'reference' && node.target.kind === 'declaration') visitDeclaration(node.target.symbol)
      if (node.kind === 'import-type' && node.target?.kind === 'declaration') visitDeclaration(node.target.symbol)
      for (const child of childTypeNodeIds(node)) visitNode(child)
      for (const signature of nodeSignatures(node)) visitSignature(signature)
      if (node.kind === 'object') for (const member of node.members) visitMember(member)
    }
    const visitSignature = (signature: SignatureModel): void => {
      for (const parameter of signature.typeParameters) {
        if (parameter.constraint !== undefined) visitNode(parameter.constraint)
        if (parameter.default !== undefined) visitNode(parameter.default)
      }
      for (const parameter of signature.parameters) visitNode(parameter.type)
      visitNode(signature.returns)
    }
    const visitMember = (member: MemberModel): void => {
      if (member.kind === 'property') visitNode(member.type)
      else visitSignature(member.signature)
    }
    const visitDeclaration = (id: SymbolId): void => {
      if (found.has(id) || visiting.has(id)) return
      visiting.add(id)
      const declaration = this.declaration(id)
      for (const parameter of declaration.typeParameters) {
        if (parameter.constraint !== undefined) visitNode(parameter.constraint)
        if (parameter.default !== undefined) visitNode(parameter.default)
      }
      for (const type of [...declaration.extends, ...declaration.implements]) visitNode(type)
      if (declaration.type !== undefined) visitNode(declaration.type)
      for (const member of declaration.members) visitMember(member)
      visiting.delete(id)
      found.add(id)
    }
    for (const id of memberIds) visitMember(this.member(id))
    for (const id of typeIds) visitNode(id)
    return this.graph.declarations.filter(declaration => found.has(declaration.id))
  }

  private renderSignatureHead(signature: SignatureModel, references?: ReadonlyMap<SymbolId, string>): string {
    return `${this.renderTypeParameters(signature.typeParameters, references)}(${signature.parameters.map(parameter => this.renderParameter(parameter, references)).join(', ')})`
  }

  private renderReturn(signature: SignatureModel, references?: ReadonlyMap<SymbolId, string>): string {
    return `: ${this.renderType(signature.returns, references)}`
  }

  private renderParameter(parameter: ParameterModel, references?: ReadonlyMap<SymbolId, string>): string {
    const name = parameter.binding === 'identifier' ? renderPropertyName(parameter.name) : parameter.name
    const optional = parameter.initializer === undefined && parameter.optional && !parameter.rest ? '?' : ''
    const initializer = parameter.initializer === undefined ? '' : ` = ${parameter.initializer}`
    return `${parameter.rest ? '...' : ''}${name}${optional}: ${this.renderType(parameter.type, references)}${initializer}`
  }

  private renderTypeParameters(parameters: readonly TypeParameterModel[], references?: ReadonlyMap<SymbolId, string>): string {
    return parameters.length === 0
      ? ''
      : `<${parameters.map(parameter => this.renderTypeParameter(parameter, true, references)).join(', ')}>`
  }

  private renderTypeParameter(
    parameter: TypeParameterModel,
    includeDefault: boolean,
    references?: ReadonlyMap<SymbolId, string>,
  ): string {
    const variance = parameter.variance === undefined ? '' : `${parameter.variance === 'in-out' ? 'in out' : parameter.variance} `
    const constModifier = parameter.const ? 'const ' : ''
    const constraint = parameter.constraint === undefined ? '' : ` extends ${this.renderType(parameter.constraint, references)}`
    const fallback = !includeDefault || parameter.default === undefined ? '' : ` = ${this.renderType(parameter.default, references)}`
    return `${constModifier}${variance}${parameter.name}${constraint}${fallback}`
  }

  private renderObject(members: readonly MemberModel[], references?: ReadonlyMap<SymbolId, string>): string {
    if (members.length === 0) return '{}'
    return `{ ${members.map(member => `${this.renderMember(member, false, references)};`).join(' ')} }`
  }

  private indexParameters(parameters: readonly TypeParameterModel[]): void {
    for (const parameter of parameters) this.parameterNames.set(parameter.id, parameter.name)
  }
}

function nodeSignatures(node: TypeNodeModel): SignatureModel[] {
  return node.kind === 'function' || node.kind === 'constructor' ? [node.signature] : []
}

function needsArrayParentheses(node: TypeNodeModel): boolean {
  return node.kind === 'union' || node.kind === 'intersection' || node.kind === 'function' || node.kind === 'constructor' || node.kind === 'conditional'
}

function renderPropertyName(name: string): string {
  if (name.startsWith('[') && name.endsWith(']')) return name
  if (/^(?:[$A-Z_a-z][$\w]*|\d+)$/u.test(name)) return name
  return quote(name)
}

function quote(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\n', '\\n')}'`
}

function escapeTemplate(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${')
}

function assertNever(value: never): never {
  throw new TypeGraphRenderError(`unsupported model variant ${JSON.stringify(value)}`)
}
