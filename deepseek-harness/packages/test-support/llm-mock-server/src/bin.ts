#!/usr/bin/env node
/**
 * Standalone process wrapper for the scriptable mock LLM server.
 * @module @deepseek-ai/dsh-llm-mock-server/src/bin
 */

import { setTimeout as delay } from 'node:timers/promises'
import { MOCK_LLM_CLI_USAGE, parseMockLlmCliArgs } from './cli.ts'
import { startMockLlmServer } from './index.ts'

/* v8 ignore start -- thin process/signal glue; parser and server behavior are covered directly */
try {
  const parsed = parseMockLlmCliArgs(process.argv.slice(2))
  if (parsed.kind === 'help') {
    process.stdout.write(MOCK_LLM_CLI_USAGE)
  } else {
    const { server: serverOptions, listenDelayMs, startsUnavailable } = parsed.config
    const host = serverOptions.host ?? '127.0.0.1'
    const port = serverOptions.port ?? 8_000
    if (startsUnavailable) {
      process.stdout.write(`${JSON.stringify({
        type: 'unavailable',
        baseURL: `http://${host}:${port}/v1`,
        listenDelayMs,
      })}\n`)
      await delay(listenDelayMs)
    }
    const server = await startMockLlmServer({
      ...serverOptions,
      onEvent: (event) => { process.stdout.write(`${JSON.stringify(event)}\n`) },
    })
    process.stdout.write(`${JSON.stringify({
      type: 'ready',
      baseURL: `${server.baseURL}/v1`,
      randomSeed: server.randomSeed,
    })}\n`)
    let closing = false
    const close = (code: number): void => {
      if (closing) return
      closing = true
      void server.close().finally(() => { process.exit(code) })
    }
    process.on('SIGINT', () => { close(130) })
    process.on('SIGTERM', () => { close(143) })
  }
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${MOCK_LLM_CLI_USAGE}`)
  process.exitCode = 1
}
/* v8 ignore stop */
