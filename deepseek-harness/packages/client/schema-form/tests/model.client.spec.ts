import { describe, expect, it } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import {
  deletePath, getPath, hasPath, nodeAtPath, rehydrateSchema, setPath, validateDraft,
} from '../src/model.ts'

const Wire = (schema: Schema): unknown => JSON.parse(JSON.stringify(schema.toJSON()))

describe('rehydration and validation', () => {
  it('rehydrates a serialized envelope into a working validator', () => {
    const root = rehydrateSchema(Wire(Schema.object({ name: Schema.string().required() })))
    expect(validateDraft(root, { name: 'ok' })).toBeUndefined()
    expect(validateDraft(root, { name: 42 })).toContain('name')
  })

  it('stringifies non-Error validation throws', () => {
    const hostile = (() => {
      throw 'plain-string failure'
    }) as unknown as Parameters<typeof validateDraft>[0]
    expect(validateDraft(hostile, {})).toBe('plain-string failure')
  })
})

describe('path helpers', () => {
  const root = { providers: { openai: { baseURL: 'https://x' } }, models: [{ id: 'a' }] }

  it('reads nested object and array paths', () => {
    expect(getPath(root, [])).toBe(root)
    expect(getPath(root, ['providers', 'openai', 'baseURL'])).toBe('https://x')
    expect(getPath(root, ['models', '0', 'id'])).toBe('a')
    expect(getPath(root, ['providers', 'missing', 'x'])).toBeUndefined()
    expect(getPath(root, ['providers', 'openai', 'baseURL', 'deep'])).toBeUndefined()
  })

  it('reports draft presence by key existence, not value truthiness', () => {
    expect(hasPath({ flag: false }, ['flag'])).toBe(true)
    expect(hasPath({ nested: { key: undefined } }, ['nested', 'key'])).toBe(true)
    expect(hasPath({}, ['missing'])).toBe(false)
    expect(hasPath({ leaf: 'x' }, ['leaf', 'deeper'])).toBe(false)
    expect(hasPath({ models: ['a'] }, ['models', '0'])).toBe(true)
    expect(hasPath({ models: ['a'] }, ['models', '1'])).toBe(false)
    expect(hasPath({ root: true }, [])).toBe(true)
    expect(hasPath(undefined, [])).toBe(false)
  })

  it('sets nested paths immutably, materializing containers by key shape', () => {
    const draft = {}
    const next = setPath(draft, ['providers', 'openai', 'baseURL'], 'https://y')
    expect(draft).toEqual({})
    expect(next).toEqual({ providers: { openai: { baseURL: 'https://y' } } })
    const withArray = setPath(next, ['models', '0'], { id: 'a' })
    expect(withArray).toEqual({ providers: { openai: { baseURL: 'https://y' } }, models: [{ id: 'a' }] })
    const replaced = setPath(withArray, ['models', '0', 'id'], 'b')
    expect(replaced.models).toEqual([{ id: 'b' }])
    expect((withArray as { models: unknown[] }).models).toEqual([{ id: 'a' }])
    expect(() => setPath({}, [], 'x')).toThrow(/non-empty path/)
  })

  it('deletes nested paths immutably and splices array indexes', () => {
    const draft = { providers: { openai: { baseURL: 'https://x', apiKey: 'k' } }, models: ['a', 'b'] }
    const withoutKey = deletePath(draft, ['providers', 'openai', 'apiKey'])
    expect(withoutKey).toEqual({ providers: { openai: { baseURL: 'https://x' } }, models: ['a', 'b'] })
    expect(draft.providers.openai.apiKey).toBe('k')
    const withoutModel = deletePath(withoutKey, ['models', '0'])
    expect(withoutModel.models).toEqual(['b'])
    expect(deletePath(draft, ['providers', 'missing', 'x'])).toBe(draft)
    expect(() => deletePath({}, [])).toThrow(/non-empty path/)
  })

  it('deletes keys through array intermediates immutably', () => {
    const draft = { models: [{ id: 'a', contextWindow: 1 }] }
    const next = deletePath(draft, ['models', '0', 'contextWindow'])
    expect(next).toEqual({ models: [{ id: 'a' }] })
    expect(draft.models[0]).toEqual({ id: 'a', contextWindow: 1 })
  })
})

describe('nodeAtPath', () => {
  const Root = Schema.object({
    providers: Schema.dict(Schema.object({ baseURL: Schema.string() })),
    models: Schema.array(Schema.object({ id: Schema.string() })),
    leaf: Schema.string(),
  })

  it('resolves object, dict, and array positions', () => {
    const root = rehydrateSchema(Wire(Root))
    expect(nodeAtPath(root, [])).toBe(root)
    expect(nodeAtPath(root, ['providers', 'openai'])?.type).toBe('object')
    expect(nodeAtPath(root, ['providers', 'openai', 'baseURL'])?.type).toBe('string')
    expect(nodeAtPath(root, ['models', '0', 'id'])?.type).toBe('string')
    expect(nodeAtPath(root, ['missing'])).toBeUndefined()
    expect(nodeAtPath(root, ['missing', 'deeper'])).toBeUndefined()
    expect(nodeAtPath(root, ['leaf', 'below'])).toBeUndefined()
  })

  it('tolerates structural nodes missing their relation maps', () => {
    expect(nodeAtPath({ type: 'object' } as never, ['x'])).toBeUndefined()
    expect(nodeAtPath({ type: 'dict' } as never, ['x'])).toBeUndefined()
  })
})
