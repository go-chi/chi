/**
 * Negative-path tests for the exported-API JSDoc gate (`scripts/verify-export-jsdoc.ts`).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectExportJsdocViolations } from '../../../../scripts/verify-export-jsdoc.ts'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

/** Write fixture files under `packages/group/fix/src/` and return the scan root. */
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'export-jsdoc-'))
  roots.push(root)
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, 'packages', 'group', 'fix', 'src', rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
  return root
}

/** Single-file fixture shorthand: the content becomes `src/index.ts`. */
const make = (content: string): string => fixture({ 'index.ts': content })

describe('verify-export-jsdoc functions and consts', () => {
  it('limits packages without src/* exports to declarations reachable from package entrypoints', () => {
    const root = fixture({
      'index.ts': "export { publicFn } from './internal.ts'\n",
      'internal.ts': `
export function publicFn(value: string): string { return value }
export function hiddenFn(value: string): string { return value }
`,
    })
    writeFileSync(join(root, 'packages/group/fix/package.json'), JSON.stringify({
      exports: { '.': { types: './lib/types/index.d.ts', default: './lib/index.js' } },
    }))
    const violations = collectExportJsdocViolations(root)
    expect(violations).toHaveLength(1)
    expect(violations.every(violation => violation.includes('publicFn'))).toBe(true)
  })

  it('accepts a fully documented API', () => {
    expect(collectExportJsdocViolations(make(`
/**
 * Add one to a count.
 * @param n - the count to bump.
 * @returns the count plus one.
 */
export function bump(n: number): number { return n + 1 }

/**
 * Fire-and-forget (void needs no @returns).
 * @param flag - whether to arm.
 */
export function poke(flag: boolean): void { void flag }

/** The default retry budget. */
export const RETRIES = 3

/**
 * Halve a count.
 * @param n - the count to halve.
 * @returns the count halved.
 */
export const halve = (n: number): number => n / 2
`))).toEqual([])
  })

  it('flags an exported function with no JSDoc at all', () => {
    expect(collectExportJsdocViolations(make(
      'export function bare(): void {}\n',
    ))).toEqual([expect.stringMatching(/exported function 'bare' .* has no JSDoc\./)])
  })

  it('flags a missing @param and a missing @returns', () => {
    const violations = collectExportJsdocViolations(make(
      '/** Docs without tags. */\nexport function f(x: number): number { return x }\n',
    ))
    expect(violations).toEqual([
      expect.stringMatching(/exported function 'f' .* is missing @param x\./),
      expect.stringMatching(/exported function 'f' .* is missing @returns \(return type: number\)\./),
    ])
  })

  it('flags an unannotated (inferred) return type', () => {
    expect(collectExportJsdocViolations(make(
      '/**\n * Docs.\n * @param x - value.\n */\nexport function f(x: number) { return x }\n',
    ))).toEqual([expect.stringMatching(/no return type annotation/)])
  })

  it('flags tags-only JSDoc with no description prose', () => {
    expect(collectExportJsdocViolations(make(
      '/**\n * @param x - value.\n */\nexport function f(x: number): void {}\n',
    ))).toEqual([expect.stringMatching(/no description prose above its block tags/)])
  })

  it('flags a stale @param and a binding-pattern parameter', () => {
    const violations = collectExportJsdocViolations(make(
      '/**\n * Docs.\n * @param ghost - not real.\n */\nexport function f({ a }: { a: number }): void {}\n',
    ))
    expect(violations).toEqual([
      expect.stringMatching(/parameter '\{ a \}' is a binding pattern; the exported API needs simple identifier parameters/),
      expect.stringMatching(/@param ghost does not match any parameter \(stale tag\?\)/),
    ])
  })

  it('exempts a `this` receiver annotation from @param', () => {
    expect(collectExportJsdocViolations(make(
      '/**\n * Docs.\n * @param x - value.\n */\nexport function f(this: object, x: number): void {}\n',
    ))).toEqual([])
  })

  it('waives @returns for a declarator-annotated const but not an unannotated one', () => {
    expect(collectExportJsdocViolations(make(`
type Fn = (x: number) => number
/**
 * Uses the named signature.
 * @param x - value.
 */
export const good: Fn = x => x
/**
 * No signature anywhere.
 * @param x - value.
 */
export const bad = (x: number) => x
`))).toEqual([expect.stringMatching(/exported const 'bad' .* has no return type annotation/)])
  })

  it('requires description prose on a non-function const', () => {
    expect(collectExportJsdocViolations(make(
      'export const LIMIT = 10\n',
    ))).toEqual([expect.stringMatching(/exported const 'LIMIT' .* has no JSDoc\./)])
  })
})

