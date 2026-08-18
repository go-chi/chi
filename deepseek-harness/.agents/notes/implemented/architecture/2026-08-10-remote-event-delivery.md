# Agent Note: Remote event delivery (ctx.remote.$on)

Status: implemented

English | [中文](2026-08-10-remote-event-delivery.zh.md)

## Problem

[Typert Gateway targeted method calls](../../implemented/architecture/2026-08-02-typert-remote-method-calls.md) cover only the request/response shape and deliberately leave Session event streams and stateful interactions to separate designs. Every **one-way Host-to-consumer push** therefore still rides the legacy API Proxy.

The Host owns a family of one-way events whose payloads are already JSON and whose emission never binds an AgentScope: `agent-preset/selected`, `commands/change`, `credentials/updated`, `llm/adapters-updated`, and `settings/document-updated`. Reaching one UI subscriber took four hops: the Host cordis event, a hand-written `HostFrame` variant plus its zod branch in apiproxy, a hand-written bridge in client/runtime that re-emitted it as a Client cordis event, and finally the consumer's `ctx.on(...)`. Adding one such event edited five places (frame union, zod union, host-stream listener, client bridge, a duplicated Client-side `Events` declaration), and not one of them stated a new fact: the name, the payload type, and the emission point were all declared by the owner package's cordis `Events` merge.

That duplicated declaration is also **lossy**: the Client side restates it as `settings/changed(ns: string)`, flattening a branded type into bare `string` — the opposite of the Remote method contract, where a consumer type points at the business package's one canonical symbol.

## Decision

The consumer Remote surface carries one one-way subscription verb, `ctx.remote.$on(event, listener)`, driven by an allowlist and forwarding verbatim:

- `packages/api/remotes/src/remote-events.ts` holds the allowlist of forwardable Host events, and it is the single control point over what a consumer may subscribe to. `src/types.ts` beside it derives the type projection and fills the selection seat, staying type-only per the package convention. Both files are listed in the `files` of **both** of this package's faces, so the Host forwarding loop and the consumer key surface read one declaration.
- The wire event name **is** the Host cordis event name (`settings/document-updated`) with no `host/` prefix, and the payload **is** the Host argument list, element for element, with no projection, redaction, or renaming.
- The carrier reuses the existing host stream: `HostFrame` gains one wrapper variant, `host/remote-event`. No new downlink.
- Event **signatures** get no second table. Each owner package moves its cordis `Events` declaration into its client-safe, type-only `./types` export, so both faces read the same declaration and `$on`'s listener type is `Events[Event]` itself. "Verbatim" then holds by construction rather than by proof.
- Only cordis's *type shape* is borrowed, not its event system: delivery semantics, the subscription registry, and failure containment belong to Typert.

When an `Events` entry's signature reaches a Host-only symbol (a Service, `Agent`, a Context), the answer is to **split the code until the entry lands cleanly in `./types`** — never a declaration half-left in `index.ts`, and never a structurally equivalent shadow type in `./types`. None of the five packages needs that here: their entries reach only `SettingsNamespace`, `SettingsUpdateSource`, `CredentialRef`, and `SessionId`, all pure types. The agent-presets package renames its previous vocabulary module to `preset.ts`, leaving the exported `types.ts` dedicated to the client-safe event declaration.

All five events ride this path, and their dedicated `HostFrame` variants or Client aliases are gone. Model consumers subscribe directly to both owner inputs, `llm/adapters-updated` and `settings/document-updated`; preset-derived consumers subscribe to `agent-preset/selected`. Frames that actually project or deduplicate data stay dedicated: `host/workspace-changed`/`-removed`/`host/archived-sessions-changed` (view derivation plus per-connection dedup state), and `host/session-added`/`-removed`/`host/session-status`/`host/agent-error` (live-object projection or frame-time derived fields).

`skills/change`, `tools/change`, and `system-prompt/change` have the same shape but **no consumer today**; under "require a current owner and need" they stay out of the allowlist and are recorded here only as the extension seat.

