import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http'

/** One deterministic response emitted by the package-private Messages server. */
export type MessagesBehavior =
  | { readonly kind: 'complete'; readonly text: string }
  | { readonly kind: 'hold' }

/** One recorded Anthropic Messages request. */
interface RecordedMessagesRequest {
  readonly method: string
  readonly path: string
  readonly headers: IncomingHttpHeaders
  readonly body: Record<string, unknown>
}

/** Running package-private Anthropic Messages fixture. */
export interface MessagesFixture {
  readonly baseUrl: string
  readonly requests: RecordedMessagesRequest[]
  readonly requestStarted: Promise<void>
  close(): Promise<void>
}

function event(
  response: ServerResponse,
  type: string,
  payload: Record<string, unknown>,
): void {
  response.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`)
}

function complete(
  response: ServerResponse,
  body: Record<string, unknown>,
  text: string,
): void {
  const model = typeof body.model === 'string' ? body.model : 'fixture-model'
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  event(response, 'message_start', {
    type: 'message_start',
    message: {
      id: 'msg_dsh_fixture',
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 7,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  })
  event(response, 'content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  })
  event(response, 'content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text },
  })
  event(response, 'content_block_stop', {
    type: 'content_block_stop',
    index: 0,
  })
  event(response, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 1 },
  })
  event(response, 'message_stop', { type: 'message_stop' })
  response.end()
}

/**
 * Start a loopback-only Anthropic Messages SSE fixture.
 * @param behavior - the single response behavior for this fixture.
 * @returns the bound server and its recorded requests.
 */
export async function startMessagesFixture(
  behavior: MessagesBehavior,
): Promise<MessagesFixture> {
  const requests: RecordedMessagesRequest[] = []
  let requestStartedResolve!: () => void
  const requestStarted = new Promise<void>((resolve) => {
    requestStartedResolve = resolve
  })
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    request.on('end', () => {
      const path = request.url ?? ''
      if (path !== '/v1/messages' && !path.startsWith('/v1/messages?')) {
        response.writeHead(404, { 'content-type': 'application/json' })
        response.end(JSON.stringify({
          type: 'error',
          error: { type: 'not_found_error', message: `unexpected path ${path}` },
        }))
        return
      }
      const text = Buffer.concat(chunks).toString('utf8')
      const body = JSON.parse(text) as Record<string, unknown>
      requests.push({
        method: request.method ?? '',
        path,
        headers: request.headers,
        body,
      })
      requestStartedResolve()
      if (behavior.kind === 'complete') {
        complete(response, body, behavior.text)
      }
      // A hold deliberately leaves the response pending until client abort.
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Messages fixture did not bind a TCP port')
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    requestStarted,
    async close(): Promise<void> {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined) reject(error)
          else resolve()
        })
      })
    },
  }
}
