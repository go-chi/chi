/**
 * REAL-composition coverage: a test-only cordis.yml booted through the
 * vendored Loader mounts the webserver row, and every assertion observes the
 * user-visible HTTP surface of the running server (routing precedence, index
 * taps, fallback-seat semantics, per-request error containment, teardown).
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import HttpServer from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Write a cordis.yml with one webserver row, then boot it through the real Loader. */
async function loadComposition(port = 0): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-webserver-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    `    port: ${String(port)}`,
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

/** GET (by default) one path against the running server; returns status plus a body prefix. */
async function request(port: number, path: string, init?: RequestInit): Promise<{ status: number; body: string }> {
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, init)
  return { status: response.status, body: (await response.text()).slice(0, 80) }
}

/** Open one raw upgrade request and return after the handler writes its response. */
async function upgrade(port: number, path: string): Promise<ReturnType<typeof connect>> {
  const socket = connect(port, '127.0.0.1')
  await once(socket, 'connect')
  const response = once(socket, 'data')
  socket.write([
    `GET ${path} HTTP/1.1`,
    `Host: 127.0.0.1:${String(port)}`,
    'Connection: Upgrade',
    'Upgrade: dsh-test',
    '',
    '',
  ].join('\r\n'))
  const [data] = await response as [Buffer]
  expect(String(data)).toContain('101 Switching Protocols')
  return socket
}

