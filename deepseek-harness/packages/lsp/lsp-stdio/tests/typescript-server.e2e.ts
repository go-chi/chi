/**
 * Keyless real-server e2e: drives the real `typescript-language-server` through the full
 * `ctx.lsp` → `dsh-lsp-stdio` stack over the base protocol, exercising all four operations. No API
 * key needed — the server is a local dev dependency. This establishes one compatibility floor
 * (TypeScript), not a cross-language claim.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import Lsp, { type LspQueryRequest, type LspQueryResult } from '@deepseek-ai/dsh-lsp'
import * as LspLocal from '@deepseek-ai/dsh-lsp-stdio'

// The server binary is a dev dependency of this package; resolve its pnpm-hoisted .bin path.
const serverBin = join(
  new URL('..', import.meta.url).pathname,
  'node_modules',
  '.bin',
  'typescript-language-server',
)

let root: string
let ws: string
let ctx: Context

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'lsp-ts-e2e-')))
  ws = join(root, 'proj')
  await mkdir(ws)
  await writeFile(join(ws, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, module: 'nodenext' } }))
  // A small program with a definition, a reference, an interface + implementation, and a typed value.
  await writeFile(join(ws, 'shapes.ts'), [
    'export interface Shape {',
    '  area(): number',
    '}',
    '',
    'export class Circle implements Shape {',
    '  constructor(private r: number) {}',
    '  area(): number { return Math.PI * this.r * this.r }',
    '}',
    '',
    'export function describe(s: Shape): string {',
    '  return `area=${s.area()}`',
    '}',
    '',
    'const c = new Circle(2)',
    'export const text = describe(c)',
    '',
  ].join('\n'))

  ctx = new Context()
  await ctx.plugin(Lsp)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
  await ctx.plugin(LspLocal, {
    servers: {
      typescript: {
        command: serverBin,
        args: ['--stdio'],
        extensionToLanguage: { '.ts': 'typescript', '.tsx': 'typescriptreact' },
      },
    },
  })
}, 60_000)

afterAll(async () => {
  if (ctx) await ctx.fiber.dispose()
  if (root) await rm(root, { recursive: true, force: true })
})

/** One-based helper mirroring the model contract, converted to the seam's zero-based position. */
function at(operation: LspQueryRequest['operation'], line1: number, char1: number, filePath = 'shapes.ts'): LspQueryRequest {
  return { operation, filePath, position: { line: line1 - 1, character: char1 - 1 }, workspaceRoot: ws }
}

function locations(result: LspQueryResult): readonly { uri: string }[] {
  if (result.kind !== 'locations') throw new Error(`expected locations, got ${result.kind}`)
  return result.locations
}

describe('real typescript-language-server', () => {
  it('resolves the definition of a call site to its declaration', async () => {
    // `export const text = describe(c)` (line 15): `describe` begins at column 21.
    const result = await ctx.lsp.query(at('goToDefinition', 15, 22))
    const locs = locations(result)
    expect(locs.length).toBeGreaterThanOrEqual(1)
    expect(locs.some(l => l.uri.endsWith('shapes.ts'))).toBe(true)
  }, 60_000)

  it('finds references to a symbol including its declaration', async () => {
    // References to `describe` from its declaration (line 10, col 17).
    const result = await ctx.lsp.query(at('findReferences', 10, 17))
    const locs = locations(result)
    // At least the declaration plus the call site.
    expect(locs.length).toBeGreaterThanOrEqual(2)
  }, 60_000)

  it('resolves implementations of an interface', async () => {
    // Implementations of `Shape` (line 1, col 18) → Circle.
    const result = await ctx.lsp.query(at('goToImplementation', 1, 18))
    const locs = locations(result)
    expect(locs.length).toBeGreaterThanOrEqual(1)
  }, 60_000)

  it('returns hover information for a typed symbol', async () => {
    // Hover on `Circle` in `new Circle(2)` (line 14, col 15).
    const result = await ctx.lsp.query(at('hover', 14, 15))
    expect(result.kind).toBe('hover')
    if (result.kind === 'hover') {
      expect(result.hover).not.toBeNull()
      expect(result.hover?.contents).toContain('Circle')
    }
  }, 60_000)
})
