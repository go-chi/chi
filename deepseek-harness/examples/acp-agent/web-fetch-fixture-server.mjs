/**
 * Deterministic loopback HTTP fixture for the web-fetch snapshot scenario: a
 * small HTML page (headings, named entities, a GFM table, nested formatting)
 * on a fixed port, so recording and keyless replay drive the REAL
 * `dsh-web-fetch-http` transport and `dsh-tool-web` markdown rendering
 * without external network. The port is fixed because the fetched URL is part
 * of the recorded model transcript.
 */
import { createServer } from 'node:http'

/** Fixed loopback port the scenario prompt points `web_fetch` at. */
const PORT = 43117

const PAGE = `<!doctype html>
<html><head><title>Menu</title><style>.x{color:red}</style><script>ignored()</script></head>
<body>
<h1>Caf&eacute; menu</h1>
<p>Prices include <strong>service &amp; <em>tax</em></strong> &mdash; updated daily.</p>
<ul><li>Espresso</li><li>Flat white</li></ul>
<table><thead><tr><th>Drink</th><th>Price</th></tr></thead><tbody><tr><td>Espresso</td><td>&euro;2</td></tr><tr><td>Flat white</td><td>&euro;3</td></tr></tbody></table>
<p>See <a href="https://fixture.invalid/specials">today&rsquo;s specials</a>.</p>
</body></html>
`

/** Cordis plugin name. */
export const name = 'web-fetch-fixture-server'

/**
 * Start the fixture server on 127.0.0.1 and register its shutdown.
 * @param ctx - Cordis context; the effect disposes the server with the fiber.
 */
export async function apply(ctx) {
  const server = createServer((req, res) => {
    if (req.url === '/menu.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(PAGE)
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(PORT, '127.0.0.1', () => resolve(undefined))
  })
  // The fixture must never hold the process open past protocol shutdown.
  server.unref()
  ctx.effect(() => async () => {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve(undefined))
      // Stop accepting first so a connection cannot arrive after the forced close.
      server.closeAllConnections()
    })
  }, 'web-fetch-fixture-server')
}