describe('real Loader composition', () => {
  // Real-Loader composition resolves workspace packages through tsx at test
  // time; first resolution after the host/client program split is slow enough
  // to trip the default 5s budget on cold caches.
  it('serves registered routes, index taps, and the fallback-seat semantics', { timeout: 60_000 }, async () => {
    const loaded = await loadComposition()
    const unloaded = [...loaded.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])

    const server = loaded.webServer
    expect(server).toBeInstanceOf(HttpServer)
    const port = server.port
    expect(port).toBeGreaterThan(0)

    // Routing precedence: exact beats prefix, longest prefix wins, a prefix
    // route answers its own path, and routes own their method handling
    // (POST reaches a registered prefix; 405 is fallback-only semantics).
    server.register({ kind: 'exact', path: '/probe', handler: (_req, res) => { res.writeHead(200); res.end('EXACT') } })
    server.register({ kind: 'prefix', path: '/api', handler: (_req, res) => { res.writeHead(200); res.end('API') } })
    server.register({ kind: 'prefix', path: '/api/deep', handler: (_req, res) => { res.writeHead(200); res.end('DEEP') } })
    expect(await request(port, '/probe')).toMatchObject({ status: 200, body: 'EXACT' })
    expect(await request(port, '/api/anything')).toMatchObject({ status: 200, body: 'API' })
    expect(await request(port, '/api/deep/leaf')).toMatchObject({ status: 200, body: 'DEEP' })
    expect(await request(port, '/api')).toMatchObject({ status: 200, body: 'API' })
    expect(await request(port, '/api/anything', { method: 'POST' })).toMatchObject({ status: 200, body: 'API' })

    // Fallback seat: 404 while unclaimed; the owner answers everything no
    // named route matches; index taps are the owner's to apply; the seat
    // admits exactly one owner and the disposer releases it.
    expect((await request(port, '/no/such/route')).status).toBe(404)
    const untap = server.tapIndex(html => html.replace('<head>', '<head><script>window.__T__=1</script>'))
    expect(server.applyIndexTaps('<head></head>')).toContain('__T__')
    const releaseFallback = server.registerFallback((req, res) => {
      // Decode like a real static server would — a malformed %-escape throws
      // here, probing the webserver's per-request error containment.
      decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(server.applyIndexTaps('<head></head><body>shell</body>'))
    })
    expect(() => server.registerFallback(() => {})).toThrow(/fallback already registered/)
    expect((await request(port, '/no/such/route')).body).toContain('__T__')
    untap()
    expect((await request(port, '/no/such/route')).body).not.toContain('__T__')
    expect((await request(port, '/no/such/route')).body).toContain('shell')

    // Per-request error containment: a malformed %-escape answers 400 and the
    // server keeps serving afterwards (no process-level failure path).
    expect((await request(port, '/%zz')).status).toBe(400)
    expect(await request(port, '/probe')).toMatchObject({ status: 200, body: 'EXACT' })

    // Duplicate (kind, path) is a misconfiguration and throws; the disposer
    // restores registrability (register/disposer symmetry).
    expect(() => server.register({ kind: 'exact', path: '/probe', handler: () => {} }))
      .toThrow(/duplicate exact route/)
    const disposeOnce = server.register({ kind: 'exact', path: '/once', handler: (_req, res) => { res.writeHead(200); res.end('ONCE') } })
    expect(await request(port, '/once')).toMatchObject({ status: 200, body: 'ONCE' })
    disposeOnce()
    expect((await request(port, '/once')).body).toContain('shell') // back to the fallback owner
    expect(() => server.register({ kind: 'exact', path: '/once', handler: () => {} })).not.toThrow()

    // Releasing the seat restores the unclaimed 404 and registrability.
    releaseFallback()
    expect((await request(port, '/no/such/route')).status).toBe(404)
    expect(() => server.registerFallback(() => {})).not.toThrow()

    // Upgrade routes match exact pathnames, reject duplicate ownership, and
    // become registrable again after disposal. The accepted socket stays open
    // so the teardown assertion also covers upgraded-connection ownership.
    let upgradedServerClosed = false
    const disposeUpgrade = server.registerUpgrade({
      path: '/events',
      handler: (_req, socket) => {
        socket.once('close', () => { upgradedServerClosed = true })
        socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: dsh-test\r\n\r\n')
      },
    })
    expect(() => server.registerUpgrade({ path: '/events', handler: () => {} }))
      .toThrow(/duplicate upgrade route/)
    const upgraded = await upgrade(port, '/events?stream=mux')
    disposeUpgrade()
    expect(() => server.registerUpgrade({ path: '/events', handler: () => {} })).not.toThrow()

    // The webserver contains raw-socket errors even before an upgrade handler
    // has installed its protocol implementation.
    server.registerUpgrade({
      path: '/upgrade-error',
      handler: async (_req, socket) => {
        await Promise.resolve()
        socket.destroy(new Error('test upgrade transport failure'))
      },
    })
    const failedUpgrade = connect(port, '127.0.0.1')
    failedUpgrade.on('error', () => { /* The server-side reset is the fixture outcome. */ })
    await once(failedUpgrade, 'connect')
    const failedUpgradeClosed = once(failedUpgrade, 'close')
    failedUpgrade.write([
      'GET /upgrade-error HTTP/1.1',
      `Host: 127.0.0.1:${String(port)}`,
      'Connection: Upgrade',
      'Upgrade: dsh-test',
      '',
      '',
    ].join('\r\n'))
    await failedUpgradeClosed
    expect(await request(port, '/probe')).toMatchObject({ status: 200, body: 'EXACT' })

    // Teardown closes both ordinary and upgraded sockets before it resolves.
    await loaded.fiber.dispose()
    expect(upgradedServerClosed).toBe(true)
    upgraded.destroy()
    await expect(request(port, '/probe')).rejects.toThrow()
  })

  it('fails the fiber when the port is already taken (fail-loud at activation)', { timeout: 60_000 }, async () => {
    const first = await loadComposition()
    const takenPort = first.webServer.port
    const firstRoot = root
    root = undefined // keep the first composition's files until the end

    let second: Context | undefined
    try {
      let failure: unknown
      try {
        await loadComposition(takenPort)
      } catch (error) {
        failure = error
      }
      second = context
      expect(String(failure)).toMatch(/failed to apply loader entry.*EADDRINUSE/)
    } finally {
      await second?.fiber.dispose()
      context = first
      if (root !== undefined) await rm(root, { recursive: true, force: true })
      root = firstRoot
    }
  })
})
