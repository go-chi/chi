/** Platform process-table inspection for terminal readiness, signals, and teardown. */

import { closeSync, openSync, readFileSync, readdirSync, readSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import type { SubprocessTerminalSignal } from '@deepseek-ai/dsh-subprocess'

/** PID plus start identity, preventing teardown escalation after PID reuse. */
export interface ProcessIdentity {
  pid: number
  started: string
}

/** Injectable OS process operations used by one local PTY session. */
export interface ProcessInspector {
  foregroundPgid(shellPid: number): number | undefined
  isStdinWaiting(pgid: number): boolean
  /** Return the root and its current transitive descendants, children first. */
  processTree(rootPid: number): ProcessIdentity[]
  /** Return current members of one POSIX process session when the platform exposes them. */
  processSession(sessionId: number): ProcessIdentity[]
  /** Return whether the exact identity remains a non-quiescent process. */
  isAlive(identity: ProcessIdentity): boolean
  signalGroup(pgid: number, signal: SubprocessTerminalSignal): void
  signalProcess(identity: ProcessIdentity, signal: 'SIGTERM' | 'SIGKILL'): void
}

/** Testable boundary around filesystem, process-table, and signal syscalls. */
export interface ProcessInspectorInternals {
  readFile(path: string): string
  readDir(path: string): string[]
  open(path: string): number
  read(fd: number, buffer: Buffer, length: number, position: number): number
  close(fd: number): void
  exec(file: string, args: string[]): string
  kill(pid: number, signal: NodeJS.Signals): void
}

/* v8 ignore start -- thin OS bindings; injected logic is unit-tested and real platform composition exercises them. */
const DEFAULT_INTERNALS: ProcessInspectorInternals = {
  readFile: path => readFileSync(path, 'utf8'),
  readDir: path => readdirSync(path),
  open: path => openSync(path, 'r'),
  read: (fd, buffer, length, position) => readSync(fd, buffer, 0, length, position),
  close: closeSync,
  exec: (file, args) => execFileSync(file, args, { encoding: 'utf8' }),
  kill: (pid, signal) => process.kill(pid, signal),
}
/* v8 ignore stop */

interface ProcStat {
  pid: number
  parentPid: number
  pgrp: number
  session: number
  state: string
  tpgid: number
  started: string
}

/**
 * Parse fields used from Linux `/proc/<pid>/stat`, including parenthesized comm text.
 * @param text - complete stat line.
 * @returns Parsed identity/group fields, or undefined for malformed input.
 */
export function parseProcStat(text: string): ProcStat | undefined {
  const open = text.indexOf('(')
  const close = text.lastIndexOf(')')
  if (open <= 0 || close <= open) return undefined
  const pid = Number(text.slice(0, open).trim())
  const rest = text.slice(close + 2).trim().split(/\s+/)
  const state = rest[0] || ''
  const parentPid = Number(rest[1])
  const pgrp = Number(rest[2])
  const session = Number(rest[3])
  const tpgid = Number(rest[5])
  const started = rest[19]
  if (![pid, parentPid, pgrp, session, tpgid].every(Number.isSafeInteger)
    || state.length !== 1 || started === undefined) return undefined
  return { pid, parentPid, pgrp, session, state, tpgid, started }
}

function readLinuxStat(internals: ProcessInspectorInternals, pid: number): ProcStat | undefined {
  try {
    return parseProcStat(internals.readFile(`/proc/${pid}/stat`))
  } catch (_unreadableProcEntry) {
    return undefined
  }
}

/**
 * Report whether a Linux process group has an executing member. `false`
 * means the group contains only zombie/dead entries; `undefined` means the
 * process table could not prove either outcome.
 * @param processGroupId - POSIX process-group id to inspect.
 * @param internals - injectable process-table operations.
 * @returns Live-member presence, or `undefined` when unavailable/absent.
 */
export function linuxProcessGroupHasLiveMembers(
  processGroupId: number,
  internals: ProcessInspectorInternals = DEFAULT_INTERNALS,
): boolean | undefined {
  let entries: string[]
  try {
    entries = internals.readDir('/proc')
  } catch (_unreadableProcDirectory) {
    return undefined
  }
  let matched = false
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue
    const stat = readLinuxStat(internals, Number(entry))
    if (stat?.pgrp !== processGroupId) continue
    matched = true
    if (!/^[ZXx]$/.test(stat.state)) return true
  }
  return matched ? false : undefined
}

function numericEntries(internals: ProcessInspectorInternals, path: string): number[] {
  try {
    return internals.readDir(path).filter(entry => /^\d+$/.test(entry)).map(Number)
  } catch (_unreadableProcDirectory) {
    return []
  }
}