describe('verify-export-jsdoc type-level exports', () => {
  it('requires description prose on interfaces, type aliases, and enums', () => {
    const violations = collectExportJsdocViolations(make(
      'export interface I { a: number }\nexport type T = number\nexport enum E { A }\n',
    ))
    expect(violations).toEqual([
      expect.stringMatching(/exported interface 'I' .* has no JSDoc\./),
      expect.stringMatching(/exported type 'T' .* has no JSDoc\./),
      expect.stringMatching(/exported enum 'E' .* has no JSDoc\./),
    ])
  })

  it('skips `declare module` augmentation bodies (the cordis gate owns them)', () => {
    expect(collectExportJsdocViolations(make(
      "declare module '@deepseek-ai/cordis' {\n  interface Events {\n    'fix/x'(): void\n  }\n}\nexport {}\n",
    ))).toEqual([])
  })
})

describe('verify-export-jsdoc export forms', () => {
  it('resolves an `export { … }` list to the local declaration', () => {
    expect(collectExportJsdocViolations(make(
      'function f(): void {}\nexport { f }\n',
    ))).toEqual([expect.stringMatching(/exported function 'f' .* has no JSDoc\./)])
  })

  it('does not treat a never-exported sibling declarator as API', () => {
    // `export { publicValue }` resolves to the whole variable statement; only
    // the named declarator is exported — the gate must not demand JSDoc for
    // the private sibling sharing the statement.
    expect(collectExportJsdocViolations(make(
      '/** The public knob. */\nconst publicValue = 1, privateHelper = 2\nexport { publicValue }\nvoid privateHelper\n',
    ))).toEqual([])
  })

  it('unions declarators across multiple export lists over one statement', () => {
    // Two lists each name one declarator of the same undocumented statement:
    // both are exported (deduplicating on first resolution would drop `b`),
    // while the never-exported `c` stays out.
    const violations = collectExportJsdocViolations(make(
      'const a = 1, b = 2, c = 3\nexport { a }\nexport { b }\nvoid c\n',
    ))
    expect(violations).toEqual([
      expect.stringMatching(/exported const 'a' .* has no JSDoc\./),
      expect.stringMatching(/exported const 'b' .* has no JSDoc\./),
    ])
  })

  it('scopes a default-export identifier to its own declarator', () => {
    // `export default` of an identifier reaches the statement through the
    // same name lookup as an export list; the sibling stays private.
    expect(collectExportJsdocViolations(make(
      '/** The app entry. */\nconst app = 1, scratch = 2\nexport default app\nvoid scratch\n',
    ))).toEqual([])
  })

  it('reports a re-exported module once, at its defining file', () => {
    const violations = collectExportJsdocViolations(fixture({
      'index.ts': "export * from './other.ts'\n",
      'other.ts': 'export function f(): void {}\n',
    }))
    expect(violations).toEqual([expect.stringMatching(/other\.ts:1\) has no JSDoc\./)])
  })

  it('exempts overload implementations when the signatures are documented', () => {
    expect(collectExportJsdocViolations(make(`
/**
 * From a number.
 * @param x - the number.
 * @returns its text.
 */
export function f(x: number): string
/**
 * From a flag.
 * @param x - the flag.
 * @returns its text.
 */
export function f(x: boolean): string
export function f(x: number | boolean): string { return String(x) }
`))).toEqual([])
  })
})