### Consumer contract (dsh-typert-protocol)

type-meta gains one **shape predicate**, one **selection seat**, and **one** member on `TypertClientRemote`. No runtime code:

```ts
import type { Events } from '@deepseek-ai/cordis'

/** Cordis events shaped for one-way remote delivery: no Scope binding, void return. */
export type TypertForwardableEvent = {
  [Event in keyof Events]: unknown extends ThisParameterType<Events[Event]>
    ? ReturnType<Events[Event]> extends void ? Event : never
    : never
}[keyof Events]

/** The Host assembly's forwarding selection; api/remotes' allowlist fills it, no other package does. */
export interface TypertRemoteEventSelection {}

/** `$on`'s legal keys: selected, and present in the current compilation face. */
export type TypertRemoteEvent = Extract<keyof Events, keyof TypertRemoteEventSelection>
```

```ts ignore-check
/** Subscribe to one forwarded Host event; the returned disposer belongs to the calling fiber. */
$on<Event extends TypertRemoteEvent>(event: Event, listener: Events[Event]): () => void
```

`Events` resolves per program: the full Host vocabulary in the Host program, whatever the Client face can see in the Client program. The same predicate therefore holds on both sides without dragging Host declarations into the Client.

**The surface separates the consumer verb from the carrier handoff**: consumers subscribe with `$on`, and whoever owns the Host frame sink hands each decoded frame over with `$dispatch`. It cannot be a module-level function reaching across Client plugins — the client bundle purity gate (`packages/client/tsdown.client.ts`) admits value imports only from `CLIENT_EXTERNALS`, the `INLINE_SAFE` wire layer, and generated `/remote` contributions, and inlining around it would copy `ClientRemoteService` into the runtime bundle, making `instanceof` permanently false. A cordis service method is the collaboration shape that gate prescribes:

```ts ignore-check
$dispatch(event: string, args: readonly unknown[]): void
```

client/runtime — the owner of the host frame sink — calls it directly, so the frame reaches the subscription table without an intermediate event to relay it. The `event` parameter is `string`, not `TypertRemoteEvent`: this is a wire boundary, and a name nobody subscribed to is dropped silently.

Delivery shares no implementation with the cordis event system: one-way only, no waterfall/bail/parallel/serial modes and no `@mode` concept (`ReturnType extends void` is the static expression of that rule), no `this` binding, no `EventOptions`, `prepend`, or priority. Listeners run in registration order, and one that throws is contained and logged — it must never take down the frame pump (the same posture `ConnectionController` already applies to its sinks).

### The allowlist: one declaration both faces read

`packages/api/remotes/src/remote-events.ts` is listed in the `files` of both `tsconfig.host.json` and `tsconfig.client.json`, and is the allowlist's single home; `src/types.ts` derives its type face:

```ts
// remote-events.ts — the value
export const API_REMOTE_FORWARDED_EVENTS = [
  'agent-preset/selected',
  'commands/change',
  'credentials/updated',
  'llm/adapters-updated',
  'settings/document-updated',
] as const

// types.ts — the type face, derived
export type ApiRemoteForwardedEvent = typeof API_REMOTE_FORWARDED_EVENTS[number]

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteEventSelection extends Record<ApiRemoteForwardedEvent, true> {}
}
```

Forwarding one more event is therefore **one line in that array**: the type projection, `$on`'s key surface, and the Host forwarding loop all derive from it. `ctx.remote.$on('slots/changed', …)` (a Client-local event) and `$on('skills/change', …)` (declared but unselected) are both **compile errors**.

The Host face adds one shape assertion, binding the Host event vocabulary to that same array:

```ts ignore-check
API_REMOTE_FORWARDED_EVENTS satisfies readonly TypertForwardableEvent[]
```

