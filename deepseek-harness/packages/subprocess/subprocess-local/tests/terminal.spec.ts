import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IDisposable, IPty } from 'node-pty'
import { LocalTerminalHandle } from '@deepseek-ai/dsh-subprocess-local/src/terminal.ts'
import type {
  ProcessIdentity,
  ProcessInspector,
} from '@deepseek-ai/dsh-subprocess-local/src/process-inspector.ts'
import type { SubprocessTerminalSignal } from '@deepseek-ai/dsh-subprocess'

class FakePty {
  pid = 123
  readonly writes: string[] = []
  readonly kills: string[] = []
  autoExitOnKill = true
  throwKill = false
  onKill?: () => void
  private readonly dataListeners = new Set<(data: string) => void>()
  private readonly exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>()

  readonly onData = (listener: (data: string) => void): IDisposable => {
    this.dataListeners.add(listener)
    return { dispose: () => { this.dataListeners.delete(listener) } }
  }

  readonly onExit = (listener: (event: { exitCode: number; signal?: number }) => void): IDisposable => {
    this.exitListeners.add(listener)
    return { dispose: () => { this.exitListeners.delete(listener) } }
  }

  emitData(data: string): void {
    for (const listener of this.dataListeners) listener(data)
  }

  emitExit(exitCode = 0, signal?: number): void {
    for (const listener of this.exitListeners) listener({ exitCode, ...signal === undefined ? {} : { signal } })
  }

  write(data: string): void { this.writes.push(data) }

  kill(signal?: string): void {
    if (this.throwKill) throw new Error('process raced')
    this.kills.push(signal ?? 'SIGHUP')
    this.onKill?.()
    if (this.autoExitOnKill) this.emitExit(0, signal === 'SIGKILL' ? 9 : 15)
  }

  asPty(): IPty {
    return this as unknown as IPty
  }
}

class FakeInspector implements ProcessInspector {
  pgid: number | undefined = 456
  waiting = false
  /** The shell's own row, present like the real /proc- and ps-backed scans; tests recycle or drop it. */
  root: ProcessIdentity | undefined = { pid: 123, started: 'shell' }
  members: ProcessIdentity[] = []
  sessionMembers: ProcessIdentity[] = []
  readonly alive = new Set<number>()
  readonly groups: Array<[number, SubprocessTerminalSignal]> = []
  readonly processes: Array<[number, 'SIGTERM' | 'SIGKILL']> = []
  throwGroup = false
  throwProcess = false
  removeOnSignal = true

  foregroundPgid() { return this.pgid }
  isStdinWaiting() { return this.waiting }
  processTree() { return this.root === undefined ? this.members : [this.root, ...this.members] }
  processSession() { return this.sessionMembers }
  isAlive(identity: ProcessIdentity) { return this.alive.has(identity.pid) }
  signalGroup(pgid: number, signal: SubprocessTerminalSignal) {
    if (this.throwGroup) throw new Error('group failed')
    this.groups.push([pgid, signal])
  }
  signalProcess(identity: ProcessIdentity, signal: 'SIGTERM' | 'SIGKILL') {
    if (this.throwProcess) throw new Error('process raced')
    if (!this.isAlive(identity)) return
    this.processes.push([identity.pid, signal])
    if (this.removeOnSignal) this.alive.delete(identity.pid)
  }
}

afterEach(() => { vi.useRealTimers() })

