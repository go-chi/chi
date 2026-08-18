/**
 * quoteArg unit tests plus a round-trip through the REAL CommandLineToArgvW
 * parser (shell32.dll, shellapi.h line ~867:
 * `LPWSTR *CommandLineToArgvW(LPCWSTR lpCmdLine, int *pNumArgs)`) on win32.
 *
 * CommandLineToArgvW applies the documented backslash rule (2n backslashes
 * before a quote produce n backslashes and toggle quoting; 2n+1 produce n
 * backslashes and a literal quote) to every token EXCEPT the first — the
 * first token is parsed with backslashes literal and quotes toggling
 * (verified empirically on this machine, Windows 11 build 26200). The
 * round-trip therefore prepends a plain program token, exactly like
 * buildCommandLine's real callers do, so the arguments under test land on
 * the rule-applying tokens.
 *
 * Reading argv from CommandLineToArgvW: koffi cannot decode the returned
 * LPWSTR* contents directly (the pointed-to strings are not koffi-registered
 * references), so each string is copied with lstrcpynW (winbase.h line
 * ~1500) into a Node Buffer and read as UTF-16LE; lengths come from
 * lstrlenW (winbase.h line ~1506); the argv block is freed with LocalFree
 * (winbase.h line ~1127) — CommandLineToArgvW's documented contract.
 */

import { describe, expect, it } from 'vitest'

import { buildCommandLine, quoteArg } from '../src/spawn.ts'

const isWin32 = process.platform === 'win32'

/**
 * Table cases: input argv entry → the exact command-line fragment quoteArg
 * must produce. Trailing-backslash inputs are the regression: the closing
 * quote must be preceded by DOUBLED backslashes, or the parser reads them as
 * escaping the closing quote.
 */
const cases: Array<[input: string, quoted: string]> = [
  ['', '""'],
  ['a', 'a'],
  ['a b', '"a b"'],
  ['a"b', '"a\\"b"'],
  ['a\\b', 'a\\b'],
  ['a b\\', '"a b\\\\"'],
  ['a b\\\\', '"a b\\\\\\\\"'],
  ['a b\\\\\\', '"a b\\\\\\\\\\\\"'],
  ['a\\\\"b', '"a\\\\\\\\\\"b"'],
]

describe('quoteArg', () => {
  it.each(cases)('quotes %j as %j', (input, quoted) => {
    expect(quoteArg(input)).toBe(quoted)
  })
})

describe.skipIf(!isWin32)('CommandLineToArgvW round-trip', () => {
  it('parses quoteArg+join back to the exact original argv', async () => {
    const { default: koffi } = await import('koffi')
    const PVOID = koffi.pointer('void')
    const shell32 = koffi.load('shell32.dll')
    const kernel32 = koffi.load('kernel32.dll')
    const commandLineToArgvW = shell32.func('__stdcall', 'CommandLineToArgvW', PVOID, ['str16', koffi.pointer('int')])
    const lstrcpynW = kernel32.func('__stdcall', 'lstrcpynW', PVOID, [PVOID, PVOID, 'int'])
    const lstrlenW = kernel32.func('__stdcall', 'lstrlenW', 'int', [PVOID])
    const localFree = kernel32.func('__stdcall', 'LocalFree', PVOID, [PVOID])

    const parse = (commandLine: string): string[] => {
      const countSlot = koffi.alloc('int', 1) as unknown
      const argvBlock = commandLineToArgvW(commandLine, countSlot) as unknown
      try {
        if (argvBlock === null) throw new Error('CommandLineToArgvW returned NULL')
        const count = koffi.decode(countSlot, 0, 'int') as number
        const table = Buffer.from(koffi.view(argvBlock, count * 8))
        const parsed: string[] = []
        for (let index = 0; index < count; index++) {
          const stringAddress = table.readBigUInt64LE(index * 8)
          const copied = Buffer.alloc(2048)
          lstrcpynW(copied, stringAddress, copied.length / 2)
          const length = lstrlenW(copied) as number
          parsed.push(copied.subarray(0, length * 2).toString('utf16le'))
        }
        return parsed
      } finally {
        localFree(argvBlock)
      }
    }

    const argv = ['', 'a', 'a b', 'a"b', 'a\\b', 'a b\\', 'a b\\\\', 'a b\\\\\\', 'a\\\\"b']
    expect(parse(buildCommandLine('prog.exe', argv))).toEqual(['prog.exe', ...argv])
  })
})
