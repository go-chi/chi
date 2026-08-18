/** Local node-pty terminal-process implementation for the subprocess seam. */

import { Buffer } from 'node:buffer'
import { constants } from 'node:os'
import { PassThrough } from 'node:stream'
import type { IDisposable, IPty } from 'node-pty'
import type {
  SubprocessOutcome,
  SubprocessTerminalForeground,
  SubprocessTerminalHandle,
  SubprocessTerminalSignal,
} from '@deepseek-ai/dsh-subprocess'
import type { ProcessIdentity, ProcessInspector } from './process-inspector.ts'

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function signalName(number: number | undefined): NodeJS.Signals | null {
  if (number === undefined || number === 0) return null
  for (const [name, value] of Object.entries(constants.signals)) {
    if (value === number) return name as NodeJS.Signals
  }
  return null
}

/**
 * A local terminal whose process-session ownership stays below the PTY backend.
 * The seam's terminate() promise — no write, inspection, or signal in flight
 * after settlement — holds here without operation tracking only because every
 * handle call completes synchronously under the hood (node-pty write, ps-based
 * inspection). A first genuinely asynchronous step in any handle call must add
 * the tracking a remote provider needs.
 */
export class LocalTerminalHandle implements SubprocessTerminalHandle {
  readonly pid: number
  readonly output = new PassThrough()
  readonly done: Promise<SubprocessOutcome>

  private readonly outcome = Promise.withResolvers<SubprocessOutcome>()
  private readonly dataDisposable: IDisposable
  private readonly exitDisposable: IDisposable
  private cleanup: Promise<void> | undefined
  private exited = false
  private trackedDescendants: ProcessIdentity[] = []
  /** The spawned shell's start identity; scans stop adopting members once the root pid no longer carries it. */
  private readonly rootIdentity: ProcessIdentity | undefined

  /**
   * @param terminal - allocated node-pty process.
   * @param inspector - platform process/session operations.
   * @param graceMs - TERM-to-KILL and exit-wait grace.
   */
  constructor(
    private readonly terminal: IPty,
    private readonly inspector: ProcessInspector,
    private readonly graceMs: number,
  ) {
    this.pid = terminal.pid
    this.rootIdentity = inspector.processTree(this.pid).find(member => member.pid === this.pid)
    this.done = this.outcome.promise
    this.dataDisposable = terminal.onData((data) => { this.output.write(Buffer.from(data, 'utf8')) })
    this.exitDisposable = terminal.onExit(({ exitCode, signal: exitSignal }) => {
      if (this.exited) return
      this.exited = true
      this.output.end()
      this.outcome.resolve({
        exitCode: exitSignal === undefined || exitSignal === 0 ? exitCode : null,
        signal: signalName(exitSignal),
      })
    })
  }

  // node-pty writes synchronously; the seam returns a promise for remote transports.
  // oxlint-disable-next-line typescript/require-await -- Preserve promise rejection semantics at the async provider contract.
  async write(data: string): Promise<void> {
    if (this.exited) throw new Error('terminal process has exited')
    this.terminal.write(data)
  }

  // Local inspection is synchronous; the seam returns a promise for remote transports.
  // oxlint-disable-next-line typescript/require-await -- Preserve promise rejection semantics at the async provider contract.
  async inspectForeground(): Promise<SubprocessTerminalForeground | undefined> {
    this.descendants()
    const processGroupId = this.inspector.foregroundPgid(this.pid)
    if (processGroupId === undefined) return undefined
    return {
      processGroupId,
      inputWaiting: this.inspector.isStdinWaiting(processGroupId),
    }
  }

  async signalForeground(signal: SubprocessTerminalSignal): Promise<number> {
    const foreground = await this.inspectForeground()
    if (foreground === undefined) {
      throw new Error(`cannot resolve foreground process group for terminal ${this.pid}`)
    }
    if (signal === 'SIGKILL' && foreground.processGroupId === this.pid) {
      throw new Error('refusing to SIGKILL the terminal shell; terminate the terminal session instead')
    }
    this.inspector.signalGroup(foreground.processGroupId, signal)
    return foreground.processGroupId
  }

  terminate(): Promise<void> {
    if (this.cleanup !== undefined) return this.cleanup
    const cleanup = this.closeOnce()
    this.cleanup = cleanup
    void cleanup.catch(() => { this.cleanup = undefined })
    return cleanup
  }

  /**
   * Force-terminate the observable session synchronously during Node's exit
   * event. This does not claim quiescence and does not replace terminate().
   */
  terminateForHostExit(): void {
    this.forceStopDescendants()
    this.forceStopShell()
    this.forceStopDescendants()
  }

