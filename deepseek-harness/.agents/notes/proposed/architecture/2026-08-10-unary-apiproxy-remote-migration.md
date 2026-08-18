# Agent Note: Migrate simple unary API Proxy calls to business Remote services

Status: proposed

English | [中文](2026-08-10-unary-apiproxy-remote-migration.zh.md)

## Problem

The Host API Proxy still owns many unary methods whose implementation is only service lookup, argument projection, one business call, and response projection. That duplicates the contract across the business Service, API Proxy interface, Zod schemas, route table, client stub, and Client caller even though [Typert Remote calls](../../implemented/architecture/2026-08-02-typert-remote-method-calls.md) already let the business package own this class of call.

Moving a method mechanically is not sufficient. Agent-bound API Proxy methods call `agentFor()`, which reuses a live Agent, resumes an ordinary cold Session with its recorded preset, deduplicates concurrent resumes, and rejects subagent-owned identities. A Remote method that resolved an `Agent` or `Session` differently would change lifecycle behavior even when the final business call looked identical.

The API Proxy also contains BFF operations whose contract is not a business method: Session lifecycle and transcript assembly, model-selection state, live-only input control, configuration filtering, skill presentation, Host composition facts, and native desktop operations. Stateful interactions and streams have different lifecycles again. Treating all unary syntax as evidence that a method is simple would move product policy into arbitrary Service packages or force new packages that have no independent business owner.

Finally, Connection currently applies its loopback-only privileged-method list inside the API Proxy fallback. A Typert interceptor claims its endpoint before that fallback, so migrating credential or preset authoring calls without moving the privilege check would grant trusted-LAN callers operations that are currently loopback-only.

## Proposal

Migrate only unary calls whose business operation already has a natural Service owner and whose remaining adaptation is a small parameter or result projection. The Service binds a Typert namespace and decorates an existing method directly with `@Remote` when its signature is the intended consumer contract. A new method is justified only when it performs real adaptation; an identity `remote*` forwarding wrapper is not.

`@deepseek-ai/dsh-api-remotes/client` will mount each selected business package's generated `/remote` contribution. Client business packages will call `ctx.remote.<service>` and perform Client-owned joins or presentation projection there. The corresponding API Proxy interface member, schema, route, handler, generated client method, fixture implementation, and production invocation will be removed together in that Service's vertical commit.

Large BFF methods remain in `dsh-host-apiproxy`. A method leaves this migration if implementation discovers endpoint-specific lifecycle policy, substantial orchestration, a Client dependency on a protocol-only error distinction, or a transport shape that cannot be expressed as a small owner-side adapter.

## Migration set

| Legacy RPC | Remote destination | Host method | Adaptation |
|---|---|---|---|
| `session.rename` | `ctx.remote.sessionTitle` in `@deepseek-ai/dsh-session-title` | `SessionTitleService.rename(Session, title)` | Direct `@Remote`; Client maps `eventSeq` to its title projection sequence. |
| `command.list`, `command.execute` | `ctx.remote.commands` in `@deepseek-ai/dsh-commands` | `CommandRuntime.list(Agent)`, `execute(Agent, line, signal)` | Direct `@Remote`; Client maps `undefined` to unmatched and preserves caller cancellation. |
| `llm.providers` | `ctx.remote.llm` in `@deepseek-ai/dsh-llm` | `LlmRuntime.listProviders()`, `listConfigurableProviders()` | Direct `@Remote` on both reads; the Client joins registration and configuration-directory rows. |
| `credentials.describe`, `credentials.set`, `credentials.unset` | `ctx.remote.credentials` in `@deepseek-ai/dsh-credentials-local` | `LocalCredentialProvider.describe(ref)`, `set(ref, value)`, `unset(ref)` | Direct `@Remote`; Client batches `describe` calls when its UI requests several refs. |
| `agentPreset.read`, `agentPreset.copy`, `agentPreset.remove` | `ctx.remote.agentPresets` in `@deepseek-ai/dsh-agent-presets` | `readDocument(id)`, `copy(from, id, name?)`, `remove(id)` | `copy` and `remove` are direct; `readDocument` combines stored content with metadata from one live discovery. |
| `subagent.interrupt` | `ctx.remote.subagents` in `@deepseek-ai/dsh-subagent` | `interruptByParent(targetSessionId, parentSessionId)` | Adapter constructs the internal user-authority variant without resolving or resuming either Agent. |
| `workspace.list`, `workspace.insertSessionBefore`, `workspace.archiveSession` | `ctx.remote.workspace` in `@deepseek-ai/dsh-workspace` | `snapshot()`, `insertSessionBefore(workspaceId, sessionId, before?)`, `archiveSession(sessionId)` | Registry adapters detach mutable entities and return the settled workspace or archive snapshot. |