It is an expression statement rather than a named constant, which `noUnusedLocals` would reject (the underscore prefix exempts parameters only). It enforces three things: the **name is real** (the predicate is keyed on `keyof Events`), the event **binds no Scope** (`goal/changed` and kin have a `ThisParameterType` other than `unknown` and drop out — the static expression of "no AgentScope dependency"), and the event is **one-way** (a non-`void` return, i.e. a waterfall/bail shape, drops out).

**"Verbatim" is proved nowhere because it holds by construction**: `$on`'s listener type comes from the one cordis `Events` declaration in the owner package's `./types`, and Host forwarding reads that same declaration. There is no second declaration that could drift.

JSON-safety is a runtime concern: before forwarding, apiproxy validates each argument with `dsh-session`'s `isJsonValue` and **throws loudly** when one fails, because that is an allowlist composition mistake rather than untrusted input.

### Wire contract (apiproxy)

```ts ignore-check
| { type: 'host/remote-event'; event: string; args: JsonValue[] }
```

The zod branch keeps `args: z.array(z.unknown())`: the frame arrives from `JSON.parse`, so every element is already a JSON value, and the structural contract belongs to the owner package's `Events` declaration — the same posture the existing `session/projection` frame takes with its `value`.

`events.host()` subscribes by allowlist when the stream opens. Each stream owns its disposers, so no broadcast set or derived invalidation listener is needed.

`api/events.ts` is a wire contract file the browser side also compiles, so every type it references must come from an owner package's **client-safe, type-only subpath**, never the package root. Evidence: importing one type from `@deepseek-ai/dsh-session` root drags the root's `declare module 'cordis' { interface Context { sessions: SessionStore } }` into the Client compilation face and overrides the Client's `ctx.sessions: ISessions`, producing 18 errors in the unrelated `ui-input-trigger` and `ui-conversation`. `JsonValue` therefore needs a re-export from `dsh-session/src/types.ts`.

### The apps/web browser e2e belong to the Host face

The `apps/web/tests/**` e2e type-check in the root **`tsconfig.host.json`**: they boot a real harness in-process and read `ctx.apiProxy`, the Host `SessionStore`'s `get`/`create`/`flush`, and `ctx.sessionProjectionCache`. **Driving a browser at runtime does not make a file part of the Client program** — moving them into the Client aggregate immediately produces 21 errors, because one program cannot hold both faces' merges for the same Context key.

That yields a discipline this design depends on: **when those tests import a value or a type from a Client package, they pull that package's whole project — and every project it references — into the Host build graph**. Four consumers (`ui-settings-general`, `ui-settings-models`, `ui-permission`, `ui-commands`) reference `api/remotes`' Client face, and that face cannot compile until Host tsdown has generated `@deepseek-ai/dsh-goal/remote`. The result is a build-order deadlock: Host tsc needs the Client face, which needs the generated artifact, which Host tsdown produces after Host tsc.

The few Client-owned symbols are therefore **mirrored** on the test side (`scaffold.ts` exports the mirrored welcome-notice constants; the two chat e2e keep importing `dsh-client-runtime/client` because the `runtime` project is already in the Host graph), which lets those four consumers leave the Host graph. The 15 Client project references in `apps/cli/tsconfig.json` lost their owner-map role and are gone. Each mirrored value matches its source verbatim; a drift shows up as a missed selector or an unsuppressed notice, both loud failures.

### Change inventory

