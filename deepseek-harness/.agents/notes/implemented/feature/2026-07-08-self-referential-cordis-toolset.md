# Agent Note: The self-referential cordis toolset

Status: implemented

English | [中文](2026-07-08-self-referential-cordis-toolset.zh.md)

## Problem

Everything in this harness is a cordis plugin, but the agent running inside that plugin runtime cannot see or touch it: it cannot enumerate the services and events around it, cannot extend itself with a new tool mid-session, and cannot compose capabilities it invents. Handing the model that power is worth exploring — a self-referential agent that inspects and modifies its own runtime — but it raises three correctness problems at once, and the design is about answering them rather than the raw "let the model run code" mechanic.

First, model-written registration must be validated where it happens: a malformed tool schema has to fail at registration, not when a later request tries to assemble it into a prompt. Second, model-written code has to call service APIs whose source it has never seen — guessed method signatures and, worse, guessed return-value shapes cost many steps of blind probing. Third, everything the model mounts must be fully disposable, by the model on demand and by the ordinary plugin lifecycle when the host plugin reloads, or a long session accretes orphaned listeners and tools.

## Decision

The toolset ships as [`@deepseek-ai/dsh-tool-cordis`](../../../../packages/extensions/tool-cordis/README.md) and is demoed by `examples/web-cordis`. It gives the model three tools over the live Cordis runtime in the current DSH process: inspect it, mount an in-memory temporary Plugin, and unmount that Plugin to quiescence.

The vm isolates accidental global pollution, and the context façade hides framework internals. Neither restricts the authority of exposed services: a temporary Plugin can call `ctx.shell` with the host executor's privileges and reach the real filesystem and web services. It runs in the shared DSH runtime and may affect other sessions in that process. This is an opt-in development tool with bash-equivalent trust, not a security boundary or product default.

### The three tools

| Tool | Contract |
|---|---|
| `cordis_inspect` | Read-only report over the live current-process runtime, one Markdown section per `what` value (omit `what` for all sections). `plugins` lists every live fiber; `temporary` lists only the temporary Plugins created by `cordis_mount`. An exact `name` with `what: "api"` or `what: "events"` narrows to one source-documented target. |
| `cordis_mount` | Evaluates `code` now as an async JavaScript-function body in a `node:vm` sandbox and saves it nowhere. The returned Plugin is mounted under the internal `cordis-dynamic` group and tracked under a fresh process-local id (`dyn-1`, `dyn-2`, …). |
| `cordis_unmount` | Unmounts one `cordis_mount` temporary Plugin by id and returns only after every owned tool, listener, service, timer, and effect reaches quiescence. It cannot remove Loader, configured, or installed Plugins. |

`cordis_inspect` sections are `services` (every provided ctx service and owning fiber), `plugins` (every live plugin fiber), `tools` (what the model can call), `temporary` (the `cordis_mount` subset with id, running/pending state, provided and awaited services, and lifetime), `api` (live service signatures and referenced types), and `events` (harness events with dispatch mode and signature). Temporary Plugins remain active across later turns and disappear after `cordis_unmount`, toolset unload, or DSH restart; they are never restored automatically. Broad `api` and `events` reports omit full JSDoc to stay compact; an exact `name` returns one service or event with its original method/declaration JSDoc. A name is invalid with other sections, unknown targets fail, and an API target must be live. The model-facing tool descriptions carry the operational rules needed at call time; [the generated tool catalog](../../../../docs/tool-catalog.md) is their exhaustive rendering.

### Sandbox semantics

Mount code runs as an async-function body in a fresh vm realm. Its documented API steers file, network, process, and timer access through Cordis services so mounts remain inspectable and disposable. Host-realm helpers still make Node escape possible, consistent with the trusted posture. `vmTimeoutMs` bounds only synchronous evaluation.

Sandbox globals are deliberately small: a tagged write-through `console` (`[cordis:<id>] …` on the host stdout/stderr, so a listener that fires long after the mount call still lands somewhere the user sees), the `harness.defineTool` / `harness.registerTool` registration pair, the encoding primitives fresh vm contexts lack (`btoa`/`atob` as host closures over `Buffer` — a sanctioned exception, `Buffer` itself is never exposed — plus `TextEncoder`/`TextDecoder`), and callable traps over the withheld Node APIs (`require`, `setTimeout`/`setInterval`/`setImmediate`/`clearTimeout`/`clearInterval`, `fetch`) that throw a redirect naming the cordis alternative. Only function-shaped globals are trapped; `process` and `Buffer` stay `undefined` so a `typeof` feature probe stays inert rather than detonating a throwing accessor.