The Remote API deliberately follows Service names rather than preserving dotted legacy names. For example, Session rename becomes `ctx.remote.sessionTitle.rename(...)`.

## Deferred API Proxy domains

| Domain | Methods | Reason retained in the API Proxy |
|---|---|---|
| Session Host lifecycle | `session.list`, `search`, `create`, `fork` | Cross-Agent persistence, Workspace assignment, preset composition, and creation policy. |
| Session transcript | `session.history`, `attachment`, `subagent.history` | Cold/live logs, pagination, projections, presenters, and attachment authorization. |
| Agent model selection | `session.models`, `selectModel` | Per-Agent state, model validation, and default persistence are BFF policy. |
| Agent input and control | `session.prompt`, `updateQueue`, `cancel` | Image admission, Inbox mutation, and endpoint-specific live-only semantics. |
| Configuration Remote | `settings.describe`, `openDocument`, `update`, `replace`, `mutate` | Namespace exposure, redaction, revision checks, and native opening are product policy. |
| Session skill catalog | `skill.list` | Cold Sessions must not resume; preset standing scope and presenter filtering are BFF joins. |
| Host runtime information | `host.describe` | Version, cwd, default model, and attached count combine several Host owners. |
| Host path opening | `host.openPath`, `agentPreset.openDocument` | Native desktop authority and cancellation belong to the Host composition. |
| Remaining preset, subagent, and workspace calls | `agentPreset.list`, `select`; `subagent.list`, `history`, `prompt`; `workspace.create`, `rename`, `delete` | These calls contain roster policy, live/cold joins, authorization, or serialized multi-operation ordering. |
| Stateful and streaming protocol | approvals, questions, responses, mux and Host streams | They are not one-request/one-result business calls. |

`workspace.delete` stays with `create` and `rename` because all three participate in the same serialized creation/name/delete chain. Splitting one method out would make the Service and API Proxy observe different operation orders.

## Agent and Session lookup equivalence

`createApiRemoteAgentResolver()` constructs one resolver and returns it as the API Proxy's `agentFor`. The same closure is installed through `ctx.typert.lookups.configure('agent', ...)`, `ctx.typert.lookups.configure('session', ...)`, and `ctx.typert.contexts.configureHost('agent', ...)`. Therefore a Remote `Agent` or `Session` parameter and a legacy `agentFor()` call share the same live lookup, in-flight resume table, persistence inspection, preset-aware setup, and ownership fence.

The migration must pin these outcomes with integration tests:

- a live ordinary Agent is reused without a resume;
- an ordinary cold Session resumes with its persisted header, events, and recorded preset setup;
- concurrent Agent and Session lookups for one id share one resume;
- a live or cold subagent-owned identity fails with `agent-busy` before business invocation;
- an id missing from durable persistence fails with `session-not-found`;
- resolver failures keep their existing `RpcError` through `TypertLookupFailure`.

Lookup policy is key-wide, not endpoint-specific. Methods such as prompt, queue editing, cancellation, model selection, and skill listing cannot use the shared `agent` or `session` lookup while retaining live-only or no-resume behavior, so they remain in the API Proxy until Typert supports an explicit per-endpoint policy.

Methods whose signatures contain only branded ids do not invoke Typert object lookup. `subagents.interruptByParent()` must retain the existing process-local Activation lookup and parent-offline behavior: it does not call `agentFor`, read the catalog, inspect persistence, or cold-resume a parent or child.

## Client and error behavior

Generated Remote methods return business values and throw an Error whose `cause` contains the existing RPC failure. Client business services own adaptation to their current result/store interfaces. They must settle successful results immediately exactly as they do today so event frames remain idempotent replays rather than the only update path.

Resolver-owned `session-not-found` and `agent-busy` errors remain stable because the shared resolver raises `TypertLookupFailure`. Ordinary business exceptions become the Gateway's existing `internal` RPC failure. A selected Client consumer may migrate only if it does not branch on a more specific legacy business error code; if implementation finds such a branch, that RPC leaves this set unless the business package gains a transport-independent typed failure.

