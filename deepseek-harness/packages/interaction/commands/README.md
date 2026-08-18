# @deepseek-ai/dsh-commands

English | [中文](README.zh.md)

Plugin-owned human-command registry consumed by interactive UI adapters. The [plugin command registration Agent Note](../../../.agents/notes/implemented/feature/2026-07-19-plugin-command-registration.md) owns the boundary and dispatch contract.

## Service contract

`ctx.commands.register(definition)` registers one lowercase command name, description, optional unstructured-input hint, optional `recordInput` policy, and abortable handler. `recordInput` defaults to true; a command whose authoritative domain event owns the payload sets it to false so `command/run` omits `args` instead of duplicating the input. A registered command is available to every composed command adapter; a plugin that is incompatible with a deployment does not register there. A plain-context registration is global. A command-producing plugin mounted beneath `agent.ctx` declares its own `commands` injection and creates an exact agent-scoped definition; it shadows a global definition with the same name. This child-injection shape preserves the agent scope without making the core agent loop depend on a UI service. Duplicate names within one layer fail during registration. Every disposer is the exact Cordis effect disposer, and registration or removal notifies every `commands/change` observer so live adapters can refresh discovery; observer failures are logged and cannot veto the registry mutation or starve later observers.

`list(agent)` returns immutable, name-sorted descriptors after scoped shadowing. `find(agent, name)` returns the corresponding definition. `execute(agent, line, signal)` uses `parseCommand()` and runs only a known command, returning the settled `CommandExecution` (the normalized result plus the lifecycle pairing `commandId`) or `undefined` for invalid syntax or unknown names. A resolved command's lifecycle is logged on the receiving agent's session as the log-only pair `command/run` (before the handler, with a minted `commandId`, the parser's structured name, the issuing `CommandSource`, and `args` unless `recordInput` is false) and `command/done` (at settlement, with the outcome kind and verbatim text; a successful result may also name an earlier non-command authoritative domain event through `sourceEventSeq`; a thrown or aborted handler settles as `kind: 'error'`). Admission misses log nothing. Both are direct standalone appends on the receiving agent's session: no turn wraps them, and persistence drains them through ordinary checkpoints and teardown.

`parseCommand()` recognizes a slash at byte zero, a lowercase name containing letters, digits, `_`, or `-`, and either end-of-input or whitespace. It returns every byte after the name as `rawInput`, including separator whitespace; consumers own their command-specific grammar and may normalize only what that grammar permits.

Handlers return `success` or `error` plus optional UI text. A successful handler may also return `sourceEventSeq` when an earlier domain event owns a richer presentation; the lifecycle invariant requires that reference to be a prior non-command event in the same session. Results are rendered directly by the adapter and never enter model history. The registry never submits `rawInput` to the agent implicitly; a command producer may explicitly schedule model-visible work through the receiving `Agent`, in which case that producer owns the resulting message contract. The registry races handler completion against the supplied abort signal, but an uncooperative handler may continue its own external side effects after the caller stops awaiting it.

## Composition

The shipped `dsh` base mounts this service and the Web client dispatches through it. UI-less demo spines and ACP automation do not provide a command adapter. Custom interactive compositions and command producers mount `@deepseek-ai/dsh-commands` explicitly.

## Model Experience

### Direct human commands

#### What the model sees

The registry itself submits nothing. Known slash commands execute in the UI command plane, and their `CommandResult` text is not submitted as a user message. Unknown slash-command input is rejected by shipped adapters instead of becoming a model prompt. A command producer may explicitly use the receiving `Agent`; for example, [`dsh-plan-mode`](../../plan/plan-mode/README.md#model-and-human-interactions) submits the optional message in `/plan [message]` after selecting plan mode.

#### Token effect

Command discovery, execution, and UI output add no model tokens. Explicit agent work scheduled by a command producer has the same token effect as the corresponding agent input.

#### KV Cache effect

Registry metadata, command input, and direct output never enter a model request and do not affect its cache. A mutated domain owns any later cache effect.

## Known Limitations and Deferred Work

- **Only unstructured text input** — forms, completion schemas, and typed arguments remain command-owned parsing concerns.
- **Cooperative side-effect cancellation** — dispatch stops awaiting on abort; handlers must honor the signal to stop work that has already escaped into external systems.