interface SyscallInfo {
  number: number
  args: number[]
}

function readSyscall(internals: ProcessInspectorInternals, pid: number, tid: number): SyscallInfo | undefined {
  try {
    const text = internals.readFile(`/proc/${pid}/task/${tid}/syscall`).trim()
    if (text === 'running' || text.startsWith('-1 ')) return undefined
    const fields = text.split(/\s+/)
    const number = Number(fields[0])
    const args = fields.slice(1, 7).map(field => Number.parseInt(field, 16))
    if (!Number.isSafeInteger(number) || args.some(value => !Number.isSafeInteger(value))) return undefined
    return { number, args }
  } catch (_unreadableSyscall) {
    return undefined
  }
}

function readMemory(
  internals: ProcessInspectorInternals,
  pid: number,
  address: number,
  length: number,
): Buffer | undefined {
  let fd: number | undefined
  try {
    fd = internals.open(`/proc/${pid}/mem`)
    const buffer = Buffer.alloc(length)
    const count = internals.read(fd, buffer, length, address)
    return buffer.subarray(0, count)
  } catch (_unreadableProcessMemory) {
    return undefined
  } finally {
    if (fd !== undefined) internals.close(fd)
  }
}

function fdSetHasStdin(internals: ProcessInspectorInternals, pid: number, address: number): boolean {
  return address !== 0 && (readMemory(internals, pid, address, 8)?.[0] ?? 0) % 2 === 1
}

function pollHasStdin(
  internals: ProcessInspectorInternals,
  pid: number,
  address: number,
  count: number,
): boolean {
  if (address === 0 || count <= 0) return false
  const memory = readMemory(internals, pid, address, Math.min(count, 1024) * 8)
  if (memory === undefined) return false
  for (let offset = 0; offset + 8 <= memory.length; offset += 8) {
    if (memory.readInt32LE(offset) === 0 && (memory.readInt16LE(offset + 4) & 0x001) !== 0) return true
  }
  return false
}

function epollHasStdin(internals: ProcessInspectorInternals, pid: number, epfd: number): boolean {
  try {
    return internals.readFile(`/proc/${pid}/fdinfo/${epfd}`)
      .split('\n')
      .some(line => /^tfd:\s+0\b/.test(line.trim()))
  } catch (_unreadableFdInfo) {
    return false
  }
}

interface SyscallTable {
  read: number
  select?: number
  pselect: number
  poll?: number
  ppoll: number
  epollWait?: number
  epollPwait: number
}

const SYSCALLS: Partial<Record<NodeJS.Architecture, SyscallTable>> = {
  x64: { read: 0, select: 23, pselect: 270, poll: 7, ppoll: 271, epollWait: 232, epollPwait: 281 },
  arm64: { read: 63, pselect: 72, ppoll: 73, epollPwait: 22 },
}

function syscallWaitsOnStdin(
  internals: ProcessInspectorInternals,
  pid: number,
  syscall: SyscallInfo,
  table: SyscallTable,
): boolean {
  const [a0 = 0, a1 = 0, a2 = 0] = syscall.args
  if (syscall.number === table.read) return a0 === 0
  if (syscall.number === table.select || syscall.number === table.pselect) {
    return a0 >= 1 && fdSetHasStdin(internals, pid, a1)
  }
  if (syscall.number === table.poll || syscall.number === table.ppoll) {
    return a1 >= 1 && pollHasStdin(internals, pid, a0, a1)
  }
  if (syscall.number === table.epollWait || syscall.number === table.epollPwait) {
    return a2 >= 1 && epollHasStdin(internals, pid, a0)
  }
  return false
}

abstract class PosixProcessInspector implements ProcessInspector {
  constructor(protected readonly internals: ProcessInspectorInternals) {}

  abstract foregroundPgid(shellPid: number): number | undefined
  abstract isStdinWaiting(pgid: number): boolean
  abstract processTree(rootPid: number): ProcessIdentity[]
  abstract processSession(sessionId: number): ProcessIdentity[]
  abstract isAlive(identity: ProcessIdentity): boolean

  signalGroup(pgid: number, signal: SubprocessTerminalSignal): void {
    this.internals.kill(-pgid, signal)
  }

  signalProcess(identity: ProcessIdentity, signal: 'SIGTERM' | 'SIGKILL'): void {
    if (this.isAlive(identity)) this.internals.kill(identity.pid, signal)
  }
}

interface ProcessTreeEntry extends ProcessIdentity {
  parentPid: number
}