## Privileged authority

Connection must enforce privileged endpoint authority before choosing the Typert interceptor or API Proxy fallback. The check must recognize both legacy dotted names and Remote slash endpoints and keep these migrated operations loopback-only:

- `agentPresets/readDocument`, `agentPresets/copy`, and `agentPresets/remove`;
- `credentials/describe`, `credentials/set`, and `credentials/unset`.

The carrier-wide trusted-host and origin checks remain unchanged. This is a non-escalation requirement: endpoint ownership may change, but the set of callers authorized to invoke the operation may not widen.

## Commit boundaries

The migration lands as an RFC commit, one vertical commit for each Service, and one final integration commit. A Service commit includes its Host binding and decorators, generated-contract package declarations, API Remotes mount, Client business adoption, and removal of that Service's legacy API Proxy route and production client call. Service commits may be temporarily red because generated artifacts and shared fixtures are reconciled once in the final integration commit.

The final commit generates every `/remote` artifact from a clean state, updates shared fixtures and tests, moves this note to `implemented`, updates the still-authoritative protocol documentation where central unary ownership changed, and runs the selected repository gates.

## Alternatives considered

**Keep simple methods in the central API Proxy.** This preserves one transport facade but continues the duplicated interfaces, schemas, route rows, stubs, and business projections that Typert was introduced to remove.

**Move every unary API Proxy method.** Unary syntax does not imply single-owner behavior. Session orchestration, live-only control, configuration exposure, and native Host operations would either leak BFF policy into generic Services or create ownerless packages.

**Give Remote methods a separate resume implementation.** A second resolver could drift on preset restoration, concurrent deduplication, or subagent ownership. Sharing the exact closure with legacy `agentFor()` makes equivalence an implementation fact rather than a promise.

**Preserve every legacy RPC name and response envelope.** That would turn business packages into copies of the old protocol. Service-oriented names and business values let the Client own joins while Connection continues to own the one RPC envelope.

**Trust the API Proxy fallback to enforce privileged methods.** Interceptor selection bypasses that fallback, so this would silently widen authority for migrated methods.

## Acceptance criteria

- Every migration-table method is callable through its listed `ctx.remote` Service and has no production legacy API Proxy route, schema, map row, client stub, or invocation.
- Existing methods with matching signatures carry `@Remote` directly; every added method performs the adaptation stated in the table and no identity `remote*` wrapper remains.
- Agent/Session integration tests prove the shared lookup outcomes, and subagent interrupt tests prove no cold resume occurs.
- Privileged migrated endpoints reject trusted non-loopback callers and accept loopback callers before either dispatch path runs.
- Client behavior and immediate state settlement remain equivalent for every migrated call, including cancellation where supported.
- Deferred methods remain on the API Proxy with their existing behavior.
- A clean generation/build produces and consumes every selected Remote contribution, and focused tests plus final repository gates pass.

## Risks

Removing legacy schemas also removes their protocol-specific error taxonomy. A hidden Client branch on one of those codes would make the call non-simple and must be discovered before its Service commit is accepted.

Generated Remote contracts add build ordering and publication entries to each business package. Missing one runtime mount, declaration export, source-map source, package dependency, or Project Reference can pass a narrow source test while failing a clean Client build.

Moving privilege enforcement to composite dispatch changes security-sensitive carrier code. Tests must exercise both a Remote-owned endpoint and a legacy fallback endpoint so neither path can bypass the loopback decision.

This note applies the existing Typert Remote architecture rather than superseding it. It partially supersedes the central unary ownership and five-step extension checklist in the [GUI RPC protocol note](../../implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md) and the central wiring inventory in the [Web configuration plane note](../../implemented/architecture/2026-07-30-web-config-plane.md); those notes remain authoritative for Connection envelopes and configuration behavior outside the migrated methods. The title, command, configuration-boundary, subagent-interrupt, and archive notes continue to own their business behavior and require factual transport updates rather than archival. The [browser trust boundary](../../implemented/architecture/2026-07-28-api-browser-trust-boundary.md) and [generated-contract build order](../../implemented/process/2026-08-08-api-remotes-generated-contract-build.md) remain authoritative and require no archival action.
