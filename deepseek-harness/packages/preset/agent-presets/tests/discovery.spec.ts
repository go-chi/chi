import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { COMPOSITION_FILE, discoverPresets, scanRoot } from '@deepseek-ai/dsh-agent-presets'

const fsHarness = vi.hoisted(() => ({
  nextReadError: undefined as NodeJS.ErrnoException | undefined,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: (async (path: unknown, ...rest: never[]) => {
      const error = fsHarness.nextReadError
      if (error !== undefined) {
        fsHarness.nextReadError = undefined
        throw error
      }
      return (actual.readFile as (path: unknown, ...args: never[]) => Promise<unknown>)(path, ...rest)
    }) as typeof actual.readFile,
  }
})

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const SYSTEM = { path: join(FIXTURES, 'system'), trust: 'system' as const }
const USER = { path: join(FIXTURES, 'user'), trust: 'user' as const }

beforeEach(() => {
  fsHarness.nextReadError = undefined
})

describe('display order', () => {
  it('puts declared order first, then everything else by id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-order-'))
    for (const [id, order] of [['zulu', 1], ['alpha', 2]] as const) {
      await mkdir(join(root, id), { recursive: true })
      await writeFile(join(root, id, COMPOSITION_FILE), '[]\n')
      await writeFile(join(root, id, 'preset.yml'), `order: ${String(order)}\n`)
    }
    for (const id of ['bravo', 'yankee']) {
      await mkdir(join(root, id), { recursive: true })
      await writeFile(join(root, id, COMPOSITION_FILE), '[]\n')
    }

    const found = await scanRoot({ path: root, trust: 'system' })

    // The shipped set reads by capability; presets that declare nothing stay
    // alphabetical behind them rather than interleaving unpredictably.
    expect(found.map(preset => preset.id)).toEqual(['zulu', 'alpha', 'bravo', 'yankee'])
  })

  it('breaks a tie between equal declared orders by id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-order-tie-'))
    for (const id of ['yankee', 'alpha']) {
      await mkdir(join(root, id), { recursive: true })
      await writeFile(join(root, id, COMPOSITION_FILE), '[]\n')
      await writeFile(join(root, id, 'preset.yml'), 'order: 1\n')
    }

    const found = await scanRoot({ path: root, trust: 'system' })

    // Two presets claiming the same slot must still list in a stable order:
    // a directory-scan order would reshuffle the picker between reads.
    expect(found.map(preset => preset.id)).toEqual(['alpha', 'yankee'])
  })
})

describe('preset discovery', () => {
  it('reports one preset per directory holding a composition, ordered by id', async () => {
    const found = await scanRoot(SYSTEM)

    expect(found.map(preset => preset.id)).toEqual(['minimal', 'standard'])
    expect(found[0]).toEqual({
      id: 'minimal',
      trust: 'system',
      path: join(SYSTEM.path, 'minimal', COMPOSITION_FILE),
    })
  })

  it('reports a directory with no composition as a broken preset slot', async () => {
    const found = await scanRoot(USER)

    // The directory still occupies its id — a copy to that name is refused —
    // so hiding it would leave nothing to see or delete. It surfaces broken.
    const ghost = found.find(preset => preset.id === 'not-a-preset')
    expect(ghost?.broken).toMatch(/agent\.cordis\.yml is missing/)
  })

  it('skips a directory whose name no preset id could ever claim', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-presets-oddname-'))
    await mkdir(join(root, '.hidden'))
    await mkdir(join(root, 'Has_Caps'))
    await mkdir(join(root, 'usable'))
    await writeFile(join(root, 'usable', COMPOSITION_FILE), '[]\n')

    const found = await scanRoot({ path: root, trust: 'user' })

    // `.hidden` and `Has_Caps` cannot collide with any copy target, so
    // reporting tool residue as broken presets would only train users to
    // ignore the marker.
    expect(found.map(preset => preset.id)).toEqual(['usable'])
  })

  it('records the root trust on every preset it discovers', async () => {
    const found = await scanRoot(USER)

    expect(found.every(preset => preset.trust === 'user')).toBe(true)
  })

  it('lets the earlier root win a duplicate id', async () => {
    const found = await discoverPresets([SYSTEM, USER])

    const standard = found.filter(preset => preset.id === 'standard')
    expect(standard).toHaveLength(1)
    expect(standard[0]?.trust).toBe('system')
  })

  it('treats an absent root as supplying no presets', async () => {
    const found = await scanRoot({ path: join(FIXTURES, 'no-such-root'), trust: 'user' })

    expect(found).toEqual([])
  })

  it('ignores a plain file sitting beside the preset directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-presets-'))
    await writeFile(join(root, 'stray.yml'), '- id: x\n')
    await mkdir(join(root, 'real'))
    await writeFile(join(root, 'real', COMPOSITION_FILE), '[]\n')

    const found = await scanRoot({ path: root, trust: 'user' })

    expect(found.map(preset => preset.id)).toEqual(['real'])
  })

  it('reports a root it cannot read rather than treating it as empty', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-presets-'))
    const notADirectory = join(root, 'file-as-root')
    await writeFile(notADirectory, 'not a directory\n')

    await expect(scanRoot({ path: notADirectory, trust: 'user' }))
      .rejects.toThrow(/cannot read preset root/)
  })

  it('expands a leading tilde in a root path', async () => {
    // `~` alone resolves to the home directory, which exists but holds no
    // preset directories; the point is that it did not throw on a literal `~`.
    const found = await scanRoot({ path: '~/.dsh-agent-presets-absent', trust: 'user' })

    expect(found).toEqual([])
  })
})

