# @deepseek-ai/dsh-terminal

English | [中文](README.zh.md)

Owner-scoped persistent PTY seam. `TerminalSessionService` registers as `ctx.terminals`, mints opaque session ids, routes creation through named backends, fences every operation to the exact live `Agent`, and awaits backend quiescence when that agent or the service disposes.

## Contract

- Backends register one stable `type` and return an unpublished `TerminalBackendSession`; failed or cancelled setup must clean partial resources, and a failed cleanup rejects with `TerminalBackendCleanupError` so the registry can retain it across cancellation.
- Spawn cancellation preserves the caller's exact abort reason. Service disposal and owner loss remain distinct machine-routable failures after backend setup.
- Owner and service disposal abort unpublished setup through a service-owned signal and await backend settlement plus rollback before returning.
- A rollback-close or backend-reported startup cleanup failure rejects the disposing lifecycle instead of claiming quiescence. Caller-triggered cancellation still receives its exact reason; lifecycle-triggered rollback failure also rejects the pending spawn.
- A backend cleanup failure that follows caller cancellation remains owner activity until owner or service disposal consumes and reports it, so lifecycle policy cannot mistake failed cleanup for quiescence.
- `hasOwnerActivity(owner)` spans unpublished setup through final close, so lifecycle policy can fence the exact owner without a publication race.
- A successful spawn publishes one `TerminalSessionId`. The optional `name` is owner-local display metadata, never authority.
- One session accepts at most one live send operation. Reads and signals may observe it; another send fails until the operation settles.
- `TerminalSendResult.waitReason` and `sessionStatus` are independent. `session_exit` describes the top-level PTY process, not an arbitrary foreground command.
- `kill()` and disposal resolve only after the backend's captured process tree is quiescent. A cleanup failure rejects instead of claiming success and clears the matching backend and registry fences so a later close can retry without disturbing a newer attempt.

The seam contains no `node-pty`, sandbox, tool-schema, prompt, task, or terminal-rendering policy. Implementations own terminal mechanics; consumers own model presentation and optional background-job registration.

## Model Experience

### Indirect consumer

#### What the model sees

Nothing directly. This package registers no prompt or tool; `@deepseek-ai/dsh-tool-terminal` owns visible schemas and result text.

#### Token effect

None directly. Live session state stays process-local until a consumer returns a bounded result.

#### KV Cache effect

No direct invalidation; the named consumer owns request-prefix changes.

## Known Limitations and Deferred Work

- Sessions are process-local and are not restored after a harness restart.
- Cross-agent sharing is intentionally absent; a future shared-session design needs a separate authority contract.
