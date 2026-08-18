/**
 * Plugin-owned human-command registry shared by interactive UI adapters.
 * @module @deepseek-ai/dsh-commands
 */

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { NamedEntries, ScopedLayers } from '@deepseek-ai/dsh-scope'
import type { ScopeKey, ScopeLayer } from '@deepseek-ai/dsh-scope'
import type { Session, SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { CommandId } from './brand.ts'
import type {
  CommandDescriptor,
  CommandExecution,
  CommandInputDescriptor,
  CommandResult,
} from './types.ts'

export { CommandId } from './brand.ts'
export type * from './types.ts'

export const name = 'commands'

const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/u

/** Invocation passed to one registered command handler. */
export interface CommandInvocation {
  /** Pairing id already written to this invocation's `command/run` event. */
  readonly commandId: CommandId
  /** Exact agent whose UI received the command. */
  readonly agent: Agent
  /** Exact text following the registered command name, including separator whitespace. */
  readonly rawInput: string
  /** Cancellation signal owned by the dispatching UI request. */
  readonly signal: AbortSignal
}

/** Plugin-owned command registration. */
export interface CommandDefinition {
  /** Lowercase command name without the leading slash. */
  readonly name: string
  /** Human-readable summary used in discovery UI. */
  readonly description: string
  /** Optional free-form input hint advertised to capable clients. */
  readonly input?: CommandInputDescriptor
  /**
   * Whether `command/run` records `rawInput`. Defaults to true. A command
   * whose domain event owns the payload sets this false to avoid duplicating
   * that payload in the session log.
   */
  readonly recordInput?: boolean
  /** Execute against the receiving agent without sending the command to the model. */
  readonly handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>
}

/** Syntactically valid slash command before registry resolution. */
export interface ParsedCommand {
  /** Lowercase command name without the leading slash. */
  readonly name: string
  /** Exact text following the command name. */
  readonly rawInput: string
}

interface RegisteredCommand {
  readonly definition: CommandDefinition
  readonly descriptor: CommandDescriptor
}

/** All command registrations owned by one global or scoped layer. */
class CommandLayer implements ScopeLayer {
  readonly commands: NamedEntries<RegisteredCommand>

  /**
   * Create one command layer with diagnostics specific to its ownership scope.
   * @param scope - the scoped owner, or `undefined` for global registrations.
   */
  constructor(scope: ScopeKey | undefined) {
    this.commands = new NamedEntries(name => new Error(scope === undefined
      ? `command "${name}" is already registered (for a per-agent variant, mount a command-injected plugin under that agent's \`agent.ctx\`)`
      : `command "${name}" is already registered in this scope`))
  }

  /** @returns whether this layer owns no command registrations. */
  isEmpty(): boolean {
    return this.commands.isEmpty()
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    commands: CommandRuntime
  }
}

/**
 * Parse an exact slash command without normalizing its trailing input.
 *
 * @param line - Complete candidate command line.
 * @returns The parsed command, or `undefined` when the line is not a command.
 */
export function parseCommand(line: string): ParsedCommand | undefined {
  const match = /^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u.exec(line)
  if (match === null) return undefined
  const name = match[1]
  /* v8 ignore next -- the first capture is required whenever the regular expression matches */
  if (name === undefined) return undefined
  return Object.freeze({ name, rawInput: line.slice(match[0].length) })
}

/** Convert arbitrary abort reasons to one stable rejected Error. */
function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason
  return new Error(typeof signal.reason === 'string' ? signal.reason : 'command aborted')
}

/** Render arbitrary thrown values without trusting their string coercion. */
function renderThrown(value: unknown): string {
  try {
    return String(value)
  } catch {
    return '<unrenderable thrown value>'
  }
}

/** Stop awaiting an uncooperative handler once its owning UI request aborts. */
function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort)
      reject(abortError(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error instanceof Error
          ? error
          : new Error(`command handler rejected with a non-Error value: ${renderThrown(error)}`, { cause: error }))
      },
    )
  })
}

