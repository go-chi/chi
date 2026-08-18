/**
 * Dependency-free CLI parsing for the standalone mock LLM server.
 * @module @deepseek-ai/dsh-llm-mock-server/cli
 */

import { parseArgs } from 'node:util'
import { MAX_MOCK_LLM_TIMER_DELAY_MS, MOCK_LLM_BEHAVIORS } from './index.ts'
import type {
  ConcreteMockLlmBehavior,
  MockLlmBehavior,
  MockLlmRandomWeights,
  MockLlmServerOptions,
} from './index.ts'

/** Listener lifecycle behavior understood only by the standalone CLI. */
export const CONNECTION_REFUSED_BEHAVIOR = 'connection_refused'

/** Parsed CLI configuration, including a pre-listen unavailable interval. */
export interface MockLlmCliConfig {
  /** Server options after removing the lifecycle-only `connection_refused` entry. */
  readonly server: MockLlmServerOptions
  /** Delay before binding the model port; an integer from zero through the Node timer maximum. */
  readonly listenDelayMs: number
  /** Whether the original sequence requested a true pre-listen refusal phase. */
  readonly startsUnavailable: boolean
}

/** Result of parsing `dsh-llm-mock-server` arguments. */
export type MockLlmCliParseResult =
  | { readonly kind: 'help' }
  | { readonly kind: 'run'; readonly config: MockLlmCliConfig }

const BEHAVIORS = new Set<string>(MOCK_LLM_BEHAVIORS)
const DEFAULT_LISTEN_DELAY_MS = 750

/** Command usage written for `--help` and invalid arguments. */
export const MOCK_LLM_CLI_USAGE = `Usage: dsh-llm-mock-server [options]

Required:
  --sequence <a,b,...>       Ordered behaviors; connection_refused is allowed first

Listener:
  --host <host>              Default 127.0.0.1
  --port <port>              Default 8000; required and nonzero for connection_refused
  --api-key <token>          Validate exact Bearer token when present
  --listen-delay-ms <ms>     Unavailable interval (default 750 with connection_refused)
  --repeat-last              Repeat the final request behavior after exhaustion
  --seed <uint32>            Reproduce random selections
  --random-weights <a=n,...> Relative weights for concrete behaviors

Response:
  --success-text <text>
  --partial-text <text>
  --reasoning-text <text>
  --chunk-size <count>
  --chunk-delay-ms <ms>
  --disconnect-delay-ms <ms>
  --retry-after-ms <ms>
  --request-id <id>
  --tool-name <name>
  --tool-arguments <json>

Other:
  --help
`

function numberValue(option: string, value: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`dsh-llm-mock-server: ${option} must be a finite number`)
  return parsed
}

function boundedIntegerValue(option: string, value: string, min: number, max: number): number {
  const parsed = numberValue(option, value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`dsh-llm-mock-server: ${option} must be an integer between ${min} and ${max}`)
  }
  return parsed
}

function parseSequence(raw: string): { startsUnavailable: boolean; sequence: MockLlmBehavior[] } {
  const entries = raw.split(',').map(entry => entry.trim())
  if (entries.some(entry => entry.length === 0)) {
    throw new Error('dsh-llm-mock-server: --sequence must contain non-empty comma-separated behaviors')
  }
  const startsUnavailable = entries[0] === CONNECTION_REFUSED_BEHAVIOR
  if (entries.slice(1).includes(CONNECTION_REFUSED_BEHAVIOR)) {
    throw new Error('dsh-llm-mock-server: connection_refused is allowed only as the first behavior')
  }
  const requestEntries = startsUnavailable ? entries.slice(1) : entries
  if (requestEntries.length === 0) {
    throw new Error('dsh-llm-mock-server: connection_refused must be followed by a request behavior')
  }
  for (const entry of requestEntries) {
    if (!BEHAVIORS.has(entry)) throw new Error(`dsh-llm-mock-server: unknown behavior ${JSON.stringify(entry)}`)
  }
  return { startsUnavailable, sequence: requestEntries as MockLlmBehavior[] }
}

function parseRandomWeights(raw: string): MockLlmRandomWeights {
  const weights: MockLlmRandomWeights = {}
  for (const entry of raw.split(',')) {
    const [behavior, rawWeight, ...extra] = entry.split('=')
    if (behavior === undefined || behavior === '' || rawWeight === undefined || rawWeight === '' || extra.length > 0) {
      throw new Error('dsh-llm-mock-server: --random-weights expects behavior=weight comma-separated entries')
    }
    if (!BEHAVIORS.has(behavior) || behavior === 'random') {
      throw new Error(`dsh-llm-mock-server: random weight requires a concrete behavior, got ${JSON.stringify(behavior)}`)
    }
    if (Object.hasOwn(weights, behavior)) {
      throw new Error(`dsh-llm-mock-server: duplicate random weight for ${JSON.stringify(behavior)}`)
    }
    weights[behavior as ConcreteMockLlmBehavior] = numberValue('--random-weights', rawWeight)
  }
  return weights
}

