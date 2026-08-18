import { Buffer } from 'node:buffer'

let pending = Buffer.alloc(0)
let source = ''
let sourceUri = ''

function send(message) {
  const body = Buffer.from(JSON.stringify(message))
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`)
  process.stdout.write(body)
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function dispatch(message) {
  switch (message.method) {
    case 'initialize':
      respond(message.id, {
        capabilities: {
          positionEncoding: 'utf-16',
          textDocumentSync: { openClose: true, change: 1 },
          definitionProvider: true,
          referencesProvider: true,
          implementationProvider: true,
          hoverProvider: true,
        },
      })
      return
    case 'textDocument/didOpen':
      source = message.params.textDocument.text
      sourceUri = message.params.textDocument.uri
      return
    case 'textDocument/didClose':
      source = ''
      sourceUri = ''
      return
    case 'textDocument/hover':
      if (!source.includes('const café = "你好"')) {
        send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'multibyte source was corrupted' } })
        return
      }
      respond(message.id, {
        contents: { kind: 'markdown', value: '**remote hover** 你好 café' },
        range: { start: { line: 0, character: 6 }, end: { line: 0, character: 10 } },
      })
      return
    case 'textDocument/definition':
    case 'textDocument/references':
    case 'textDocument/implementation':
      respond(message.id, [{
        uri: sourceUri,
        range: { start: { line: 0, character: 6 }, end: { line: 0, character: 10 } },
      }])
      return
    case 'shutdown':
      respond(message.id, null)
      return
    case 'exit':
      process.exit(0)
      return
  }
}

function drain() {
  for (;;) {
    const headerEnd = pending.indexOf('\r\n\r\n')
    if (headerEnd < 0) return
    const header = pending.subarray(0, headerEnd).toString('ascii')
    const match = /(?:^|\r\n)Content-Length: ([0-9]+)(?:\r\n|$)/i.exec(header)
    if (!match) throw new Error('missing Content-Length')
    const length = Number(match[1])
    const bodyStart = headerEnd + 4
    if (pending.length < bodyStart + length) return
    const body = pending.subarray(bodyStart, bodyStart + length)
    pending = pending.subarray(bodyStart + length)
    dispatch(JSON.parse(body.toString('utf8')))
  }
}

process.stdin.on('data', chunk => {
  pending = Buffer.concat([pending, chunk])
  drain()
})
