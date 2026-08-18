import { describe, expect, it } from 'vitest'
import {
  MOCK_LLM_CLI_USAGE,
  parseMockLlmCliArgs,
} from '../src/cli.ts'

describe('mock LLM server CLI parser', () => {
  it('returns help without requiring a sequence', () => {
    expect(parseMockLlmCliArgs(['--help'])).toEqual({ kind: 'help' })
    expect(MOCK_LLM_CLI_USAGE).toContain('--sequence')
  })

  it('parses every request and listener option', () => {
    expect(parseMockLlmCliArgs([
      '--sequence', 'connection_refused,partial_disconnect,success',
      '--host', 'localhost',
      '--port', '9010',
      '--api-key', 'mock-key',
      '--listen-delay-ms', '100',
      '--repeat-last',
      '--success-text', 'done',
      '--partial-text', 'half',
      '--reasoning-text', 'think',
      '--chunk-size', '2',
      '--chunk-delay-ms', '3',
      '--disconnect-delay-ms', '4',
      '--retry-after-ms', '5000',
      '--request-id', 'request-1',
      '--tool-name', 'lookup',
      '--tool-arguments', '{"id":1}',
    ])).toEqual({
      kind: 'run',
      config: {
        startsUnavailable: true,
        listenDelayMs: 100,
        server: {
          sequence: ['partial_disconnect', 'success'],
          host: 'localhost',
          port: 9010,
          apiKey: 'mock-key',
          repeatLast: true,
          successText: 'done',
          partialText: 'half',
          reasoningText: 'think',
          chunkSize: 2,
          chunkDelayMs: 3,
          disconnectDelayMs: 4,
          retryAfterMs: 5000,
          requestId: 'request-1',
          toolName: 'lookup',
          toolArguments: '{"id":1}',
        },
      },
    })
  })

  it('uses standalone defaults for an ordinary sequence', () => {
    expect(parseMockLlmCliArgs(['--sequence', 'success'])).toEqual({
      kind: 'run',
      config: {
        startsUnavailable: false,
        listenDelayMs: 0,
        server: {
          sequence: ['success'],
          port: 8000,
          repeatLast: false,
        },
      },
    })
  })

  it('uses the default unavailable interval', () => {
    const result = parseMockLlmCliArgs(['--sequence', 'connection_refused,success', '--port', '8001'])
    expect(result).toMatchObject({
      kind: 'run',
      config: { startsUnavailable: true, listenDelayMs: 750 },
    })
  })

  it('parses a reproducible weighted random profile', () => {
    expect(parseMockLlmCliArgs([
      '--sequence', 'random',
      '--repeat-last',
      '--seed', '42',
      '--random-weights', 'success=8,partial_disconnect=2',
    ])).toEqual({
      kind: 'run',
      config: {
        startsUnavailable: false,
        listenDelayMs: 0,
        server: {
          sequence: ['random'],
          port: 8000,
          repeatLast: true,
          randomSeed: 42,
          randomWeights: { success: 8, partial_disconnect: 2 },
        },
      },
    })
  })

  it.each([
    [[], /--sequence is required/],
    // Tokenizer-level failures carry node:util parseArgs's own messages.
    [['--wat'], /Unknown option '--wat'/],
    [['--wat', 'x'], /Unknown option '--wat'/],
    [['--port'], /Option '--port <value>' argument missing/],
    [['--sequence', 'success', 'stray'], /Unexpected argument 'stray'/],
    [['--port', 'NaN', '--sequence', 'success'], /finite number/],
    [['--sequence', 'success,'], /non-empty/],
    [['--sequence', 'success,connection_refused'], /only as the first/],
    [['--sequence', 'connection_refused'], /must be followed/],
    [['--sequence', 'unknown'], /unknown behavior/],
    [['--sequence', 'connection_refused,success', '--port', '0'], /nonzero/],
    [['--sequence', 'success', '--listen-delay-ms', '5'], /requires connection_refused/],
    // `=` syntax: a space-separated leading-dash value is a tokenizer error, not a bounds probe.
    [['--sequence', 'connection_refused,success', '--listen-delay-ms=-1'], /integer between 0 and 2147483647/],
    [['--sequence', 'connection_refused,success', '--listen-delay-ms', '1.5'], /integer between 0 and 2147483647/],
    [['--sequence', 'connection_refused,success', '--listen-delay-ms', '2147483648'], /integer between 0 and 2147483647/],
    [['--sequence', 'success', '--seed', '1'], /require random/],
    [['--sequence', 'random', '--random-weights', 'success'], /expects behavior=weight/],
    [['--sequence', 'random', '--random-weights', 'random=1'], /concrete behavior/],
    [['--sequence', 'random', '--random-weights', 'success=1,success=2'], /duplicate/],
    [['--sequence', 'random', '--random-weights', 'success=nope'], /finite number/],
  ])('rejects invalid argv %#', (argv, expected) => {
    expect(() => parseMockLlmCliArgs(argv)).toThrow(expected)
  })
})
