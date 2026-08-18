/** Generic source form retained before conditional evaluation. */
export interface Box<T> {
  /** The boxed value. */
  readonly value: T
}

/** Conditional source form retained instead of its resolved instantiations. */
export type Present<T> = T extends null | undefined ? never : T

/** Mapped source form retained instead of materialized properties. */
export type Flags<T> = {
  readonly [K in keyof T]?: boolean
}

/** Explicit base edge for reference-passed objects. */
export interface Entity {
  readonly id: string
}

/** Developer-authored enum retained as a declaration. */
export enum AgentPhase {
  Unknown,
  Idle = 'idle',
  Running = 'running',
}

/** Runtime-validating data root. @typert schema */
export interface Payload {
  name: string
  count?: number
}

/** Signature members represented without flattening their callable forms. */
export interface Callable {
  (value: string): number
  new (value: string): Entity
  readonly [key: string]: unknown
}

/** Input, output, and invariant parameters retain authored variance. */
export interface Variance<in Input, out Output, in out State> {
  consume: (input: Input) => void
  readonly produce: () => Output
  state: State
}

/** Infer form nested inside a conditional type. */
export type Result<Value> = Value extends (...arguments_: never[]) => infer Output ? Output : never

/** Constrained infer form retained before conditional evaluation. */
export type StringResult<Value> = Value extends readonly [infer Output extends string] ? Output : never

/** Template-literal source form. */
export type Topic<Name extends string> = `demo/${Name}`

/** Multiple template spans retain each authored suffix. */
export type Route<From extends string, To extends string> = `/${From}/to/${To}/end`

/** Preserve mapped modifiers when none were authored. */
export type PlainMap<Value> = {
  [Key in keyof Value]: Value[Key]
}

/** Retain key remapping and explicit modifier removal. */
export type Remapped<Value> = {
  -readonly [Key in keyof Value as `get${Capitalize<string & Key>}`]-?: Value[Key]
}

/** Retain explicit mapped modifier addition. */
export type Added<Value> = {
  +readonly [Key in keyof Value]+?: Value[Key]
}

/** Value used by a type query and indexed access. */
export const phaseOrder = ['idle', 'running'] as const

/** Generic value used by an instantiated type query. */
export declare function genericFactory<Value>(): Value

/** Predicates and the polymorphic this type remain signatures. */
export interface Guards {
  isEntity(value: unknown): value is Entity
  isFluent(): this is Guards
  assertEntity(value: unknown): asserts value is Entity
  assertPresent(value: unknown): asserts value
  fluent(): this
}

/** Abstract declarations remain distinct from concrete classes. */
export abstract class AbstractEntity implements Entity {
  abstract readonly id: string
}

/** Recursive declaration edges retain their declaration target. */
export interface Recursive extends Box<string> {
  readonly next?: Recursive
}

/**
 * @deprecated
 */
export interface TagOnly {
  readonly value: string
}

/** Description without terminal punctuation */
export interface Unpunctuated {
  readonly value: string
}

/** Every supported TypeNode shape is reachable from this declaration. */
export interface SyntaxZoo {
  anyValue: any
  bigintValue: bigint
  parenthesized: (Entity | null)
  literals: 1 | 1n | -2 | -2n | false | `fixed`
  readonly uniqueToken: unique symbol
  intersection: Entity & { active: boolean }
  array: string[]
  tuple: [head: string, count?: number, ...tail: boolean[]]
  unnamedTuple: [string?, ...number[]]
  readonlyTuple: readonly [string, number]
  object: {
    readonly value?: string
    'quoted-name': number
    1: boolean
    ['computed']: symbol
    invoke?(input: number): void
  }
  callback: <Value extends Entity = Entity>(
    this: Entity,
    value: Value,
    optional?: string,
    ...rest: number[]
  ) => Promise<Value>
  constCallback: <const Value extends readonly string[]>(value: Value) => Value
  factory: new <Value extends Entity>(value: Value) => Value
  abstractFactory: abstract new (id: string) => AbstractEntity
  indexed: Payload['name']
  inferred: Result<() => string>
  constrainedInfer: StringResult<['value']>
  topic: Topic<'ready'>
  route: Route<'source', 'target'>
  query: typeof phaseOrder
  instantiatedQuery: typeof genericFactory<string>
  imported: import('zod').ZodType<string>
  importedWith: import('zod', { with: { 'resolution-mode': 'import' } }).ZodType<string>
  importedModule: typeof import('zod')
  process: NodeJS.Process
  callable: Callable
  guards: Guards
  variance: Variance<Entity, Payload, Box<string>>
  plainMap: PlainMap<Payload>
  remapped: Remapped<Payload>
  added: Added<Payload>
  abstractEntity: AbstractEntity
  recursive: Recursive
  tagOnly: TagOnly
  unpunctuated: Unpunctuated
}
