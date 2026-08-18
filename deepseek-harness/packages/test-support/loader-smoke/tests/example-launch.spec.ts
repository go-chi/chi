import { afterEach, describe, expect, it } from 'vitest'
import {
  EXAMPLE_MODE_ENV,
  resolveExampleLaunch,
  resolveExampleMode,
} from '@deepseek-ai/dsh-loader-smoke'

const SRC_BIN = '/repo/packages/examples/acp-demo/src/bin.ts'
const TSCONFIG = '/repo/tsconfig.json'

const originalMode = process.env[EXAMPLE_MODE_ENV]
afterEach(() => {
  if (originalMode === undefined) Reflect.deleteProperty(process.env, EXAMPLE_MODE_ENV)
  else process.env[EXAMPLE_MODE_ENV] = originalMode
})

describe('resolveExampleMode', () => {
  it('defaults absent/empty/src to src', () => {
    Reflect.deleteProperty(process.env, EXAMPLE_MODE_ENV)
    expect(resolveExampleMode()).toBe('src')
    expect(resolveExampleMode('')).toBe('src')
    expect(resolveExampleMode('src')).toBe('src')
  })

  it('accepts lib', () => {
    expect(resolveExampleMode('lib')).toBe('lib')
  })

  it('throws on any other value', () => {
    expect(() => resolveExampleMode('prod')).toThrow(/must be 'src' or 'lib'/)
  })

  it('reads the environment when no argument is given', () => {
    process.env[EXAMPLE_MODE_ENV] = 'lib'
    expect(resolveExampleMode()).toBe('lib')
    Reflect.deleteProperty(process.env, EXAMPLE_MODE_ENV)
    expect(resolveExampleMode()).toBe('src')
  })
})

describe('resolveExampleLaunch', () => {
  it('src mode: --import tsx on the source bin with the tsconfig paths env', () => {
    const { command, args, env } = resolveExampleLaunch({
      srcBin: SRC_BIN,
      configArgs: ['./cordis.yml'],
      mode: 'src',
      tsconfigPath: TSCONFIG,
    })
    expect(command).toBe(process.execPath)
    expect(args).toContain('--import')
    expect(args).toContain(SRC_BIN)
    expect(args[args.length - 1]).toBe('./cordis.yml')
    expect(env.TSX_TSCONFIG_PATH).toBe(TSCONFIG)
  })

  it('src mode: throws without a tsconfig path', () => {
    expect(() => resolveExampleLaunch({ srcBin: SRC_BIN, mode: 'src' })).toThrow(/needs tsconfigPath/)
  })

  it('lib mode: plain node on the derived lib bin, no tsx and no paths env', () => {
    const { args, env } = resolveExampleLaunch({
      srcBin: SRC_BIN,
      configArgs: ['--config', './cordis.yml'],
      mode: 'lib',
      env: { DSH_HOME: '/tmp/home' },
    })
    expect(args).not.toContain('--import')
    expect(args).toContain('/repo/packages/examples/acp-demo/lib/bin.js')
    expect(args.slice(-2)).toEqual(['--config', './cordis.yml'])
    expect(env.TSX_TSCONFIG_PATH).toBeUndefined()
    expect(env.DSH_HOME).toBe('/tmp/home')
  })

  it('lib mode: uses an explicit plain-Node bin when provided', () => {
    const fixture = '/repo/fixture.ts'
    const { args } = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, mode: 'lib' })
    expect(args).toContain(fixture)
  })

  it('lib mode: rewrites only the last /src/ segment', () => {
    const { args } = resolveExampleLaunch({
      srcBin: '/repo/src/packages/examples/acp-demo/src/bin.ts',
      mode: 'lib',
    })
    expect(args).toContain('/repo/src/packages/examples/acp-demo/lib/bin.js')
  })

  it('lib mode: derives the built bin from a Windows source path', () => {
    const { args } = resolveExampleLaunch({
      srcBin: String.raw`D:\repo\src\packages\examples\acp-demo\src\bin.ts`,
      mode: 'lib',
    })
    expect(args).toContain(String.raw`D:\repo\src\packages\examples\acp-demo\lib\bin.js`)
  })

  it('lib mode: throws when the bin has no /src/ segment', () => {
    expect(() => resolveExampleLaunch({ srcBin: '/repo/lib/bin.js', mode: 'lib' })).toThrow(/"\/src\/" segment/)
  })

  it('defaults the mode from the environment', () => {
    process.env[EXAMPLE_MODE_ENV] = 'lib'
    const { args } = resolveExampleLaunch({ srcBin: SRC_BIN })
    expect(args).toContain('/repo/packages/examples/acp-demo/lib/bin.js')
  })
})
