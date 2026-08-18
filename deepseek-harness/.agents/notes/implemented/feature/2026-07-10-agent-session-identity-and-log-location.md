# Agent Note: Expose agent session identity and JSONL location to tools and hooks

Status: implemented

English | [中文](2026-07-10-agent-session-identity-and-log-location.zh.md)

## Problem

An agent can identify its workspace through `session.header.cwd`, but a model using bash cannot reliably identify the session that owns the call or the durable transcript that records it. Searching `./.sessions` guesses deployment config and JSONL layout; custom roots, alternate persistence backends, resume, forks, and concurrent parent/child agents make that guess unreliable. Hooks have the same need for transcript location, while future plugins may need to expose other harness-owned environment facts to shell commands.

The boundary must preserve two properties: the owner of a fact decides how to resolve it, and every child receives a per-execution snapshot rather than process-global mutable state. In particular, a nested harness must not leak its ambient `DSH_*` values into a child whose current agent, persistence backend, or configuration differs.

## Decision

Extend the [`SessionPersistence`](../architecture/2026-06-14-session-persistence.md) seam with a synchronous, side-effect-free location query:

```ts
import type { SessionHeader } from '@deepseek-ai/dsh-session'

interface SessionLocation {
  readonly kind: string
  readonly path: string
}

interface SessionPersistence {
  locate(meta: SessionHeader): SessionLocation | undefined
}
```

`path` is an absolute local path to the backend's dedicated log for `meta`; `kind` identifies the representation. JSONL returns `{ kind: 'jsonl', path }` using its resolved root and path helpers. SQLite and any backend without an honest local per-session artifact return `undefined`. The query creates and flushes nothing, so it can report a lazy target path before that file exists.

The model-facing bash package owns a `ctx.shellEnv` registry. A contributor declares its stable name, every `DSH_*` key it may return, a description for each key, and `resolve(execution: ToolExecution)`. Duplicate contributor names, duplicate key ownership, reserved keys, malformed declarations, undeclared runtime output, and non-string output fail loudly. Registration is a Cordis effect and is removed with the contributing plugin fiber. `list()` exposes declarations without running resolvers, keeping the environment API enumerable for diagnostics and future prompt/UI consumers.

The registry rebuilds a trusted overlay for every foreground and background bash `ToolExecution`:

- `DSH_HOME` is always the absolute configured Harness home. The standalone [`@deepseek-ai/dsh-home-paths`](../../../../packages/util/home-paths/README.md) utility owns its precedence: explicit `dshHome`, then ambient `$DSH_HOME`, then `~/.dsh`.
- `DSH_SHELL=1` is always present and identifies a model bash child managed by DeepSeek Harness.
- `DSH_SESSION_ID` is present when the execution has an agent and equals `agent.session.header.id`.
- The built-in persistence translator contributes `DSH_SESSION_JSONL` only when `ctx.sessionPersistence.locate(header)` returns `kind: 'jsonl'`.

Session persistence remains the fact owner: JSONL does not depend on tool-bash or register shell variables itself, and hooks continue to consume `locate()` directly. Tool-bash is the translation layer from the persistence fact into a shell convention. Other plugins that need shell-visible facts depend on the registry and register their own keys; they do not modify `process.env`.

The bash seam exports `DSH_ENV_PREFIX` as the single namespace source and derives `DshEnvironmentKey` from its `typeof`. Tool-bash derives built-in names and model guidance from that constant, while executors use it for ambient filtering. The seam carries the managed overlay separately as `ShellExecRequest.dshEnv` / `ShellExecSpec.dshEnv`: ordinary `env` remains the general in-process plugin surface used by hooks, while `dshEnv` is typed to managed keys. The local executor removes every inherited ambient managed key, applies its ordinary scrub/terminal environment/explicit `env`, and finally merges the trusted `dshEnv` snapshot, so an `env` entry can never displace a managed value. This guarantees that a missing value means absent now rather than inherited from an outer or previous harness. The model-facing tool still ignores model-supplied `env`/`stdin` arguments.

The bash tool description teaches only the durable convention: current harness environment facts are available through managed `$DSH_*` variables and may be inspected when needed. It does not enumerate persistence-specific keys or add a permanent system-prompt section. Tool schemas are already logged in request headers and tool output is logged as `tool/result`, so no new session event is required.