/** Reject invalid command metadata before it can reach a UI protocol. */
function normalizeDefinition(definition: CommandDefinition): RegisteredCommand {
  if (!COMMAND_NAME.test(definition.name)) {
    throw new TypeError(`command name "${definition.name}" must match ${String(COMMAND_NAME)}`)
  }
  if (typeof definition.description !== 'string') {
    throw new TypeError(`command "${definition.name}" description must be a string`)
  }
  if (definition.description.trim().length === 0) {
    throw new TypeError(`command "${definition.name}" description must not be empty`)
  }
  if (typeof definition.handler !== 'function') {
    throw new TypeError(`command "${definition.name}" handler must be a function`)
  }
  const rawInput: unknown = definition.input
  let input: CommandInputDescriptor | undefined
  if (rawInput !== undefined) {
    if (typeof rawInput !== 'object' || rawInput === null || !('hint' in rawInput)
      || typeof rawInput.hint !== 'string') {
      throw new TypeError(`command "${definition.name}" input hint must be a string`)
    }
    if (rawInput.hint.trim().length === 0) {
      throw new TypeError(`command "${definition.name}" input hint must not be empty`)
    }
    input = Object.freeze({ hint: rawInput.hint })
  }
  const normalized = Object.freeze({
    name: definition.name,
    description: definition.description,
    ...input === undefined ? {} : { input },
    ...definition.recordInput === undefined ? {} : { recordInput: definition.recordInput },
    handler: definition.handler,
  })
  const descriptor = Object.freeze({
    name: normalized.name,
    description: normalized.description,
    ...normalized.input === undefined ? {} : { input: normalized.input },
  })
  return { definition: normalized, descriptor }
}

/** Validate and detach an untrusted handler result at the registry boundary. */
function normalizeResult(command: string, value: unknown): CommandResult {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    throw new TypeError(`command "${command}" handler must return a CommandResult`)
  }
  const result = value as { kind?: unknown; text?: unknown; sourceEventSeq?: unknown }
  if (result.kind === 'success') {
    if (result.text !== undefined && typeof result.text !== 'string') {
      throw new TypeError(`command "${command}" success text must be a string when supplied`)
    }
    if (result.sourceEventSeq !== undefined
      && (!Number.isSafeInteger(result.sourceEventSeq) || (result.sourceEventSeq as number) < 0)) {
      throw new TypeError(`command "${command}" success sourceEventSeq must be a non-negative safe integer when supplied`)
    }
    return Object.freeze({
      kind: 'success',
      ...result.text === undefined ? {} : { text: result.text },
      ...result.sourceEventSeq === undefined ? {} : { sourceEventSeq: result.sourceEventSeq as number },
    })
  }
  if (result.kind === 'error') {
    if (typeof result.text !== 'string' || result.text.trim().length === 0) {
      throw new TypeError(`command "${command}" error text must be a non-empty string`)
    }
    return Object.freeze({ kind: 'error', text: result.text })
  }
  throw new TypeError(`command "${command}" returned unknown result kind "${String(result.kind)}"`)
}

/**
 * Human-command registry. Plain-context definitions are global; definitions
 * registered through a command-injected child of an agent context shadow
 * globals for that agent.
 */
export class CommandRuntime extends TypertRemoteService {
  private readonly layers = new ScopedLayers(
    scope => new CommandLayer(scope),
    () => { this.notifyChange() },
  )

  /** Monotonic per-instance counter behind {@link mintCommandId}. */
  private commandSeq = 0
  /** Instance token keeping minted ids unique across process restarts over one resumed log. */
  private readonly instanceToken = crypto.randomUUID().slice(0, 8)

  constructor(ctx: Context) {
    super(ctx, 'commands')
  }

  /**
   * Register a global or calling-agent-scoped command.
   * @param definition - discovery metadata and direct UI handler.
   * @returns the exact effect disposer that unregisters this definition.
   */
  register(definition: CommandDefinition): () => void {
    const registered = normalizeDefinition(definition)
    return this.layers.effect(
      this.ctx,
      layer => layer.commands.insert(registered.definition.name, registered),
      { label: 'commands.register()' },
    )
  }

  /**
   * List the effective immutable command descriptors for one agent.
   * @param agent - exact receiving agent and scoped-layer key.
   * @returns name-sorted descriptors after scoped shadowing.
   */
  @Remote
  list(agent: Agent): readonly CommandDescriptor[] {
    return Object.freeze([...this.view(agent).values()]
      .map(command => command.descriptor)
      // Names are unique in the effective view, so equality is impossible.
      .sort((left, right) => left.name < right.name ? -1 : 1))
  }

  /**
   * Resolve one effective command definition.
   * @param agent - exact receiving agent and scoped-layer key.
   * @param name - command name without a slash.
   * @returns the scoped shadow or global definition.
   */
  find(agent: Agent, name: string): CommandDefinition | undefined {
    return this.view(agent).get(name)?.definition
  }