/** parseArgs vocabulary: every documented flag; only `--repeat-last` and `--help` are boolean. */
const CLI_OPTIONS = {
  'sequence': { type: 'string' },
  'host': { type: 'string' },
  'port': { type: 'string' },
  'api-key': { type: 'string' },
  'listen-delay-ms': { type: 'string' },
  'repeat-last': { type: 'boolean' },
  'seed': { type: 'string' },
  'random-weights': { type: 'string' },
  'success-text': { type: 'string' },
  'partial-text': { type: 'string' },
  'reasoning-text': { type: 'string' },
  'chunk-size': { type: 'string' },
  'chunk-delay-ms': { type: 'string' },
  'disconnect-delay-ms': { type: 'string' },
  'retry-after-ms': { type: 'string' },
  'request-id': { type: 'string' },
  'tool-name': { type: 'string' },
  'tool-arguments': { type: 'string' },
} as const

/**
 * Parse standalone server arguments without starting a process or listener.
 * Tokenizing rides `node:util` `parseArgs` (strict, no positionals); numeric
 * coercion, bounds, and cross-option constraints remain manual below it.
 * @param argv - arguments after the executable name.
 * @returns help or validated run configuration.
 */
export function parseMockLlmCliArgs(argv: readonly string[]): MockLlmCliParseResult {
  if (argv.includes('--help')) return { kind: 'help' }

  const { values } = parseArgs({ args: [...argv], options: CLI_OPTIONS, strict: true, allowPositionals: false })

  const host = values.host
  const port = values.port === undefined ? 8_000 : numberValue('--port', values.port)
  const apiKey = values['api-key']
  const listenDelayMs = values['listen-delay-ms'] === undefined
    ? undefined
    : boundedIntegerValue('--listen-delay-ms', values['listen-delay-ms'], 0, MAX_MOCK_LLM_TIMER_DELAY_MS)
  const repeatLast = values['repeat-last'] ?? false
  const randomSeed = values.seed === undefined ? undefined : numberValue('--seed', values.seed)
  const randomWeights = values['random-weights'] === undefined ? undefined : parseRandomWeights(values['random-weights'])
  const successText = values['success-text']
  const partialText = values['partial-text']
  const reasoningText = values['reasoning-text']
  const chunkSize = values['chunk-size'] === undefined ? undefined : numberValue('--chunk-size', values['chunk-size'])
  const chunkDelayMs = values['chunk-delay-ms'] === undefined ? undefined : numberValue('--chunk-delay-ms', values['chunk-delay-ms'])
  const disconnectDelayMs = values['disconnect-delay-ms'] === undefined
    ? undefined
    : numberValue('--disconnect-delay-ms', values['disconnect-delay-ms'])
  const retryAfterMs = values['retry-after-ms'] === undefined ? undefined : numberValue('--retry-after-ms', values['retry-after-ms'])
  const requestId = values['request-id']
  const toolName = values['tool-name']
  const toolArguments = values['tool-arguments']

  if (values.sequence === undefined) throw new Error('dsh-llm-mock-server: --sequence is required')
  const sequenceRaw = values.sequence
  const parsedSequence = parseSequence(sequenceRaw)
  if (parsedSequence.startsUnavailable && port === 0) {
    throw new Error('dsh-llm-mock-server: connection_refused requires an explicit nonzero --port')
  }
  if (!parsedSequence.startsUnavailable && listenDelayMs !== undefined) {
    throw new Error('dsh-llm-mock-server: --listen-delay-ms requires connection_refused first in --sequence')
  }
  if (!parsedSequence.sequence.includes('random') && (randomSeed !== undefined || randomWeights !== undefined)) {
    throw new Error('dsh-llm-mock-server: --seed and --random-weights require random in --sequence')
  }

  return {
    kind: 'run',
    config: {
      server: {
        sequence: parsedSequence.sequence,
        port,
        repeatLast,
        ...randomSeed === undefined ? {} : { randomSeed },
        ...randomWeights === undefined ? {} : { randomWeights },
        ...host === undefined ? {} : { host },
        ...apiKey === undefined ? {} : { apiKey },
        ...successText === undefined ? {} : { successText },
        ...partialText === undefined ? {} : { partialText },
        ...reasoningText === undefined ? {} : { reasoningText },
        ...chunkSize === undefined ? {} : { chunkSize },
        ...chunkDelayMs === undefined ? {} : { chunkDelayMs },
        ...disconnectDelayMs === undefined ? {} : { disconnectDelayMs },
        ...retryAfterMs === undefined ? {} : { retryAfterMs },
        ...requestId === undefined ? {} : { requestId },
        ...toolName === undefined ? {} : { toolName },
        ...toolArguments === undefined ? {} : { toolArguments },
      },
      listenDelayMs: parsedSequence.startsUnavailable ? listenDelayMs ?? DEFAULT_LISTEN_DELAY_MS : 0,
      startsUnavailable: parsedSequence.startsUnavailable,
    },
  }
}
