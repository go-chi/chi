import { describe, expect, it } from 'vitest'
import type {
  KeywordTypeName,
  MemberModel,
  TypeDeclarationModel,
  TypeGraph,
  TypeNodeModel,
} from '../src/model.ts'
import { childTypeNodeIds } from '../src/model.ts'
import { TypeGraphRenderError, TypeGraphRenderer } from '../src/renderer.ts'

const location = { file: 'fixture.ts', line: 1, column: 1 } as const
const documentation = { tags: [] } as const

describe('TypeGraphRenderer defensive and optional shapes', () => {
  it('enumerates direct child edges for every type node kind', () => {
    const signature = { typeParameters: [], parameters: [], returns: 'leaf' } as const
    const cases: readonly (readonly [TypeNodeModel, readonly string[]])[] = [
      [keyword('keyword', 'string'), []],
      [{ id: 'literal', kind: 'literal', value: 1, text: '1' }, []],
      [{ id: 'parenthesized', kind: 'parenthesized', type: 'leaf' }, ['leaf']],
      [{ id: 'reference', kind: 'reference', name: 'Ref', target: { kind: 'standard', name: 'Ref' }, arguments: ['left', 'right'] }, ['left', 'right']],
      [{ id: 'union', kind: 'union', types: ['left', 'right'] }, ['left', 'right']],
      [{ id: 'intersection', kind: 'intersection', types: ['left', 'right'] }, ['left', 'right']],
      [{ id: 'array', kind: 'array', element: 'leaf' }, ['leaf']],
      [{ id: 'tuple', kind: 'tuple', elements: [{ type: 'leaf', optional: false, rest: false }] }, ['leaf']],
      [{ id: 'object', kind: 'object', members: [] }, []],
      [{ id: 'function', kind: 'function', signature }, []],
      [{ id: 'constructor', kind: 'constructor', abstract: false, signature }, []],
      [{ id: 'indexed', kind: 'indexed-access', object: 'left', index: 'right' }, ['left', 'right']],
      [{ id: 'operator', kind: 'operator', operator: 'keyof', type: 'leaf' }, ['leaf']],
      [{ id: 'conditional', kind: 'conditional', check: 'check', extends: 'extends', whenTrue: 'yes', whenFalse: 'no' }, ['check', 'extends', 'yes', 'no']],
      [{ id: 'infer-full', kind: 'infer', parameter: { id: 'infer', name: 'Value', const: false, constraint: 'constraint', default: 'fallback' } }, ['constraint', 'fallback']],
      [{ id: 'infer-empty', kind: 'infer', parameter: { id: 'infer', name: 'Value', const: false } }, []],
      [{ id: 'mapped-full', kind: 'mapped', parameter: { id: 'key', name: 'Key', const: false, constraint: 'constraint', default: 'fallback' }, nameType: 'name', value: 'value', readonly: 'preserve', optional: 'preserve' }, ['constraint', 'fallback', 'name', 'value']],
      [{ id: 'mapped-empty', kind: 'mapped', parameter: { id: 'key', name: 'Key', const: false }, readonly: 'preserve', optional: 'preserve' }, []],
      [{ id: 'template', kind: 'template-literal', head: '', spans: [{ type: 'leaf', text: '' }] }, ['leaf']],
      [{ id: 'query', kind: 'type-query', expression: 'value', arguments: ['leaf'] }, ['leaf']],
      [{ id: 'import', kind: 'import-type', module: 'fixture', arguments: ['leaf'], typeof: false }, ['leaf']],
      [{ id: 'predicate-full', kind: 'predicate', asserts: false, parameter: 'value', type: 'leaf' }, ['leaf']],
      [{ id: 'predicate-empty', kind: 'predicate', asserts: true, parameter: 'value' }, []],
      [{ id: 'this', kind: 'this' }, []],
    ]

    for (const [node, expected] of cases) expect(childTypeNodeIds(node)).toEqual(expected)
  })

  it('renders optional source shapes and traverses every optional closure edge', () => {
    const dependency = declaration('dependency', 'Dependency', 'interface')
    const graph: TypeGraph = {
      declarations: [
        dependency,
        declaration('empty-enum', 'EmptyEnum', 'enum'),
        declaration('root', 'Root', 'interface', {
          members: [property('root-member', 'rootValue', 'imported')],
        }),
      ],
      nodes: [
        keyword('string', 'string'),
        { id: 'union', kind: 'union', types: ['string', 'string'] },
        { id: 'array', kind: 'array', element: 'union' },
        {
          id: 'tuple',
          kind: 'tuple',
          elements: [
            { type: 'string', optional: false, rest: false },
            { type: 'string', optional: true, rest: false },
            { type: 'array-of-string', optional: false, rest: true },
          ],
        },
        { id: 'array-of-string', kind: 'array', element: 'string' },
        {
          id: 'mapped',
          kind: 'mapped',
          parameter: {
            id: 'key',
            name: 'Key',
            const: false,
            constraint: 'string',
            default: 'string',
          },
          readonly: 'preserve',
          optional: 'preserve',
        },
        {
          id: 'infer',
          kind: 'infer',
          parameter: {
            id: 'inferred',
            name: 'Value',
            const: false,
            constraint: 'string',
            default: 'string',
          },
        },
        {
          id: 'imported',
          kind: 'import-type',
          module: '@fixture/dependency',
          qualifier: 'Dependency',
          arguments: ['mapped', 'infer'],
          typeof: false,
          target: { kind: 'declaration', symbol: 'dependency' },
        },
        { id: 'empty-object', kind: 'object', members: [] },
      ],
    }
    const renderer = new TypeGraphRenderer(graph)

    expect(renderer.renderType('array')).toBe('(string | string)[]')
    expect(renderer.renderType('tuple')).toBe('[string, string?, ...string[]]')
    expect(renderer.renderType('mapped')).toBe('{ [Key in string]: unknown }')
    expect(renderer.renderType('empty-object')).toBe('{}')
    expect(renderer.renderDeclaration('empty-enum')).toBe('export enum EmptyEnum {\n}')
    expect(renderer.declarationClosureForMembers(['root-member']).map(item => item.name))
      .toEqual(['Dependency'])
  })

  it('fails loudly for every broken graph edge and impossible discriminant', () => {
    const missingConstraint: TypeNodeModel = {
      id: 'mapped',
      kind: 'mapped',
      parameter: { id: 'key', name: 'Key', const: false },
      readonly: 'preserve',
      optional: 'preserve',
    }
    const alias = declaration('alias', 'Alias', 'alias')
    const renderer = new TypeGraphRenderer({
      declarations: [alias],
      nodes: [missingConstraint],
    })

    expect(() => renderer.node('missing')).toThrow(TypeGraphRenderError)
    expect(() => renderer.declaration('missing')).toThrow('missing declaration')
    expect(() => renderer.member('missing')).toThrow('missing member')
    expect(renderer.declarationClosureForTypes(['mapped'])).toEqual([])
    expect(() => renderer.renderType('mapped')).toThrow('has no constraint')
    expect(() => renderer.renderDeclaration('alias')).toThrow('has no type node')

    const invalidNode = { id: 'invalid', kind: 'future-node' } as unknown as TypeNodeModel
    const invalidMember = {
      ...property('invalid-member', 'value', 'mapped'),
      kind: 'future-member',
    } as unknown as MemberModel
    const invalidRenderer = new TypeGraphRenderer({
      declarations: [declaration('invalid-root', 'InvalidRoot', 'interface', { members: [invalidMember] })],
      nodes: [invalidNode],
    })
    expect(() => invalidRenderer.renderType('invalid')).toThrow('unsupported model variant')
    expect(() => invalidRenderer.renderMember(invalidMember)).toThrow('unsupported model variant')
    expect(() => invalidRenderer.declarationClosureForTypes(['invalid'])).toThrow('unsupported model variant')
  })
})

function keyword(id: string, name: KeywordTypeName): TypeNodeModel {
  return { id, kind: 'keyword', name }
}

function property(id: string, name: string, type: string): MemberModel {
  return {
    ...documentation,
    id,
    kind: 'property',
    name,
    type,
    optional: false,
    readonly: false,
    async: false,
    abstract: false,
    static: false,
    visibility: 'public',
    location,
    text: `${name}: unknown`,
  }
}

function declaration(
  id: string,
  name: string,
  kind: TypeDeclarationModel['kind'],
  options: { readonly members?: readonly MemberModel[] } = {},
): TypeDeclarationModel {
  return {
    ...documentation,
    id,
    package: '@fixture/renderer',
    name,
    kind,
    abstract: false,
    exported: true,
    location,
    text: `export ${kind === 'alias' ? 'type' : kind} ${name}`,
    typeParameters: [],
    extends: [],
    implements: [],
    members: options.members ?? [],
  }
}
