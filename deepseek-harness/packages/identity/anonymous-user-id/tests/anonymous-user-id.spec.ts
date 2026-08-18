import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ANONYMOUS_USER_ID_FILE_NAME,
  getOrCreateAnonymousUserId,
} from '../src/index.ts'

const dirs: string[] = []

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-userid-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('getOrCreateAnonymousUserId', () => {
  it('creates, persists, and returns a bare UUID line on first use', () => {
    const home = tempHome()
    const id = getOrCreateAnonymousUserId({ env: { DSH_HOME: home } })
    expect(id).toMatch(UUID)
    expect(readFileSync(join(home, ANONYMOUS_USER_ID_FILE_NAME), 'utf8')).toBe(`${id}\n`)
  })

  it('creates the home directory when missing', () => {
    const home = join(tempHome(), 'nested', 'home')
    const id = getOrCreateAnonymousUserId({ env: { DSH_HOME: home } })
    expect(readFileSync(join(home, ANONYMOUS_USER_ID_FILE_NAME), 'utf8')).toBe(`${id}\n`)
  })

  it('returns the persisted id on subsequent calls, tolerating surrounding whitespace', () => {
    const home = tempHome()
    const existing = '01234567-89ab-4cde-8f01-23456789abcd'
    writeFileSync(join(home, ANONYMOUS_USER_ID_FILE_NAME), `  ${existing}\n\n`, 'utf8')
    expect(getOrCreateAnonymousUserId({ env: { DSH_HOME: home } })).toBe(existing)
  })

  it('overwrites a corrupt file with a fresh id', () => {
    const home = tempHome()
    writeFileSync(join(home, ANONYMOUS_USER_ID_FILE_NAME), 'not-a-uuid\n', 'utf8')
    const id = getOrCreateAnonymousUserId({ env: { DSH_HOME: home } })
    expect(id).toMatch(UUID)
    expect(readFileSync(join(home, ANONYMOUS_USER_ID_FILE_NAME), 'utf8')).toBe(`${id}\n`)
  })

  it('adopts a concurrent winner: exclusive create loses to an id written after the initial read', () => {
    const home = tempHome()
    const winner = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    const file = join(home, ANONYMOUS_USER_ID_FILE_NAME)
    // The generator hook runs between the initial read (absent) and the wx
    // write, so planting the winner here simulates the concurrent first launch.
    const id = getOrCreateAnonymousUserId({
      env: { DSH_HOME: home },
      randomUUID: () => {
        writeFileSync(file, `${winner}\n`, 'utf8')
        return 'ffffffff-0000-4000-8000-000000000000'
      },
    })
    expect(id).toBe(winner)
  })

  it('returns a usable id when the home cannot contain files, without persisting', () => {
    const home = tempHome()
    const blocked = join(home, 'blocked')
    writeFileSync(blocked, 'occupied\n')
    const id = getOrCreateAnonymousUserId({ env: { DSH_HOME: blocked } })
    expect(id).toMatch(UUID)
    expect(existsSync(join(blocked, ANONYMOUS_USER_ID_FILE_NAME))).toBe(false)
  })

  it('memoizes per resolved home for the process lifetime: one read, deletion-proof', () => {
    const home = tempHome()
    const first = getOrCreateAnonymousUserId({ env: { DSH_HOME: home } })
    rmSync(join(home, ANONYMOUS_USER_ID_FILE_NAME))
    expect(getOrCreateAnonymousUserId({ env: { DSH_HOME: home } })).toBe(first)
  })

  it('keeps distinct homes on distinct ids', () => {
    const a = getOrCreateAnonymousUserId({ env: { DSH_HOME: tempHome() } })
    const b = getOrCreateAnonymousUserId({ env: { DSH_HOME: tempHome() } })
    expect(a).not.toBe(b)
  })

  it('reads process.env by default', () => {
    const home = tempHome()
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const id = getOrCreateAnonymousUserId()
      expect(readFileSync(join(home, ANONYMOUS_USER_ID_FILE_NAME), 'utf8')).toBe(`${id}\n`)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })
})