  private forceStopShell(): void {
    if (this.exited) return
    if (this.rootIdentity !== undefined) {
      try {
        this.inspector.signalProcess(this.rootIdentity, 'SIGKILL')
      } catch (_rootExitedDuringHostExit) {
        // Exact identity signalling contains both exit races and PID reuse.
      }
      return
    }
    try {
      this.terminal.kill('SIGKILL')
    } catch (_unidentifiedShellExitedDuringHostExit) {
      // Without a captured identity, node-pty is the only root kill primitive.
    }
  }

  private survivors(members: ProcessIdentity[]): ProcessIdentity[] {
    return members.filter(member => this.inspector.isAlive(member))
  }

  private descendants(): ProcessIdentity[] {
    // Adopt newly scanned members only while the numeric root pid provably
    // still carries the spawned shell's start identity: after the shell dies,
    // a recycled pid's tree and session must not donate an unrelated
    // process's children to this session's signalling. Already-adopted
    // members keep their own start identities, which every signal rechecks.
    const tree = this.inspector.processTree(this.pid)
    const root = tree.find(member => member.pid === this.pid)
    const rootVerified = this.rootIdentity !== undefined
      && root !== undefined
      && root.started === this.rootIdentity.started
    this.trackedDescendants = this.survivors(this.unionMembers(
      this.trackedDescendants,
      ...rootVerified ? [tree, this.inspector.processSession(this.pid)] : [],
    ).filter(member => member.pid !== this.pid))
    return this.trackedDescendants
  }

  private async waitForMembers(members: ProcessIdentity[]): Promise<ProcessIdentity[]> {
    const until = Date.now() + this.graceMs
    let survivors = this.survivors(members)
    while (survivors.length > 0 && Date.now() < until) {
      await delay(Math.min(25, Math.max(1, until - Date.now())))
      survivors = this.survivors(members)
    }
    return survivors
  }

  private signalMembers(members: ProcessIdentity[], signal: 'SIGTERM' | 'SIGKILL'): void {
    for (const member of members) {
      try {
        this.inspector.signalProcess(member, signal)
      } catch (_alreadyExitedDuringSignal) {
        // The exact process identity is rechecked; a same-tick exit is success.
      }
    }
  }

  private forceStopDescendants(): void {
    let members = this.trackedDescendants
    try {
      members = this.descendants()
    } catch (_processTableUnavailableDuringHostExit) {
      // Preserve already-captured identities when a final process-table scan fails.
    }
    this.signalMembers(members, 'SIGKILL')
  }

  private unionMembers(...groups: ProcessIdentity[][]): ProcessIdentity[] {
    const members: ProcessIdentity[] = []
    const seen = new Set<string>()
    for (const group of groups) {
      for (const member of group) {
        const key = `${member.pid}:${member.started}`
        if (seen.has(key)) continue
        seen.add(key)
        members.push(member)
      }
    }
    return members
  }

  private async stopDescendants(): Promise<ProcessIdentity[]> {
    const captured = this.descendants()
    this.signalMembers(captured, 'SIGTERM')
    const capturedSurvivors = await this.waitForMembers(captured)
    const members = this.unionMembers(capturedSurvivors, this.descendants())
    this.signalMembers(members, 'SIGKILL')
    const survivors = await this.waitForMembers(members)
    return this.survivors(this.unionMembers(survivors, this.descendants()))
  }

  private async stopShell(): Promise<void> {
    if (!this.exited) {
      try {
        this.terminal.kill('SIGTERM')
      } catch (_topLevelAlreadyExitedDuringTerm) {
        // The exit callback is authoritative.
      }
      await Promise.race([this.done.then(() => undefined), delay(this.graceMs)])
    }
    if (!this.exited) {
      try {
        this.terminal.kill('SIGKILL')
      } catch (_topLevelAlreadyExitedDuringKill) {
        // The exit callback is authoritative.
      }
      await Promise.race([this.done.then(() => undefined), delay(this.graceMs)])
    }
    if (!this.exited) throw new Error(`terminal cleanup failed; surviving pid: ${this.pid}`)
  }

  private async closeOnce(): Promise<void> {
    let survivors = await this.stopDescendants()
    if (survivors.length > 0) {
      throw new Error(`terminal cleanup failed; surviving pids: ${survivors.map(member => member.pid).join(', ')}`)
    }
    await this.stopShell()
    survivors = await this.stopDescendants()
    if (survivors.length > 0) {
      throw new Error(`terminal cleanup failed; surviving pids: ${survivors.map(member => member.pid).join(', ')}`)
    }
    this.dataDisposable.dispose()
    this.exitDisposable.dispose()
  }
}