describe('composition health', () => {
  /** One directory under a fresh root holding `composition`, scanned. */
  async function scanned(composition: string): Promise<string | undefined> {
    const root = await mkdtemp(join(tmpdir(), 'dsh-presets-health-'))
    await mkdir(join(root, 'probe'))
    await writeFile(join(root, 'probe', COMPOSITION_FILE), composition)
    const [preset] = await scanRoot({ path: root, trust: 'user' })
    return preset?.broken
  }

  it('reports unparsable YAML with the parser\'s reason', async () => {
    expect(await scanned('- id: x\n  name: [unclosed\n')).toMatch(/not valid YAML/)
  })

  it('reports a composition that is not a list of rows', async () => {
    expect(await scanned('name: not-a-list\n')).toMatch(/top-level list of plugin rows/)
  })

  it('reports the first row that names no plugin, by position', async () => {
    expect(await scanned('- id: ok\n  name: some-plugin\n- id: broken\n'))
      .toMatch(/row 2 names no plugin/)
  })

  it('reports a row that is not a map at all', async () => {
    expect(await scanned('- just-a-string\n')).toMatch(/row 1 is not a plugin row/)
  })

  it('descends into a group\'s own row list', async () => {
    const composition = '- id: grp\n  name: cordis:group\n  group: true\n  config:\n    - id: inner\n'
    expect(await scanned(composition)).toMatch(/row 1 row 1 names no plugin/)
  })

  it('reports a group whose config is not a list', async () => {
    const composition = '- id: grp\n  name: cordis:group\n  group: true\n  config: not-a-list\n'
    expect(await scanned(composition)).toMatch(/group row 1 must hold a list/)
  })

  it('accepts a group whose own list is healthy', async () => {
    const composition = '- id: grp\n  name: cordis:group\n  group: true\n  config:\n    - id: inner\n      name: some-plugin\n'
    expect(await scanned(composition)).toBeUndefined()
  })

  it('reports a composition that stats but cannot be read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-presets-unreadable-'))
    await mkdir(join(root, 'sealed'))
    const path = join(root, 'sealed', COMPOSITION_FILE)
    await writeFile(path, '[]\n')
    fsHarness.nextReadError = Object.assign(new Error('EACCES: injected read failure'), { code: 'EACCES' })

    const [preset] = await scanRoot({ path: root, trust: 'user' })

    expect(fsHarness.nextReadError).toBeUndefined()
    expect(preset?.broken).toMatch(/cannot be read/)
  })

  it('accepts the loader dialect, !!js scalars included', async () => {
    // Health must never call a composition broken that the loader accepts:
    // `!!js` is the loader's own extension, so it parses here too.
    const composition = '- id: x\n  name: some-plugin\n  config:\n    value: !!js "1 + 1"\n'
    expect(await scanned(composition)).toBeUndefined()
  })

  it('accepts an empty list', async () => {
    expect(await scanned('[]\n')).toBeUndefined()
  })
})