The [Claude Code and Codex hook bridges](2026-06-30-hook-bridges.md) resolve transcript location from the same persistence seam when constructing payloads. Codex uses `transcript_path: string | null`; Claude Code preserves its string field and falls back to `''`. Hook lookup neither materializes nor flushes a session.

## Peer product findings

Peer products separate stable identity from physical storage. Codex injects stable `CODEX_THREAD_ID` into spawned shells while recorder and hook integrations own transcript paths. Claude Code supplies `session_id` and `transcript_path` as structured hook/status input. OpenCode carries identity in structured tool context; Kimi Code expands a session placeholder; Reasonix keeps the active session path on its controller. The portable rule is to inject identity at the invocation boundary, let storage resolve location, and never use a process-global current-session variable in a concurrent harness.

## Lifecycle and persistence semantics

A fresh session receives its id before the first turn, so its first bash call can read `DSH_SESSION_ID` and a JSONL target. The JSONL file may still be absent until the first successful turn-end checkpoint, and during an open turn it contains only the last flushed prefix. `DSH_SESSION_JSONL` is a location hint, not an authorization credential or freshness guarantee.

Resume reuses the loaded header and therefore the same id and location. Fork and spawn create new session ids and locations. Parent and child calls resolve from their own `ToolExecution.agent`; each command receives an immutable snapshot even when calls overlap. A persistence service replacement affects later collections because the translator queries `ctx.get('sessionPersistence')` at execution time; the registry itself is effect-scoped and HMR-safe.

`dshHome` is session-independent deployment context. Agent-core resolves one value through `@deepseek-ai/dsh-home-paths` and routes it to both tool-bash and local skill discovery; standalone consumers call the same resolver. If top-level `dshHome` and `skills.local.dshHome` are both supplied and resolve differently, composition fails instead of exposing contradictory homes. Persistence may change independently without freezing its facts into the session prefix.

## Testing

Unit coverage pins registry declaration validation, effect disposal, per-execution collection, the `dshHome` precedence, and the local executor's `DSH_*` scrub/rebuild order. Request-recording tests cover foreground/background snapshots, no-agent calls, absent/JSONL persistence, ignored model `env`, and parent/child isolation. JSONL/SQLite locator contract tests and both hook bridge suites pin available and unavailable transcript dialects.

A keyless full-loop integration drives the real agent loop, JSONL persistence, tool-bash, and bash-local on the first turn. The child prints `DSH_HOME`, `DSH_SHELL`, session id, JSONL target, and an inherited stale sentinel; the test verifies current values, absence of the stale variable, pre-flush file absence, and the eventual persisted header. Snapshot coverage pins the generic bash description in the recorded request header. No with-key test is required because the contract is deterministic local execution rather than model choice.

## Alternatives considered

**Only an id plus `find`.** Search cannot know a custom root or backend layout and races under multiple sessions.

**Only an absolute path.** A path can be unavailable, lazy, or representation-specific and is not stable session identity.

**Global `process.env`.** Concurrent agents would overwrite one another and nested harnesses would inherit stale current-session values.

**Put persistence instructions in the session prefix.** A session prefix is frozen while the active service can change across HMR or future backend switching; persistence-specific guidance would become stale.

**A typed waterfall event.** Listeners cannot declare ownership without running, and later listeners can silently overwrite keys. A registry detects key conflicts at registration and remains enumerable.

**Have each persistence backend register bash env directly.** That reverses the dependency from storage into one consumer and forces bash into deployments that do not use it. `locate()` is also still required by hooks.

**A model-facing `session_info` tool.** It adds schema and another call while bash already supplies the query API; the registry generalizes to future environment facts without one tool per fact.

## Consequences

Every model bash child receives current Harness home and shell identity, and agent calls additionally receive stable session identity. JSONL-backed calls get an optional target path; non-file persistence omits it honestly. The managed `DSH_*` facts inside these children come from the harness: ambient values are removed, current trusted values are re-added last, and an ordinary caller's `env` entry cannot displace them.

The namespace is discoverable but not secret. Paths can reveal configured roots, lazy targets can be absent or stale, and a command can override variables inside its own shell syntax. Consumers treat them as correlation and environment facts, verify transcript metadata when attribution matters, and rely on sandbox/filesystem policy rather than variable secrecy for authorization.