describe('verify-export-jsdoc classes', () => {
  it('flags an undocumented class, method, property, and accessor', () => {
    const violations = collectExportJsdocViolations(make(`
export class C {
  state = 1
  get view(): number { return this.state }
  run(x: number): number { return x }
}
`))
    expect(violations).toEqual([
      expect.stringMatching(/exported class 'C' .* has no JSDoc\./),
      expect.stringMatching(/exported class property 'C.state' .* has no JSDoc\./),
      expect.stringMatching(/exported class accessor 'C.view' .* has no JSDoc\./),
      expect.stringMatching(/exported class method 'C.run' .* has no JSDoc\./),
    ])
  })

  it('exempts members declared by an extends/implements heritage type', () => {
    expect(collectExportJsdocViolations(make(`
/** Seam. */
export abstract class Base {
  /**
   * Do it.
   * @param x - input.
   * @returns output.
   */
  abstract run(x: number): number
}
/** Iface. */
export interface Sized {
  /** Byte size. */
  size: number
}
/** Impl. */
export class Impl extends Base implements Sized {
  size = 0
  run(x: number): number { return x }
}
`))).toEqual([])
  })

  it('skips private/protected/#private members and constructors', () => {
    expect(collectExportJsdocViolations(make(`
/** Documented. */
export class C {
  #secret = 1
  private hidden(): void {}
  protected hook(): void {}
  constructor(x: number) { void x }
}
`))).toEqual([])
  })

  it('exempts plugin-protocol statics but checks other statics', () => {
    const violations = collectExportJsdocViolations(make(`
/** Plugin. */
export class C {
  static Config = { a: 1 }
  static inject = ['bash']
  static reusable = true
  static other = 1
}
`))
    expect(violations).toEqual([expect.stringMatching(/exported class property 'C.other' .* has no JSDoc\./)])
  })

  it("covers a set accessor by the getter's doc", () => {
    expect(collectExportJsdocViolations(make(`
/** Documented. */
export class C {
  /** The current width. */
  get width(): number { return 1 }
  set width(_v: number) {}
}
`))).toEqual([])
  })
})

describe('verify-export-jsdoc plugin protocol and namespaces', () => {
  it('exempts top-level plugin-protocol exports', () => {
    expect(collectExportJsdocViolations(make(`
export const name = 'fix'
export const inject = ['bash']
export const reusable = true
export const Config = { parse: true }
export function apply(): void {}
`))).toEqual([])
  })

  it('recurses into namespaces with qualified names and honors the merge idiom', () => {
    const violations = collectExportJsdocViolations(make(`
/** The plugin class. */
export class Fix {}
export namespace Fix {
  export interface Config { a: number }
}
export namespace Loose {
  export const x = 1
}
`))
    expect(violations).toEqual([
      expect.stringMatching(/exported interface 'Fix.Config' .* has no JSDoc\./),
      expect.stringMatching(/exported namespace 'Loose' .* has no JSDoc\./),
      expect.stringMatching(/exported const 'Loose.x' .* has no JSDoc\./),
    ])
  })
})

