/** String/symbol keyed dictionary type. */
export type Dict<T = any, K extends string | symbol = string> = { [key in K]: T }
/** Safely read `T[K]`, returning `never` when `K` is not a key of `T`. */
export type Get<T extends {}, K> = K extends keyof T ? T[K] : never
/** Conditional extraction helper with a configurable return type. */
export type Extract<S, T, U = S> = S extends T ? U : never
/** Accept a value or an array, unless the value is already an array type. */
export type MaybeArray<T> = [T] extends [unknown[]] ? T : T | T[]
/** Wrap a value in `Promise`, preserving the resolved type of existing promises. */
export type Promisify<T> = Promise<T extends Promise<infer S> ? S : T>
/** Accept a value or promise unless the value type is already promise-like. */
export type Awaitable<T> = [T] extends [Promise<unknown>] ? T : T | Promise<T>
/** Convert a union type to an intersection type. */
export type Intersect<U> = (U extends any ? (arg: U) => void : never) extends ((arg: infer I) => void) ? I : never

/** No-op callback returning `undefined` at runtime and `any` at type level. */
export function noop(): any {}

/** Return true when a value is `null` or `undefined`. */
export function isNullable(value: any): value is null | undefined | void {
  return value === null || value === undefined
}

/** Return true when a value is neither `null` nor `undefined`. */
export function isNonNullable<T>(value: T): value is NonNullable<T> {
  return !isNullable(value)
}

/** Return true for non-array object values. */
export function isPlainObject(data: any) {
  return data && typeof data === 'object' && !Array.isArray(data)
}

/** Filter object entries with a key type guard. */
export function filterKeys<T, K extends string, U extends K>(object: Dict<T, K>, filter: (key: K, value: T) => key is U): Dict<T, U>
/** Filter object entries with a boolean predicate. */
export function filterKeys<T, K extends string>(object: Dict<T, K>, filter: (key: K, value: T) => boolean): Dict<T, K>
/** Filter object entries and return a new object. */
export function filterKeys(object: {}, filter: (key: string, value: any) => boolean) {
  return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)))
}

/** Map object values while preserving the original key set. */
export function mapValues<U, T, K extends string>(object: Dict<T, K>, transform: (value: T, key: K) => U) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, (transform as any)(value, key)])) as Dict<U, K>
}

/** Alias for `mapValues`. */
export { mapValues as valueMap }

/** Pick selected keys from an object, optionally including `undefined` values. */
export function pick<T extends object, K extends keyof T>(source: T, keys?: Iterable<K>, forced?: boolean) {
  if (!keys) return { ...source }
  const result = {} as Pick<T, K>
  for (const key of keys) {
    if (forced || source[key] !== undefined) result[key] = source[key]
  }
  return result
}

/** Omit selected keys from a shallow object copy. */
export function omit<T, K extends keyof T>(source: T, keys?: Iterable<K>) {
  if (!keys) return { ...source }
  const result = { ...source } as Omit<T, K>
  for (const key of keys) {
    Reflect.deleteProperty(result, key)
  }
  return result
}

/** Define a non-enumerable writable property with a typed key. */
export function defineProperty<T, K extends keyof T>(object: T, key: K, value: T[K]): T
/** Define a non-enumerable writable property with an arbitrary key. */
export function defineProperty<T, K extends keyof any>(object: T, key: K, value: any): T
/** Define a non-enumerable writable property and return the object. */
export function defineProperty<T, K extends keyof any>(object: T, key: K, value: any) {
  return Object.defineProperty(object, key, { writable: true, value, enumerable: false })
}