| Location | Change |
|---|---|
| `dsh-typert-protocol` | `src/types.ts` gains `TypertForwardableEvent`, `TypertRemoteEventSelection`, and `TypertRemoteEvent`; `TypertClientRemote` gains `$on` and `$dispatch`. Types only, no runtime |
| `api/gateway` Client half | `ClientRemoteService` implements `$on` (subscriptions addressed by registration, `ctx.effect` ownership for the calling fiber) and `$dispatch` (snapshot delivery in registration order, containing a listener that throws or rejects) |
| `api/remotes` | New `src/remote-events.ts` (the allowlist value) and `src/types.ts` (type projection, selection seat), both listed in both faces' `files`; a `./types` export with `lib/types/**/*.js` added to `files`; the Host face adds the shape assertion and `import type {}` for the five owner `./types`; the Client half re-exports those five plus `@deepseek-ai/dsh-api-gateway/client` |
| Root `tsconfig.base.json` | Client-safe `paths` entries for settings, credentials, llm, agent-presets, and api-remotes types point at the **source** plane |
| `dsh-commands` / `dsh-settings` / `dsh-credentials` / `dsh-llm` / `dsh-agent-presets` | Each forwarded `interface Events` member lives in the owner's client-safe `./types`; agent-presets moves its previous domain vocabulary to `preset.ts` so the exported file itself remains `types.ts` |
| `host/apiproxy` | `HostFrame` gains `host/remote-event` and loses the five dedicated passthrough or invalidation variants with their zod branches; `events.host()` subscribes by allowlist and validates through `assertJsonArgs` |
| `dsh-session` | `src/types.ts` re-exports `JsonValue` so wire contract files can use the client-safe subpath |
| `client/runtime` | The five Client-event bridge branches collapse into `ctx.remote.$dispatch(frame.event, frame.args)`, adding a `remote` injection and deleting their duplicated `Events` declarations |
| Seven consumers | ui-commands / ui-model-selection / ui-settings-models / ui-settings-general / ui-permission / ui-agent-preset / ui-skill subscribe through `ctx.remote.$on(...)`, following `ui-goal`'s precedent for the type-only facade import and the `'remote'` injection |
| `client/connection` | The fixture's `emitHost` produces `host/remote-event` |
| `apps/web/tests` + `apps/cli` | Client symbols mirrored on the test side (see above); `apps/cli/tsconfig.json` drops its 15 Client project references |

## Alternatives considered

**Open a general downlink channel for Remote events** (the push counterpart of `ctx.connection.rpc`, a third WebSocket). This best matches "Connection owns the carrier, the Gateway never touches transport", but it means a new stream in the Host downlink, `WebApiClient`, `ConnectionController`, the fixture, and the web e2e — a cost out of proportion to this change. Reusing the host stream costs a temporary tenancy inside a legacy frame union; when that stream moves, the wrapper moves with it and the consumer contract does not change.

**Declare a separate `TypertRemoteEventMap` in type-meta and let owner packages merge into it.** The consumer key set would equal exactly "events declared remotely deliverable", but every signature would be written a second time outside cordis `Events`, requiring a bidirectional `extends` proof to stop the two from drifting, plus a new type-meta dependency for three owner packages. Sharing the one `Events` declaration makes that equivalence structural, so the table is not created.

**Have the typert generator project Host `Events` declarations** (codec, `.d.ts`, declaration map, like `/remote`). The generator already analyzes Host events, but it cannot see projection or redaction intent, and it would change the generator and the build surface. Verbatim forwarding needs no projection.

**Give forwardable events a payload projection function** (a `{ name, project, zod }` forwarding table). This could fold the two model-directory inputs into one derived invalidation and also cover workspace view derivation, at the cost of hand-aligning projection logic with payload types — the central table the method side just removed.

**Move the apps/web browser e2e into the Client aggregate.** "Client tests belong to the Client face" looks right and fails immediately with 21 errors: those tests use Host services, and in the Client program `ctx.sessions` is `ISessions`.

**Split `directory-picker-browse`/`-native` into Host and Client faces** so no Client package reaches the Host graph. The direction is right — they are genuinely unsplit dual-half packages — but the change lands in another owner's packages and buys only a cleaner build graph; once this design mirrors the Client symbols on the test side, it no longer needs the split. **Assessed and declined.**

## Verification

What pins this behavior:

- A real composition test puts one `host/remote-event` frame on the real host stream per Host emit, with `event` the Host name and `args` equal element for element.
- Type-level negatives reject three candidate classes: a name that is not an event, a Scope-bound event (`goal/changed`), and an event whose return is not `void`. `$on('slots/changed', …)` (Client-local) and `$on('skills/change', …)` (declared but unselected) both fail to compile, so `$on`'s key surface equals the allowlist.
- On the consumer side, `$on('settings/document-updated', …)` resolves `ns` as `SettingsNamespace`: the brand survives the wire.
- `$on`'s disposer belongs to the calling fiber, and two registrations of one function object retire independently — a table keyed on listener identity would collapse them, so subscriptions are addressed by registration.
- Delivery contains a listener that throws AND one that rejects a returned promise: the declared return is `void`, so nobody awaits an async listener, and its rejection would otherwise escape this containment entirely. Delivery iterates a snapshot, so subscribing or disposing mid-frame cannot change who receives that frame.
- `assertJsonArgs` is unit-tested directly rather than by driving a malformed emit through the event bus: a typed `ctx.emit` cannot construct one, since every allowlisted event has a statically JSON-safe payload.
- The five dedicated `HostFrame` variants, five Client-side aliases, and their bridge branches are absent. The model directories observe both owner inputs, while command, skill, and session-row consumers observe the preset owner's committed-selection event.

## Consequences

- **Tenancy inside a legacy frame union.** The contract lives in apiproxy's `HostFrame`, so a reader may assume apiproxy owns Remote events. The frame's JSDoc names `api-remotes` as the allowlist owner, and apiproxy's README records the tenancy under known limitations. When the host stream moves off that package, the wrapper moves with it and the consumer contract does not change.
- **Two files break api/remotes' face-disjointness contract.** `src/remote-events.ts` and `src/types.ts` belong to both projects, so each emits an identical declaration into the shared `lib/types`. Content is byte-identical and the `.tsbuildinfo` files stay separate, so this is harmless in practice; the README's build-boundary section states the exception and its cause (the `paths` entry points at source).
- **The carrier handoff is developer-visible.** Any Client plugin holding `ctx.remote` can call `$dispatch` and synthesize a forwarded event. That exposure predates the verb — `ctx.emit` was equally reachable while an internal event relayed the frame — and matches what `connection/reset` already allows for a fabricated reconnect; the Client is one trust domain. Tests pin the handoff-to-`$on` conversion and do not pretend the port authenticates its caller.
- **A malformed argument fails in the emitter's containment, not at load.** `assertJsonArgs` throws inside the forwarding listener, so the emitting seam's listener containment logs it and drops that frame: loud in the Host log rather than at load or at the emit point.
- **Mirrored test values can drift.** Nothing mechanically checks the Client constants mirrored in `apps/web/tests` against their source; the safety net is only that a drift misses a selector. The rule lives in `apps/web/tests/README.md` and is held by review — a grep-level gate was considered and deliberately skipped.
- **Capabilities given up.** No projected or redacted payloads, no Scope-bound events (`agentCtx.remote.$on`), and no replay on reconnect — these are pure invalidation signals, and `connection/reset` already covers refetching after a reconnect. The mux stream's session events, answerable frames, and snapshot baselines stay out of scope.
- **Client packages remain in the Host graph.** Twelve projects (`connection`, `runtime`, `ui-slots`, and kin) still reach it through the unsplit `directory-picker-browse`/`-native` pair and `api/gateway → client/connection`. They compile and no longer implicate api/remotes' Client face, so they did not block this change; splitting those packages would remove a few but was assessed and declined. The two chat e2e importing `dsh-client-runtime/client` rely on `runtime` already being in that graph — incidental, not a guarantee.
- **The invariant companion holds no runtime check.** An earlier revision asserted the dispatch shape (`thisArg === null`, `mode === 'emit'`) over the live event bus, which coupled the companion to the allowlist value and made rolldown hoist it into a third bundle chunk the mechanical publication list does not carry. The Host face's `TypertForwardableEvent` assertion already refuses both deviations at compile time, so the companion is an explained empty installer.