  /**
   * Parse and execute a known command without sending it to the model.
   *
   * A resolved command's lifecycle is logged: `command/run` is appended
   * before the handler is invoked and `command/done` after settlement (a
   * thrown or aborted handler settles as `kind: 'error'`). Both are direct
   * log-only appends — no turn wraps them, and persistence drains them at
   * ordinary checkpoints. Admission misses (syntax or unknown name) log
   * nothing — they never entered a handler. A `command/run` append failure
   * fails the execution loud; a `command/done` append failure on the
   * handler-failure path is contained so the handler's own error stays the
   * reported failure.
   *
   * @param agent - exact receiving agent.
   * @param line - complete slash-command line.
   * @param signal - cancellation signal owned by the UI request.
   * @returns the settled execution (result + lifecycle pairing id), or
   *   `undefined` when syntax or name does not resolve.
   */
  @Remote
  async execute(
    agent: Agent,
    line: string,
    signal: AbortSignal,
  ): Promise<CommandExecution | undefined> {
    const parsed = parseCommand(line)
    if (parsed === undefined) return undefined
    const command = this.view(agent).get(parsed.name)
    if (command === undefined) return undefined
    if (signal.aborted) throw abortError(signal)
    const commandId = this.mintCommandId()
    this.appendLifecycle(agent.session, 'command/run', {
      commandId,
      name: parsed.name,
      ...command.definition.recordInput === false ? {} : { args: parsed.rawInput },
      source: { kind: 'user' },
    })
    const invocation = Object.freeze({ commandId, agent, rawInput: parsed.rawInput, signal })
    let result: CommandResult
    try {
      const output = command.definition.handler(invocation)
      result = normalizeResult(parsed.name, await withAbort(Promise.resolve(output), signal))
    } catch (error: unknown) {
      try {
        this.appendLifecycle(agent.session, 'command/done', {
          commandId, kind: 'error',
          text: error instanceof Error ? error.message : renderThrown(error),
        })
      } catch (appendError: unknown) {
        this.ctx.logger.warn(`command "${parsed.name}": command/done append failed: ${renderThrown(appendError)}`)
      }
      throw error
    }
    this.appendLifecycle(agent.session, 'command/done', {
      commandId, kind: result.kind,
      ...result.text === undefined ? {} : { text: result.text },
      ...result.kind === 'success' && result.sourceEventSeq !== undefined
        ? { sourceEventSeq: result.sourceEventSeq }
        : {},
    })
    return Object.freeze({ commandId, result })
  }

  /** Mint the next pairing id (monotonic; instance-token-prefixed so a resumed log never repeats one). */
  private mintCommandId(): CommandId {
    this.commandSeq += 1
    return CommandId(`cmd-${this.instanceToken}-${this.commandSeq}`)
  }

  /**
   * Append one log-only lifecycle event directly: no turn is opened for it and
   * no flush is forced — persistence observes the eager `session/event` path
   * and drains at ordinary checkpoints and teardown, like every other
   * standalone plugin event.
   */
  private appendLifecycle<T extends 'command/run' | 'command/done'>(
    session: Session,
    type: T,
    data: SessionEventMap[T],
  ): SessionEvent<T> {
    // Both admitted types are log-only (non-surface), but TypeScript does not
    // reduce Session.append's conditional rest parameter through a generic
    // type parameter. Preserve the proven two-argument call shape.
    const appendLogOnly = session.append.bind(session) as (eventType: T, eventData: SessionEventMap[T]) => SessionEvent<T>
    return appendLogOnly(type, data)
  }

  /** Resolve global definitions followed by exact scoped shadows. */
  private view(agent: Agent): Map<string, RegisteredCommand> {
    return this.layers.merge(agent, layer => layer.commands)
  }

  /** Notify every registry observer without making UI refresh load-bearing. */
  private notifyChange(): void {
    // Cordis emit uses Array.map: one synchronous throw starves later listeners,
    // and returned promises are discarded. Registry notifications are
    // non-vetoing, so contain each callback independently.
    for (const callback of this.ctx.events.dispatch('emit', ['commands/change'])) {
      try {
        const returned: unknown = callback()
        void Promise.resolve(returned).catch((error: unknown) => {
          this.ctx.logger.warn(`commands/change listener rejected: ${renderThrown(error)}`)
        })
      } catch (error: unknown) {
        this.ctx.logger.warn(`commands/change listener threw: ${renderThrown(error)}`)
      }
    }
  }
}

export default CommandRuntime