describe('verify-export-jsdoc fail-closed forms', () => {
  it('checks the function contract on a non-identifier default export', () => {
    expect(collectExportJsdocViolations(make(
      '/** Doubles. */\nexport default (x: number): number => x * 2\n',
    ))).toEqual([
      expect.stringMatching(/default export .* is missing @param x\./),
      expect.stringMatching(/default export .* is missing @returns \(return type: number\)\./),
    ])
    expect(collectExportJsdocViolations(make(
      '/**\n * Doubles.\n * @param x - the input.\n * @returns twice the input.\n */\nexport default (x: number): number => x * 2\n',
    ))).toEqual([])
  })

  it('treats an inline function-type annotation as the API signature', () => {
    expect(collectExportJsdocViolations(make(
      '/** Maps a number. */\nexport declare const f: (x: number) => number\n',
    ))).toEqual([
      expect.stringMatching(/exported const 'f' .* is missing @param x\./),
      expect.stringMatching(/exported const 'f' .* is missing @returns \(return type: number\)\./),
    ])
    expect(collectExportJsdocViolations(make(
      '/**\n * Maps a number.\n * @param x - the input.\n * @returns the mapped value.\n */\nexport const f: (x: number) => number = v => v\n',
    ))).toEqual([])
  })

  it('recurses into an ambient declare namespace where members export implicitly', () => {
    expect(collectExportJsdocViolations(make(
      'export declare namespace N {\n  function f(x: number): number\n}\n',
    ))).toEqual([
      expect.stringMatching(/exported namespace 'N' .* has no JSDoc\./),
      expect.stringMatching(/exported function 'N.f' .* has no JSDoc\./),
    ])
  })

  it('requires an export-import alias to document itself (its target may be unwalked)', () => {
    expect(collectExportJsdocViolations(make(
      '/** Holder. */\nexport namespace N {\n  /** The value. */\n  export const x = 1\n}\nexport import y = N.x\n',
    ))).toEqual([expect.stringMatching(/exported alias 'y' .* has no JSDoc\./)])
    expect(collectExportJsdocViolations(make(
      'namespace N {\n  export const x = 1\n}\n/** Alias surfacing the internal counter. */\nexport import y = N.x\n',
    ))).toEqual([])
  })

  it('refuses an export-import alias to a callable, class, or namespace target', () => {
    const refusal = /exported alias 'g' .* aliases a callable, class, or namespace target/
    expect(collectExportJsdocViolations(make(
      'namespace N {\n  export function f(x: number): number { return x }\n}\n/** Alias. */\nexport import g = N.f\n',
    ))).toEqual([expect.stringMatching(refusal)])
    expect(collectExportJsdocViolations(make(
      'namespace N {\n  export class C {\n    run(x: number): number { return x }\n  }\n}\n/** Alias. */\nexport import g = N.C\n',
    ))).toEqual([expect.stringMatching(refusal)])
    expect(collectExportJsdocViolations(make(
      'namespace N {\n  export namespace Sub {\n    export function f(x: number): number { return x }\n  }\n}\n/** Alias. */\nexport import g = N.Sub\n',
    ))).toEqual([expect.stringMatching(refusal)])
  })

  it('classifies wrapped function initializers and default exports (parens, satisfies)', () => {
    expect(collectExportJsdocViolations(make(
      'type Fn = (x: number) => number\n/** Wrapped. */\nexport const f = (((x: number): number => x)) satisfies Fn\n',
    ))).toEqual([
      expect.stringMatching(/exported const 'f' .* is missing @param x\./),
      expect.stringMatching(/exported const 'f' .* is missing @returns \(return type: number\)\./),
    ])
    expect(collectExportJsdocViolations(make(
      'type Fn = (x: number) => number\n/** Wrapped. */\nexport default (((x: number): number => x * 2) satisfies Fn)\n',
    ))).toEqual([
      expect.stringMatching(/default export .* is missing @param x\./),
      expect.stringMatching(/default export .* is missing @returns \(return type: number\)\./),
    ])
  })

  it('treats a single-call-signature type literal as the API signature', () => {
    expect(collectExportJsdocViolations(make(
      '/** Maps. */\nexport declare const f: { (x: number): number }\n',
    ))).toEqual([
      expect.stringMatching(/exported const 'f' .* is missing @param x\./),
      expect.stringMatching(/exported const 'f' .* is missing @returns \(return type: number\)\./),
    ])
  })

  it('refuses a hybrid callable type literal instead of narrowing the check', () => {
    expect(collectExportJsdocViolations(make(
      '/** Hybrid. */\nexport declare const f: { (x: number): number; flush: () => void }\n',
    ))).toEqual([expect.stringMatching(/exported const 'f'.*callable type literal is not gate-classifiable; extract a named type/)])
  })

  it('refuses an export-equals assignment instead of failing open', () => {
    expect(collectExportJsdocViolations(make(
      'const x = 1\nexport = x\n',
    ))).toEqual([expect.stringMatching(/export-equals assignment .* is not a gate-supported export form/)])
  })
})