function processTree(entries: ProcessTreeEntry[], rootPid: number): ProcessIdentity[] {
  const byPid = new Map(entries.map(entry => [entry.pid, entry]))
  const root = byPid.get(rootPid)
  if (root === undefined) return []
  const byParent = new Map<number, ProcessTreeEntry[]>()
  for (const entry of entries) {
    const children = byParent.get(entry.parentPid) ?? []
    children.push(entry)
    byParent.set(entry.parentPid, children)
  }
  const visited = new Set<number>()
  const result: ProcessIdentity[] = []
  const visit = (entry: ProcessTreeEntry): void => {
    if (visited.has(entry.pid)) return
    visited.add(entry.pid)
    for (const child of byParent.get(entry.pid) ?? []) visit(child)
    result.push({ pid: entry.pid, started: entry.started })
  }
  visit(root)
  return result
}

class LinuxProcessInspector extends PosixProcessInspector {
  constructor(
    private readonly arch: NodeJS.Architecture,
    internals: ProcessInspectorInternals,
  ) {
    super(internals)
  }

  foregroundPgid(shellPid: number): number | undefined {
    const tpgid = readLinuxStat(this.internals, shellPid)?.tpgid
    return tpgid !== undefined && tpgid > 0 ? tpgid : undefined
  }

  isStdinWaiting(pgid: number): boolean {
    const table = SYSCALLS[this.arch]
    if (table === undefined) return false
    for (const pid of numericEntries(this.internals, '/proc')) {
      if (readLinuxStat(this.internals, pid)?.pgrp !== pgid) continue
      for (const tid of numericEntries(this.internals, `/proc/${pid}/task`)) {
        const syscall = readSyscall(this.internals, pid, tid)
        if (syscall !== undefined && syscallWaitsOnStdin(this.internals, pid, syscall, table)) return true
      }
    }
    return false
  }

  processTree(rootPid: number): ProcessIdentity[] {
    const entries = numericEntries(this.internals, '/proc').flatMap((pid) => {
      const stat = readLinuxStat(this.internals, pid)
      return stat === undefined ? [] : [{ pid, parentPid: stat.parentPid, started: stat.started }]
    })
    return processTree(entries, rootPid)
  }

  processSession(sessionId: number): ProcessIdentity[] {
    return numericEntries(this.internals, '/proc').flatMap((pid) => {
      const stat = readLinuxStat(this.internals, pid)
      return stat?.session === sessionId ? [{ pid, started: stat.started }] : []
    })
  }

  isAlive(identity: ProcessIdentity): boolean {
    const stat = readLinuxStat(this.internals, identity.pid)
    return stat?.started === identity.started && !/^[ZXx]$/.test(stat.state)
  }

}

interface PsEntry extends ProcessTreeEntry {}

function macProcessTable(internals: ProcessInspectorInternals): PsEntry[] {
  return internals.exec('/bin/ps', ['-axo', 'pid=,ppid=,lstart=']).split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line)
    if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) return []
    return [{ pid: Number(match[1]), parentPid: Number(match[2]), started: match[3] }]
  })
}

class MacProcessInspector extends PosixProcessInspector {
  foregroundPgid(shellPid: number): number | undefined {
    try {
      const value = Number(this.internals.exec('/bin/ps', ['-o', 'tpgid=', '-p', String(shellPid)]).trim())
      return Number.isSafeInteger(value) && value > 0 ? value : undefined
    } catch (_missingProcess) {
      return undefined
    }
  }

  isStdinWaiting(_pgid: number): boolean {
    return false
  }

  processTree(rootPid: number): ProcessIdentity[] {
    return processTree(macProcessTable(this.internals), rootPid)
  }

  processSession(_sessionId: number): ProcessIdentity[] {
    return []
  }

  isAlive(identity: ProcessIdentity): boolean {
    return macProcessTable(this.internals).some(entry => entry.pid === identity.pid && entry.started === identity.started)
  }

}

/**
 * Create the supported platform inspector or fail at plugin load.
 * @param platform - target Node platform.
 * @param arch - target CPU architecture for Linux syscall numbers.
 * @param internals - filesystem/process boundary, injectable for deterministic tests.
 * @returns Platform process inspector.
 */
export function createProcessInspector(
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
  internals: ProcessInspectorInternals = DEFAULT_INTERNALS,
): ProcessInspector {
  if (platform === 'linux') return new LinuxProcessInspector(arch, internals)
  if (platform === 'darwin') return new MacProcessInspector(internals)
  throw new Error(`subprocess-local: terminal inspection is unsupported on platform ${platform}`)
}
