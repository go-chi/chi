import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

let buffered = Buffer.alloc(0)

function frame(message) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }))
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body])
}

function location(line) {
  return {
    uri: pathToFileURL(resolve('subject.ts')).href,
    range: { start: { line, character: 6 }, end: { line, character: 12 } },
  }
}

function handle(message) {
  switch (message.method) {
    case 'initialize':
      process.stdout.write(frame({
        id: message.id,
        result: {
          capabilities: {
            positionEncoding: 'utf-16',
            textDocumentSync: 1,
            definitionProvider: true,
          },
        },
      }))
      break
    case 'textDocument/definition':
      process.stdout.write(frame({ id: message.id, result: [location(0), location(1)] }))
      break
    case 'shutdown':
      process.stdout.write(frame({ id: message.id, result: null }))
      break
    case 'exit':
      process.exit(0)
  }
}

process.stdin.on('data', (chunk) => {
  buffered = Buffer.concat([buffered, chunk])
  for (;;) {
    const headerEnd = buffered.indexOf('\r\n\r\n')
    if (headerEnd < 0) return
    const match = /Content-Length: (\d+)/i.exec(buffered.toString('ascii', 0, headerEnd))
    if (match === null) throw new Error('missing Content-Length')
    const length = Number(match[1])
    const bodyStart = headerEnd + 4
    if (buffered.length < bodyStart + length) return
    const message = JSON.parse(buffered.toString('utf8', bodyStart, bodyStart + length))
    buffered = buffered.subarray(bodyStart + length)
    handle(message)
  }
})
