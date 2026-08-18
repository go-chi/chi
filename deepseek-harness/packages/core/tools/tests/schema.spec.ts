import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  JsonSchemaError,
  parameterSchemaSpecToJsonSchema,
  valueSchemaSpecToJsonSchema,
  type InferArgs,
  type InferValue,
  type JsonValue,
  type ParameterSchemaSpec,
  type ValueSchemaSpec,
} from '../src/index.ts'

describe('the unified author schema DSL', () => {
  it('compiles every value root and the author-only json node', () => {
    expect(valueSchemaSpecToJsonSchema({ type: 'string', enum: ['a', 'b'], const: 'a' }))
      .toEqual({ type: 'string', enum: ['a', 'b'], const: 'a' })
    expect(valueSchemaSpecToJsonSchema({ type: 'number' })).toEqual({ type: 'number' })
    expect(valueSchemaSpecToJsonSchema({ type: 'integer' })).toEqual({ type: 'integer' })
    expect(valueSchemaSpecToJsonSchema({ type: 'boolean' })).toEqual({ type: 'boolean' })
    expect(valueSchemaSpecToJsonSchema({ type: 'null' })).toEqual({ type: 'null' })
    expect(valueSchemaSpecToJsonSchema({ type: 'array', items: { type: 'json' } }))
      .toEqual({ type: 'array', items: {} })
    expect(valueSchemaSpecToJsonSchema({ type: 'object', additionalProperties: false, properties: {} }))
      .toEqual({ type: 'object', additionalProperties: false, properties: {} })
    expect(valueSchemaSpecToJsonSchema({
      type: 'json',
      description: 'anything',
      title: 'Any JSON',
      default: null,
      examples: [{ nested: true }],
    })).toEqual({ description: 'anything', title: 'Any JSON', default: null, examples: [{ nested: true }] })
    expect(valueSchemaSpecToJsonSchema({ oneOf: [{ type: 'string' }, { type: 'null' }] }))
      .toEqual({ oneOf: [{ type: 'string' }, { type: 'null' }] })
  })

  it('keeps the implicit parameter root open while preserving explicit object openness', () => {
    expect(parameterSchemaSpecToJsonSchema({
      closed: {
        type: 'object',
        additionalProperties: false,
        required: true,
        properties: { id: { type: 'integer', required: true } },
      },
      open: { type: 'object', additionalProperties: true },
    })).toEqual({
      type: 'object',
      properties: {
        closed: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'integer' } },
          required: ['id'],
        },
        open: { type: 'object', additionalProperties: true },
      },
      required: ['closed'],
    })
  })

  it('rejects runtime-forged author forms rather than compiling them lossily', () => {
    for (const schema of [
      { type: 'object' },
      { oneOf: [{ type: 'string' }] },
      { type: 'number', enum: ['1'] },
      { type: 'string', enum: ['a'], const: 'b' },
      { type: 'integer', const: 1.5 },
      { type: 'json', default: undefined },
      { type: 'array', items: { type: 'string', required: true } },
      { type: 'array', items: 42 },
      { type: 'string', extra: true },
      { type: 'string', oneOf: [{ type: 'string' }, { type: 'null' }] },
      { oneOf: 'not-an-array' },
      { type: 'string', enum: 'a' },
      {},
      null,
    ]) {
      expect(() => valueSchemaSpecToJsonSchema(schema as ValueSchemaSpec), JSON.stringify(schema)).toThrow(JsonSchemaError)
    }
    expect(() => parameterSchemaSpecToJsonSchema({
      value: { type: 'string', required: false },
    } as unknown as ParameterSchemaSpec)).toThrow(JsonSchemaError)
    expect(() => parameterSchemaSpecToJsonSchema(null as unknown as ParameterSchemaSpec)).toThrow(JsonSchemaError)
    expect(() => parameterSchemaSpecToJsonSchema({ bad: 42 } as unknown as ParameterSchemaSpec)).toThrow(JsonSchemaError)

    const symbolKey = Symbol('hidden')
    expect(() => parameterSchemaSpecToJsonSchema({
      value: { type: 'string' },
      [symbolKey]: { type: 'number' },
    } as unknown as ParameterSchemaSpec)).toThrow(JsonSchemaError)
    const hiddenKey = Object.defineProperty({ value: { type: 'string' } }, 'hidden', {
      value: { type: 'number' },
    })
    expect(() => parameterSchemaSpecToJsonSchema(hiddenKey as ParameterSchemaSpec)).toThrow(JsonSchemaError)
    const sparseOneOf = new Array<ValueSchemaSpec>(2)
    sparseOneOf[0] = { type: 'string' }
    expect(() => valueSchemaSpecToJsonSchema({ oneOf: sparseOneOf } as unknown as ValueSchemaSpec)).toThrow(JsonSchemaError)
    const decoratedEnum = Object.assign(['a'], { hidden: true })
    expect(() => valueSchemaSpecToJsonSchema({
      type: 'string',
      enum: decoratedEnum,
    })).toThrow(JsonSchemaError)
  })

  it('rejects cyclic author schemas', () => {
    const schema: Record<string, unknown> = { type: 'array' }
    schema.items = schema
    expect(() => valueSchemaSpecToJsonSchema(schema as unknown as ValueSchemaSpec)).toThrow(/circular/)

    const properties: Record<string, unknown> = {}
    properties.self = { type: 'object', additionalProperties: true, properties }
    expect(() => parameterSchemaSpecToJsonSchema(properties as ParameterSchemaSpec)).toThrow(/circular/)
  })

  it('compiles deeply nested author unions without using the JavaScript call stack', () => {
    const depth = 5_000
    let spec: unknown = { type: 'string' }
    for (let index = 0; index < depth; index++) spec = { oneOf: [spec, { type: 'null' }] }

    const compiled = valueSchemaSpecToJsonSchema(spec as ValueSchemaSpec)

    let cursor = compiled
    let layers = 0
    while (cursor.oneOf !== undefined) {
      cursor = cursor.oneOf[0]!
      layers++
    }
    expect(layers).toBe(depth)
    expect(cursor).toEqual({ type: 'string' })
  })

  it('preserves a property literally named __proto__ as schema data', () => {
    const properties = Object.create(null) as ParameterSchemaSpec
    properties.__proto__ = { type: 'string', required: true }

    const schema = parameterSchemaSpecToJsonSchema(properties)

    expect(Object.hasOwn(schema.properties, '__proto__')).toBe(true)
    expect(schema.properties.__proto__).toEqual({ type: 'string' })
    expect(schema.required).toEqual(['__proto__'])
  })

  it('infers scalar literals, arrays, objects, json, and exact-one unions', () => {
    expectTypeOf<InferValue<{ type: 'string'; enum: readonly ['a', 'b'] }>>().toEqualTypeOf<'a' | 'b'>()
    expectTypeOf<InferValue<{ type: 'number'; const: 1 }>>().toEqualTypeOf<1>()
    expectTypeOf<InferValue<{ type: 'integer' }>>().toEqualTypeOf<number>()
    expectTypeOf<InferValue<{ type: 'boolean'; enum: readonly [true] }>>().toEqualTypeOf<true>()
    expectTypeOf<InferValue<{ type: 'null' }>>().toEqualTypeOf<null>()
    expectTypeOf<InferValue<{ type: 'array'; items: { type: 'string' } }>>().toEqualTypeOf<string[]>()
    expectTypeOf<InferValue<{ type: 'array' }>>().toEqualTypeOf<JsonValue[]>()
    expectTypeOf<InferValue<{ type: 'json' }>>().toEqualTypeOf<JsonValue>()
    expectTypeOf<InferValue<{ oneOf: readonly [{ type: 'string' }, { type: 'null' }] }>>()
      .toEqualTypeOf<string | null>()
    expectTypeOf<InferValue<{
      type: 'object'
      additionalProperties: false
      properties: { id: { type: 'integer'; required: true }; label: { type: 'string' } }
    }>>().toEqualTypeOf<{ id: number; label?: string }>()
    expectTypeOf<InferValue<{
      type: 'object'
      additionalProperties: true
      properties: { id: { type: 'integer'; required: true } }
    }>>().toEqualTypeOf<{ id: number } & Record<string, JsonValue>>()
  })

  it('bounds inference for deeply nested author schemas', () => {
    type Repeat<Count extends number, Result extends unknown[] = []> =
      Result['length'] extends Count ? Result : Repeat<Count, [unknown, ...Result]>
    type DeepArraySchema<Levels extends unknown[]> =
      Levels extends [unknown, ...infer Rest]
        ? { type: 'array'; items: DeepArraySchema<Rest> }
        : { type: 'string' }
    type PeelArrays<Value, Levels extends unknown[]> =
      Levels extends [unknown, ...infer Rest]
        ? Value extends (infer Item)[] ? PeelArrays<Item, Rest> : never
        : Value

    type DeepValue = InferValue<DeepArraySchema<Repeat<50>>>
    expectTypeOf<PeelArrays<DeepValue, Repeat<16>>>().toEqualTypeOf<JsonValue>()
  })

  it('infers required and optional parameter keys', () => {
    expectTypeOf<InferArgs<{
      path: { type: 'string'; required: true }
      offset: { type: 'integer' }
      data: { type: 'json' }
    }>>().toEqualTypeOf<{ path: string; offset?: number; data?: JsonValue }>()
  })

  it('makes invalid author forms compile-time errors', () => {
    const symbolKey = Symbol('parameter')
    const invalidObjects = {
      // @ts-expect-error explicit object schemas require an openness decision
      object: { type: 'object' } satisfies ValueSchemaSpec,
      // @ts-expect-error oneOf requires at least two branches
      oneOf: { oneOf: [{ type: 'string' }] } satisfies ValueSchemaSpec,
      // @ts-expect-error scalar enum values must match the node type
      enum: { type: 'number', enum: ['1'] } satisfies ValueSchemaSpec,
      // @ts-expect-error parameter requiredness is true-or-absent
      required: { value: { type: 'string', required: false } } satisfies ParameterSchemaSpec,
      // @ts-expect-error parameter maps accept string keys only
      symbol: { [symbolKey]: { type: 'string' } } satisfies ParameterSchemaSpec,
    }
    expect(Object.keys(invalidObjects)).toHaveLength(5)
  })
})