Mount code crosses the vm boundary through three controls. Dual-realm `instanceof` recognizes both host and vm objects. `harness.defineTool` rebuilds the output schema/projectors in the host realm, snapshots the body value as host-owned JSON, and lets the registry enforce the [canonical tool-output contract](../architecture/2026-07-20-canonical-tool-output-contract.md) before observation. The mounted plugin receives a whitelist context façade, not a raw or pass-through `Context`; framework plumbing and context-valued returns are rejected. Service reads require a declared `inject`, preserving Cordis activation and unload semantics. `ctx.tools.get` exposes only the schema view, so mounted code cannot bypass `ToolRuntime.execute` by calling a definition directly.

The boundary normalizes unambiguous JSON-Schema forms into `ParameterSchemaSpec`, preserving `integer`, raw object openness, and required arrays. Direct DSL object nodes must declare `additionalProperties`; invalid vocabulary fails with the accepted alternatives. Parse, TypeScript, missing-return, Node-API, and duplicate-tool errors include the relevant source line or corrective contract without narrating implementation internals.

### The internal group and temporary-Plugin lifecycle

Every temporary Plugin is a child of one internal `cordis-dynamic` group beneath the tool plugin, so ordinary fiber disposal handles toolset reload and unload. `cordis_mount` awaits settlement; startup failure disposes the fiber before returning an error. A settled pending Plugin remains visible with its missing injections. `cordis_unmount` awaits the Plugin fiber's disposal.

Temporary Plugins exist only in process memory. They create no Plugin file, install no package, change no `cordis.yml` or personal/project configuration, do not survive restart, and have no automatic save, promote, or install path. Keeping an experiment means asking the Agent to implement a normal project Plugin or installable profile bundle through the regular development workflow.

### Cross-mount composition via provide/inject

Mounts relate to each other through ordinary cordis service semantics, with their ids as the lifecycle handles: mount A calls `ctx.provide('foo', value)`, mount B declares `inject: ['foo']` and activates the moment `foo` exists; mounted first, B stays pending and names the missing service; unmounting A sends B back to pending (its registrations unwound) and a later re-provide re-runs B's `apply` through a fresh sandbox façade; a duplicate provide fails loud with the owning fiber named. One realm caveat: a service value provided by a mount is a vm-realm object — method calls on it work from anywhere, but consumers must not assume host prototypes on it.

### The generated API catalog

`cordis_inspect` serves API and event data from a generated catalog rather than a duplicated table. The generator reuses the Cordis catalog AST scan and emits service summaries, signatures, original service-method and event JSDoc, event modes, referenced type declarations, and the inherited context API. Ambiguous type names are omitted and oversized declarations are marked as truncated.

Freshness is gated like every generated artifact: `pnpm run verify-cordis-api` (in `doc-sync`) regenerates in memory and fails on any diff, so a JSDoc or public-signature edit cannot ship without regenerating the catalog the model reads. At runtime the inspect tool intersects the catalog with the live runtime rather than dumping it: broad reports render live catalogued services as summary + signatures, live services without a catalog entry (mount-provided ones) as name + owning fiber, catalogued services with no live provider tersely, and then the referenced type shapes. Exact-name reports render one live service or event with the original JSDoc immediately before each signature; keeping that detail opt-in avoids charging its token cost on exploratory listings.

### Configuration, rendering, and observability

The plugin exposes one config field, validated by schemastery and documented in [the config catalog](../../../../docs/config-catalog.md): `vmTimeoutMs` (default 5000), the millisecond bound on the synchronous portion of code evaluation. The current model-facing names are `cordis_inspect`, `cordis_mount`, and `cordis_unmount`; the internal `cordis-dynamic` group name and `dyn-` id prefix remain structural vocabulary. All three tools render as `generic` cards per [the tool cookbook](../../../../docs/cookbook/adding-a-tool.md): inspect is `read`, mount is `execute` carrying code as `rawInput`, and unmount is `delete`. Web conversation rows preserve those generic mechanics while giving the tools the action titles `Inspect`, `Mount temporary Plugin`, and `Unmount temporary Plugin` plus one shared Cordis accent; the mount row retains the shared JavaScript expansion and syntax highlighting.