describe('verify-export-jsdoc heritage refinement', () => {
  it('requires @param for parameters the base member never names', () => {
    const violations = collectExportJsdocViolations(make(`
/** Seam. */
export abstract class Base {
  /**
   * Do it.
   * @param x - input.
   * @returns output.
   */
  abstract run(x: number): number
}
/** Impl. */
export class Impl extends Base {
  override run(x: number, verbose?: boolean): number { return verbose ? x : -x }
}
`))
    expect(violations).toEqual([expect.stringMatching(/exported class method 'Impl.run' .* is missing @param verbose\./)])
  })

  it('does not exempt a public override of a protected-only base member', () => {
    expect(collectExportJsdocViolations(make(`
/** Seam. */
export abstract class Base {
  /** Subclass hook. */
  protected hook(): void {}
}
/** Impl. */
export class Impl extends Base {
  override hook(): void {}
}
`))).toEqual([expect.stringMatching(/exported class method 'Impl.hook' .* has no JSDoc\./)])
  })

  it('treats an underscore-prefixed rename of a base parameter as the same parameter', () => {
    expect(collectExportJsdocViolations(make(`
/** Seam. */
export abstract class Base {
  /**
   * Load it.
   * @param cwd - the working directory to scope the lookup.
   * @returns the loaded value.
   */
  abstract load(cwd: string): number
}
/** Impl (ignores cwd). */
export class Impl extends Base {
  load(_cwd: string): number { return 1 }
}
`))).toEqual([])
  })

  it('flags a binding-pattern parameter an override adds beyond the base', () => {
    expect(collectExportJsdocViolations(make(`
/** Seam. */
export abstract class Base {
  /**
   * Do it.
   * @param x - input.
   * @returns output.
   */
  abstract run(x: number): number
}
/** Impl. */
export class Impl extends Base {
  override run(x: number, { verbose }: { verbose?: boolean } = {}): number { return verbose ? x : -x }
}
`))).toEqual([expect.stringMatching(/exported class method 'Impl.run' .* is a binding pattern/)])
  })

  it('revives the @returns duty when an override grows a concrete result over a void base', () => {
    const voidBase = `
/** Seam. */
export abstract class Base {
  /** Do it (fire-and-forget). */
  abstract run(): void
}
`
    expect(collectExportJsdocViolations(make(`${voidBase}
/** Impl. */
export class Impl extends Base {
  override run(): number { return 1 }
}
`))).toEqual([expect.stringMatching(/exported class method 'Impl.run' .* is missing @returns \(return type: number\)\./)])
    expect(collectExportJsdocViolations(make(`${voidBase}
/** Impl. */
export class Impl extends Base {
  /**
   * Do it and count.
   * @returns how many were done.
   */
  override run(): number { return 1 }
}
`))).toEqual([])
  })

  it('classifies an unannotated override return over a void base via the checker', () => {
    const voidBase = `
/** Seam. */
export abstract class Base {
  /** Do it (fire-and-forget). */
  abstract run(): void
}
`
    expect(collectExportJsdocViolations(make(`${voidBase}
/** Impl. */
export class Impl extends Base {
  override run() { return 1 }
}
`))).toEqual([expect.stringMatching(/exported class method 'Impl.run' .* non-void result its heritage declaration does not document/)])
    expect(collectExportJsdocViolations(make(`${voidBase}
/** Impl (faithful void, no annotation needed). */
export class Impl extends Base {
  override run() {}
}
`))).toEqual([])
  })

  it('keeps the full exemption when the base return already carries the @returns duty', () => {
    expect(collectExportJsdocViolations(make(`
/** Seam. */
export abstract class Base {
  /**
   * Count things.
   * @returns the count.
   */
  abstract run(): number
}
/** Impl. */
export class Impl extends Base {
  override run(): number { return 1 }
}
`))).toEqual([])
  })
})
