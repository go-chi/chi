import { isNullable } from './misc.ts'

/** Return true when every item in `array2` is present in `array1`. */
export function contain(array1: readonly any[], array2: readonly any[]) {
  return array2.every(item => array1.includes(item))
}

/** Return items that appear in both arrays. */
export function intersection<T>(array1: readonly T[], array2: readonly T[]) {
  return array1.filter(item => array2.includes(item))
}

/** Return items from `array1` that do not appear in `array2`. */
export function difference<S>(array1: readonly S[], array2: readonly any[]) {
  return array1.filter(item => !array2.includes(item))
}

/** Return the set-union of two arrays while preserving first occurrence order. */
export function union<T>(array1: readonly T[], array2: readonly T[]) {
  return Array.from(new Set([...array1, ...array2]))
}

/** Remove duplicate values while preserving first occurrence order. */
export function deduplicate<T>(array: readonly T[]) {
  return [...new Set(array)]
}

/** Remove one item from an array and report whether it was found. */
export function remove<T>(list: T[], item: T) {
  const index = list?.indexOf(item)
  if (index >= 0) {
    list.splice(index, 1)
    return true
  } else {
    return false
  }
}

/** Normalize nullish, scalar, or array input to an array. */
export function makeArray<T>(source: null | undefined | T | T[]) {
  return Array.isArray(source) ? source : isNullable(source) ? [] : [source]
}
