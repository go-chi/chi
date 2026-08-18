/** Deterministic in-memory PTY backend for transcript snapshots. */

class SnapshotSession {
  motd = 'dsh> '
  statusValue = { kind: 'running' }
  scrollback = 'dsh> '

  startSend(request) {
    const viewport = `${request.text}\nPTY_OK\ndsh> `
    this.scrollback += viewport
    const result = {
      viewport,
      waitReason: 'stdin_read',
      sessionStatus: this.statusValue,
      truncated: false,
    }
    let consumed = false
    return {
      done: Promise.resolve(result),
      readOutput: () => {
        if (consumed) return { delta: '', truncated: false }
        consumed = true
        return { delta: viewport, truncated: false }
      },
      cancel: () => false,
    }
  }

  read(request) {
    const lines = this.scrollback.split('\n')
    const offset = request.offset ?? 0
    const count = request.count ?? 500
    const end = lines.length - offset
    const start = Math.max(0, end - count)
    const text = lines.slice(start, end).join('\n')
    return { text, totalLines: lines.length, lineBegin: offset, lineEnd: offset + text.split('\n').length, truncated: false }
  }

  signal() {
    return Promise.resolve({ delivered: true, targetPgid: 1 })
  }

  status() {
    return this.statusValue
  }

  close() {
    this.statusValue = { kind: 'exited', exitCode: 0, signal: null }
    return Promise.resolve()
  }
}

/** Cordis plugin name. */
export const name = 'pty-snapshot-backend'
/** Required PTY service. */
export const inject = ['terminals']

/** Register the deterministic snapshot backend. */
export function apply(ctx) {
  ctx.terminals.registerBackend({
    type: 'shell',
    spawn: () => Promise.resolve(new SnapshotSession()),
  })
}