describe('LocalTerminalHandle', () => {
  it('force-kills descendants around the shell during synchronous host exit', () => {
    const pty = new FakePty()
    const inspector = new FakeInspector()
    const first = { pid: 124, started: 'first' }
    const late = { pid: 125, started: 'late' }
    inspector.members = [first]
    inspector.alive.add(pty.pid)
    inspector.alive.add(first.pid)
    const signalProcess = inspector.signalProcess.bind(inspector)
    inspector.signalProcess = (identity, signal) => {
      signalProcess(identity, signal)
      if (identity.pid === pty.pid) {
        inspector.members = [first, late]
        inspector.alive.add(late.pid)
      }
    }
    const handle = new LocalTerminalHandle(pty.asPty(), inspector, 10)

    handle.terminateForHostExit()
    expect(inspector.processes).toEqual([
      [first.pid, 'SIGKILL'],
      [pty.pid, 'SIGKILL'],
      [late.pid, 'SIGKILL'],
    ])
    expect(pty.kills).toEqual([])

    pty.emitExit()
    handle.terminateForHostExit()
    expect(pty.kills).toEqual([])
  })

  it('uses captured identities and contains shell races when final inspection fails', async () => {
    const pty = new FakePty()
    const inspector = new FakeInspector()
    const captured = { pid: 124, started: 'captured' }
    inspector.members = [captured]
    inspector.alive.add(pty.pid)
    inspector.alive.add(captured.pid)
    const handle = new LocalTerminalHandle(pty.asPty(), inspector, 10)
    await handle.inspectForeground()
    inspector.processTree = () => { throw new Error('process table unavailable') }
    inspector.throwProcess = true

    expect(() => { handle.terminateForHostExit() }).not.toThrow()
    expect(inspector.processes).toEqual([])
    expect(pty.kills).toEqual([])
  })

  it('uses node-pty only when the shell start identity was unavailable', () => {
    const pty = new FakePty()
    const inspector = new FakeInspector()
    inspector.root = undefined
    const handle = new LocalTerminalHandle(pty.asPty(), inspector, 10)

    handle.terminateForHostExit()
    expect(pty.kills).toEqual(['SIGKILL'])

    const racingPty = new FakePty()
    const racingInspector = new FakeInspector()
    racingInspector.root = undefined
    racingPty.throwKill = true
    const racingHandle = new LocalTerminalHandle(racingPty.asPty(), racingInspector, 10)
    expect(() => { racingHandle.terminateForHostExit() }).not.toThrow()
  })

  it('does not signal a recycled terminal root before its delayed exit callback', () => {
    const pty = new FakePty()
    const inspector = new FakeInspector()
    inspector.alive.add(pty.pid)
    const handle = new LocalTerminalHandle(pty.asPty(), inspector, 10)
    inspector.root = { pid: pty.pid, started: 'recycled' }
    inspector.isAlive = identity => identity.started === 'recycled'

    handle.terminateForHostExit()

    expect(inspector.processes).toEqual([])
    expect(pty.kills).toEqual([])
  })

  it('bridges terminal bytes, foreground control, and signalled exit facts', async () => {
    const pty = new FakePty()
    const inspector = new FakeInspector()
    inspector.waiting = true
    const handle = new LocalTerminalHandle(pty.asPty(), inspector, 10)
    const chunks: Buffer[] = []
    handle.output.on('data', (chunk: Buffer) => { chunks.push(chunk) })

    pty.emitData('hello €')
    await handle.write('input\r')
    expect(pty.writes).toEqual(['input\r'])
    expect(await handle.inspectForeground()).toEqual({ processGroupId: 456, inputWaiting: true })
    expect(await handle.signalForeground('SIGINT')).toBe(456)
    expect(inspector.groups).toEqual([[456, 'SIGINT']])

    pty.emitExit(7, 9)
    pty.emitExit(0)
    expect(await handle.done).toEqual({ exitCode: null, signal: 'SIGKILL' })
    await handle.terminate()
    expect(Buffer.concat(chunks).toString('utf8')).toBe('hello €')
  })

  it('rejects unsafe foreground signals and writes after exit', async () => {
    const pty = new FakePty()
    const inspector = new FakeInspector()
    const handle = new LocalTerminalHandle(pty.asPty(), inspector, 10)
    inspector.pgid = handle.pid
    await expect(handle.signalForeground('SIGKILL')).rejects.toThrow('terminate the terminal session')
    inspector.pgid = undefined
    expect(await handle.inspectForeground()).toBeUndefined()
    await expect(handle.signalForeground('SIGTERM')).rejects.toThrow('cannot resolve')

    pty.emitExit(3)
    expect(await handle.done).toEqual({ exitCode: 3, signal: null })
    await handle.terminate()
    await expect(handle.write('late')).rejects.toThrow('has exited')
  })

  it('keeps the shell alive until forced descendants leave', async () => {
    vi.useFakeTimers()
    const pty = new FakePty()
    const inspector = new FakeInspector()
    inspector.members = [{ pid: 124, started: 'child' }]
    inspector.alive.add(124)
    inspector.removeOnSignal = false
    const handle = new LocalTerminalHandle(pty.asPty(), inspector, 20)

    const quiescent = handle.terminate()
    expect(handle.terminate()).toBe(quiescent)
    await vi.advanceTimersByTimeAsync(20)
    expect(inspector.processes).toContainEqual([124, 'SIGKILL'])
    expect(pty.kills).toEqual([])

    inspector.alive.delete(124)
    await vi.advanceTimersByTimeAsync(20)
    await quiescent
    expect(pty.kills).toEqual(['SIGTERM'])
  })

  it('keeps an early exit wait pending through descendant cleanup', async () => {
    vi.useFakeTimers()
    const pty = new FakePty()
    const inspector = new FakeInspector()
    inspector.members = [{ pid: 124, started: 'child' }]
    inspector.alive.add(124)
    inspector.removeOnSignal = false
    const handle = new LocalTerminalHandle(pty.asPty(), inspector, 20)
    pty.emitExit()
    const waiting = handle.terminate()
    let settled = false
    void waiting.then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(10)
    expect(settled).toBe(false)

    inspector.alive.delete(124)
    await vi.advanceTimersByTimeAsync(20)
    await waiting
  })

  it('cleans a same-session descendant after the top-level shell exits naturally', async () => {
    const pty = new FakePty()
    const inspector = new FakeInspector()
    const disowned = { pid: 124, started: 'disowned' }
    inspector.processSession = () => inspector.alive.has(disowned.pid) ? [disowned] : []
    inspector.alive.add(124)
    const handle = new LocalTerminalHandle(pty.asPty(), inspector, 20)

    pty.emitExit()

    await handle.terminate()
    expect(inspector.processes).toEqual([[124, 'SIGTERM']])
  })

  it('retains an inspected descendant after it reparents away from the shell', async () => {
    const pty = new FakePty()
    const inspector = new FakeInspector()
    const descendant = { pid: 124, started: 'observed' }
    inspector.members = [descendant]
    inspector.alive.add(descendant.pid)
    const handle = new LocalTerminalHandle(pty.asPty(), inspector, 20)

    await handle.inspectForeground()
    inspector.members = []
    pty.emitExit()

    await handle.terminate()
    expect(inspector.processes).toEqual([[124, 'SIGTERM']])
  })

  it('does not adopt the children of a recycled shell pid', async () => {
    const pty = new FakePty()
    const inspector = new FakeInspector()
    const handle = new LocalTerminalHandle(pty.asPty(), inspector, 10)

    pty.emitExit()
    const imposterChild = { pid: 999, started: 'imposter-child' }
    inspector.root = { pid: 123, started: 'imposter' }
    inspector.members = [imposterChild]
    inspector.alive.add(imposterChild.pid)

    await handle.terminate()
    expect(inspector.processes).toEqual([])
  })

  it('adopts nothing when the shell identity was never observable', async () => {
    const pty = new FakePty()
    const inspector = new FakeInspector()
    inspector.root = undefined
    const orphan = { pid: 321, started: 'unverifiable' }
    inspector.members = [orphan]
    inspector.alive.add(orphan.pid)
    const handle = new LocalTerminalHandle(pty.asPty(), inspector, 10)

    await handle.terminate()
    expect(inspector.processes).toEqual([])
    expect(pty.kills).toEqual(['SIGTERM'])
  })

  it('rescans for descendants forked during TERM', async () => {
    const pty = new FakePty()
    const inspector = new FakeInspector()
    const root = { pid: 123, started: 'shell' }
    let reads = 0
    inspector.processTree = () => {
      reads += 1
      if (reads === 1) return [root]
      if (reads === 2) {
        inspector.alive.add(124)
        return [root, { pid: 124, started: 'first' }]
      }
      if (reads === 3) {
        inspector.alive.add(125)
        return [root, { pid: 125, started: 'late' }]
      }
      return []
    }
    const handle = new LocalTerminalHandle(pty.asPty(), inspector, 10)
    await handle.terminate()
    expect(inspector.processes).toEqual([[124, 'SIGTERM'], [125, 'SIGKILL']])
    expect(pty.kills).toEqual(['SIGTERM'])
  })

  it('sweeps a same-session descendant forked while the shell handles TERM', async () => {
    const pty = new FakePty()
    const inspector = new FakeInspector()
    const late = { pid: 124, started: 'shell-term-trap' }
    pty.onKill = () => {
      inspector.sessionMembers = [late]
      inspector.alive.add(late.pid)
    }
    const handle = new LocalTerminalHandle(pty.asPty(), inspector, 10)

    await handle.terminate()

    expect(inspector.processes).toEqual([[late.pid, 'SIGTERM']])
    expect(pty.kills).toEqual(['SIGTERM'])
  })

  it('retries failed cleanup after a surviving descendant leaves', async () => {
    vi.useFakeTimers()
    const pty = new FakePty()
    const inspector = new FakeInspector()
    const late = { pid: 124, started: 'shell-term-survivor' }
    inspector.removeOnSignal = false
    pty.onKill = () => {
      inspector.sessionMembers = [late]
      inspector.alive.add(late.pid)
    }
    const handle = new LocalTerminalHandle(pty.asPty(), inspector, 10)

    const first = handle.terminate()
    const failed = expect(first).rejects.toThrow('surviving pids: 124')
    await vi.advanceTimersByTimeAsync(25)
    await failed

    inspector.alive.delete(late.pid)
    const retry = handle.terminate()
    expect(retry).not.toBe(first)
    await retry
    expect(inspector.processes).toEqual([[late.pid, 'SIGTERM'], [late.pid, 'SIGKILL']])
  })

  it('retains captured descendants after reparenting', async () => {
    vi.useFakeTimers()
    const pty = new FakePty()
    const inspector = new FakeInspector()
    const captured = { pid: 124, started: 'captured' }
    const root = { pid: 123, started: 'shell' }
    let reads = 0
    inspector.alive.add(captured.pid)
    inspector.processTree = () => { reads += 1; return reads === 1 ? [root] : reads === 2 ? [root, captured] : [] }
    inspector.signalProcess = (identity, signal) => {
      inspector.processes.push([identity.pid, signal])
      if (signal === 'SIGKILL') inspector.alive.delete(identity.pid)
    }
    const handle = new LocalTerminalHandle(pty.asPty(), inspector, 20)
    const quiescent = handle.terminate()
    await vi.advanceTimersByTimeAsync(25)
    await quiescent
    expect(inspector.processes).toEqual([[124, 'SIGTERM'], [124, 'SIGKILL']])
  })

  it('reports a top-level process that ignores escalation', async () => {
    vi.useFakeTimers()
    const pty = new FakePty()
    pty.autoExitOnKill = false
    const handle = new LocalTerminalHandle(pty.asPty(), new FakeInspector(), 10)
    const failed = expect(handle.terminate()).rejects.toThrow('surviving pid: 123')
    await vi.advanceTimersByTimeAsync(25)
    await failed
    expect(pty.kills).toEqual(['SIGTERM', 'SIGKILL'])

    pty.emitExit(0, 999)
    expect(await handle.done).toEqual({ exitCode: null, signal: null })
    await handle.terminate()
  })

  it('contains process races while reporting surviving descendants', async () => {
    const pty = new FakePty()
    pty.throwKill = true
    const inspector = new FakeInspector()
    inspector.members = [{ pid: 124, started: 'child' }]
    inspector.alive.add(124)
    inspector.throwProcess = true
    const handle = new LocalTerminalHandle(pty.asPty(), inspector, 1)
    await expect(handle.terminate()).rejects.toThrow('surviving pids: 124')
  })
})
