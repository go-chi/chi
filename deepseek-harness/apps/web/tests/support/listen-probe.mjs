import { appendFileSync } from 'node:fs'
import { Server } from 'node:net'

const marker = process.env.DSH_LISTEN_PROBE_MARKER
const listen = Server.prototype.listen
Server.prototype.listen = function (...args) {
  if (marker !== undefined) appendFileSync(marker, 'listen\n')
  return listen.apply(this, args)
}