Model-visible ⟺ logged holds with no new session event type: mount and unmount are visible through their logged `tool/call` / `tool/result` pairs, and any changed tool set is logged by the full changed request header emitted when schemas change between steps. Temporary Plugins are process memory, not session state: session resume rehydrates conversation history but never recreates them.

## Alternatives considered

**A structured per-capability registration tool instead of `cordis_mount`.** The most tempting alternative is a `cordis_register_tool` with explicit `name` / `description` / `parameters` / `code` fields (and siblings `cordis_register_listener`, `cordis_register_service`, …) rather than a single "mount a plugin" primitive. It was rejected because its one real win — no plugin boilerplate for the single commonest case — does not pay for its costs, while a single mount primitive answers every capability at once.

| Dimension | Structured per-capability tools | Single `cordis_mount` |
|---|---|---|
| Schema correctness | `parameters` is still model-written JSON needing unified-schema validation, merely one step earlier | The same validation runs at the sandbox boundary, with the same instructive errors |
| The code field | An `execute` body is still model-written JS in a vm; the realm and service-call correctness problems are unchanged | One sandbox, one normalization path, one guarded registration |
| Capability coverage | Tools only; listeners, services, `inject` relations each need another structured tool — an API that grows without bound | One vocabulary (a cordis plugin) covers every effect, present and future |
| Cross-mount composition | Not expressible in a tool-registration payload | Native `provide`/`inject`, ordinary cordis semantics |
| Inspectability | Registers something the plugin list cannot show as a plugin | What the model mounts is exactly what `cordis_inspect` renders |
| Model ergonomics | Wins for the single most common case (no plugin boilerplate) | Mitigated by the canonical recipe in the mount description plus boundary errors that teach the fix |

The correctness investment therefore goes where it pays for every capability at once: the generated API catalog surfaced through `cordis_inspect`, and sandbox-boundary validation whose error messages teach the correct call. A structured registration tool remains addable later as sugar that synthesizes mount code; nothing here forecloses it.

**A hand-maintained service/event reference in the tool.** The first cut of the inspect tool carried a hand-written table of service method signatures. It was replaced by the generated `api-catalog.ts` because a hand table drifts from the JSDoc the moment a signature changes and nothing gates the drift, whereas the generated artifact is freshness-checked against the same AST the docs use.

**A new `cordis/mount` session event.** A durable event recording each mount's source and name has clear precedent (`hook/invoked`, `compaction/start`). It was declined for v1: mount and unmount are already visible as `tool/call` / `tool/result` pairs and the tool-set change is already logged as a full changed request header, so a dedicated event would only duplicate the record. It remains addable if an audit use case needs the mount source and name outside the tool call.

**A hardened / capability-restricted sandbox.** Trapping Node built-ins and handing mount code a whitelist façade rather than the raw context might suggest an intent to sandbox for safety. It is explicitly not that: the traps and the façade narrow the *API* mount code sees — steering it onto cordis services and away from leak-prone Node built-ins and framework internals — for correctness and to close the unguarded-context escape, but the capabilities the façade exposes (`ctx.shell`, `ctx.fs`, `ctx.web`) reach the real runtime, so it is not a security boundary. A real one (separate process, permission prompts) was out of scope for a dev/opt-in toolset and would fight the entire point — handing the model the live runtime.

## Consequences

The toolset is a deliberate opt-in with a fully-privileged `ctx`, so a deployment adopts it as consciously as a bash tool. Several facts follow that the tool descriptions warn the model about directly: a waterfall listener (e.g. `tools/pre-execute`) that returns without calling `next()` short-circuits the chain, so a mounted listener can stop the agent's own tool dispatch ([waterfall semantics](../../../../docs/cordis-primer.md#cordis-waterfall-semantics)); mount code runs inside a tool call of the current turn, so awaiting anything that resolves only after the turn deadlocks; `vmTimeoutMs` bounds synchronous evaluation only; and mounts do not survive session resume.
