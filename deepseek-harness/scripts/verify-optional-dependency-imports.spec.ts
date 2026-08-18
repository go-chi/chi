/**
 * Tests for the optional-dependency load gate: which import and re-export forms
 * survive emit, and therefore load a package the installed tree may not carry.
 *
 * The expectations here match what `tsc` emits with `verbatimModuleSyntax` off:
 * `import type`, `import {}`, an inline `type` specifier, and a named binding
 * that resolves to a type all disappear; a bare import, a value binding, and a
 * star re-export remain.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { TypeScriptProject } from './ts-project.ts'
import { collectOptionalImportViolations } from './verify-optional-dependency-imports.ts'

const FIXTURE: Record<string, string> = {
  'tsconfig.host.json': JSON.stringify({
    compilerOptions: {
      target: 'es2022',
      module: 'esnext',
      moduleResolution: 'bundler',
      noEmit: true,
      skipLibCheck: true,
      types: [],
      paths: {
        '@f/opt': ['./packages/f/opt/src/index.ts'],
        '@f/hard': ['./packages/f/hard/src/index.ts'],
      },
    },
    include: ['packages/**/*.ts'],
  }),

  'packages/f/opt/package.json': JSON.stringify({ name: '@f/opt', version: '0.0.1' }),
  'packages/f/opt/src/index.ts': [
    'export interface Shape { a: number }',
    'export const runtimeValue = 1',
    '',
  ].join('\n'),

  'packages/f/hard/package.json': JSON.stringify({ name: '@f/hard', version: '0.0.1' }),
  'packages/f/hard/src/index.ts': 'export const hardValue = 2\n',

  // The consumer allows @f/opt to be absent and requires @f/hard.
  'packages/f/consumer/package.json': JSON.stringify({
    name: '@f/consumer',
    version: '0.0.1',
    dependencies: { '@f/hard': '*' },
    peerDependencies: { '@f/opt': '*' },
    peerDependenciesMeta: { '@f/opt': { optional: true } },
  }),

  // Elided by the compiler, so each of these is allowed.
  'packages/f/consumer/src/allowed-type-only.ts': [
    "import type {} from '@f/opt'",
    'export const a = 1',
    '',
  ].join('\n'),
  'packages/f/consumer/src/allowed-empty.ts': [
    "import {} from '@f/opt'",
    'export const b = 1',
    '',
  ].join('\n'),
  'packages/f/consumer/src/allowed-inline-type.ts': [
    "import { type Shape } from '@f/opt'",
    'export const c: Shape = { a: 1 }',
    '',
  ].join('\n'),
  'packages/f/consumer/src/allowed-type-binding.ts': [
    "import { Shape } from '@f/opt'",
    'export const d: Shape = { a: 1 }',
    '',
  ].join('\n'),
  'packages/f/consumer/src/allowed-type-reexport.ts': [
    "export type { Shape } from '@f/opt'",
    '',
  ].join('\n'),
  // A hard dependency may be loaded at module scope; only optional ones may not.
  'packages/f/consumer/src/allowed-hard-dependency.ts': [
    "import { hardValue } from '@f/hard'",
    'export const e = hardValue',
    '',
  ].join('\n'),

  // Kept by the compiler, so each of these loads a package that may be absent.
  'packages/f/consumer/src/rejected-bare.ts': [
    "import '@f/opt'",
    'export const f = 1',
    '',
  ].join('\n'),
  'packages/f/consumer/src/rejected-value.ts': [
    "import { runtimeValue } from '@f/opt'",
    'export const g = runtimeValue',
    '',
  ].join('\n'),
  'packages/f/consumer/src/rejected-star-reexport.ts': [
    "export * from '@f/opt'",
    '',
  ].join('\n'),
}

const root = mkdtempSync(join(tmpdir(), 'optional-imports-'))
for (const [rel, content] of Object.entries(FIXTURE)) {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), content)
}
const violations = collectOptionalImportViolations(new TypeScriptProject(root))

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('optional dependency loads', () => {
  it('reports every form the compiler keeps, and nothing else', () => {
    expect(violations.map(violation => violation.split(' loads ')[0])).toEqual([
      'packages/f/consumer/src/rejected-bare.ts:1',
      'packages/f/consumer/src/rejected-star-reexport.ts:1',
      'packages/f/consumer/src/rejected-value.ts:1',
    ])
  })

  it('names the package, the declaration that made it optional, and the way out', () => {
    expect(violations[0]).toBe(
      'packages/f/consumer/src/rejected-bare.ts:1 loads @f/opt at module scope,'
      + ' declared optional in peerDependenciesMeta; import it as a type,'
      + ' or restructure so module scope does not need it',
    )
  })
})
