# Agent Note: GUI layering and the RPC protocol — host/client layering by capability provider, the four-quadrant message model, and the fetch carrier

Status: implemented

English | [中文](2026-07-19-gui-layering-and-rpc-protocol.zh.md)

> Division of labor: this document = the layering model + the channel-independent RPC protocol; the protocol's Web implementation combines HTTP uplink with the [WebSocket downlink carrier](2026-08-04-websocket-downlink-carrier.md), while the browser object layer is in the [web client architecture note](2026-07-19-gui-web-client-architecture.md).

## Problem

We need a UI integration layer. Beyond the existing ACP/stdio baseline, more product clients are coming — Web (server), Electron, and others. We call them Clients and want the following capabilities:

- One `dsh` process supporting both `dsh web` (serve) and `dsh --profile headless` (headless) — one process, two modes (a design reservation)
- Launching inside Electron with the same Web technologies as `dsh web`

That demands a stable layered responsibility model in the engineering codebase, so future clients plug in cleanly.

At the same time the physical channels differ per consumer (browser HTTP/WebSocket, in-process fetch/SSE, IPC later), so we also need a channel-independent message model and a single contract source of truth — "adding a method" and "swapping a carrier" must not entangle each other, and every message on the wire must be type-validatable, observable, and reconcilable.

## Decision

### Layering

Directories layer as follows:

- `packages/host/*`: packages provide host-side capability only (representing the Node.js engineering core built on the existing harness plugin system), and additionally
    - the unified backend protocol (fetch, HTTP, streaming interfaces…) — definitions and support, see the "Message protocol" sections below
- `packages/client/*`: packages provide client-side capability only; every package stays single-sided. Three kinds live here (the axes are owned by the [client plugin loading note](2026-07-23-client-plugin-loading-model.md)):
    - **Pure libraries** (`ui-slots`, `web-react`, `ui-primitives`, plus the `loader` kernel package): ordinary root-index packages, statically bundled into the shell; the first three are seeded into the module table.
    - **Static-arrival entry packages** (`connection`, `runtime`, `ui-theme`, `i18n`, `hmr`): no `dsh.client` key and no browser bundle — the shell bundles their `src/client/` half and registers it with `ctx.modules`; they are governed as entries of the host-authored graph like everything else.
    - **Fetch-arrival plugin packages** (`ui-layout`, `ui-sidebar`, `ui-conversation`, `ui-trajectory`): dual-entry — the root index is the node half (an empty `apply`, existing so the host Loader governs lifecycle and the web plugin registry discovers the package.json `dsh.client` declaration); the implementation lives under `src/client/`, shipped as the `./client` subpath (a tsdown closure-factory bundle). Cross-plugin consumption of `/client` is type-only; value cooperation goes through cordis services.
- `apps/` holds the externally exported applications, assembled from Client / Host mixtures.
    - `apps/web` (`dsh-web-frontend`) is the vite application: a thin `main.ts` over the shell API exported by `dsh-client-web`.
    - `apps/cli` (`@deepseek-ai/dsh`) dispatches commands: `dsh web` = Host + webserver + the built `dsh-web-frontend` dist; `dsh --profile headless` = [a direct core Agent/Session entry point](2026-08-09-headless-direct-core-entry-point.md), with zero Host, HTTP, or browser layer.
    - A future Electron application reuses the same web client packages over an IPC fetch carrier.

```
apps/*  (applications: apps/web = vite app, apps/cli = bin dispatch)
  │ consume
  ▼
packages/host/*                      packages/client/*
  apiproxy   front layer: protocol     pure libs: ui-slots / web-react / ui-primitives
  runtime    assembly / host entity    dsh.client plugins ×8 (node half = empty apply,
  webserver  Web HTTP carriage                              client half = src/client/)
  │ ctx.plugin(...)                      ▲ import only apiproxy's /api /client subpaths
  ▼                                      │ (type-only + the client base class)
harness core packages ──────────────────┘ (types reach the browser via import type)
```

Direction discipline (every rule auditable from package deps):

- `runtime → apiproxy` is one-way; apiproxy depends only on type definitions.
- Client-side packages **never import** host-side package runtime (they consume only the two browser-safe subpaths `/api` and `/client`).
- `webserver` does not depend on `runtime`: it provides an implementation of the `{ fetch }` interface — "webserver ← runtime" is a runtime injection relationship, not a package dependency.
- Cross-package client imports use the `/client` subpath for plugin packages, and between plugin packages they are type-only — a cross-plugin value import is a build error at the tsdown purity gate (value cooperation goes through cordis services; the [client plugin loading note](2026-07-23-client-plugin-loading-model.md) owns the edge rules).

TypeScript checks in **two aggregate programs** referenced by a solution root (`tsconfig.json` = solution; `tsconfig.host.json` = host side + tests, excluding `packages/client`; `tsconfig.client.json` = client packages and their tests): both sides merge the cordis `Context` interface under the same keys (`sessions`, `loader`) with different services, so one program would see both declaration merges and report a collision. Shared leaves (session/llm/tools/apiproxy…) build once and are referenced by both programs ([topology](../process/2026-07-22-tsconfig-solution-root-two-aggregates.md)).

On the protocol side: TS interfaces (`packages/host/apiproxy/src/api/`, zero Node dependencies, browser-importable); wire messages unify under a **bidirectional model** — each logical message is classified by "who initiates × request/response" (two axes, four cells, called the four quadrants below), decoupled from the physical channel; clients all inherit `AbstractApiClient` (protocol invariants live entirely in the base class, platform differences are just the `doFetch` transport aspect).

#### Layer roles

| Layer | Package | Responsibility | Key discipline |
|---|---|---|---|
| Front layer | `dsh-host-apiproxy` | TS/zod definitions (api/) + the fetch abstraction (fetch/: handler + client base class) | Keep it simple — every consumer needs it; importable from Node and browser alike; protocol content in the "Message protocol" sections below; clients must not bypass api through ctx |
| Assembly layer | `dsh-host-runtime` | Plugin composition + ApiProxy integration + the web UI plugin mount (in-memory Loader tree over the eight dsh.client packages); home of host-level configuration (defaults/persistenceRoot, future user profile) | Which plugins mount and with what defaults is decided only here; shells must not alter the assembly |
| Carrier layer | `dsh-host-webserver` | Web HTTP and upgrade: static serving + `/api/*`→handler forwarding + WebSocket upgrade route + close semantics; plugin bundle endpoint + `__DSH_BOOT__` manifest injection (fed by the web plugin registry) | Web (browser access) only; zero workspace dependencies (the registry arrives by structural injection); Electron does not reuse it |
| Client libraries | `dsh-client-ui-slots` / `dsh-client-web-react` / `dsh-client-ui-primitives` | Slot registry core / ctx↔React glue / pure React atoms | Zero cordis runtime dependency in components; seeded into the loader module table by the shell |
| Client plugins | `dsh-client-connection` / `dsh-client-runtime` / `dsh-client-ui-theme` / `dsh-client-i18n` / `dsh-client-ui-layout` / `dsh-client-ui-sidebar` / `dsh-client-ui-conversation` / `dsh-client-ui-trajectory` | Browser-side cordis plugin tree (wire consumer, core services, theme, i18n, layout, sidebar, conversation, trajectory) — see the web client architecture note | Dual entry (node half = empty apply; implementation in `src/client/`); the consumption face goes exclusively through ApiProxy |
| Application | `@deepseek-ai/dsh` (apps/cli) + `dsh-web-frontend` (apps/web, the vite application) | Coarse bin dispatch + one assembly module per application (web.ts / headless.ts); the vite app is a thin main over the `dsh-client-web` shell surface | Applications use dynamic imports so they never load each other; workspace knowledge like dist location stays in the app |

#### Naming rule

Packages under `packages/host/*` and `packages/client/*` **must carry the directory-group prefix in the package name**: host/runtime → `dsh-host-runtime`, client/runtime → `dsh-client-runtime`. The directory name does not repeat the group prefix (host/ already expresses it). The package-name tail therefore ≠ the directory name, so the `dsh-*` wildcard in tsconfig.base.json (which resolves by directory name) misses them — **each package in these two groups needs an explicit paths entry**, including separate entries for the client packages' `/client` subpaths so source-level resolution matches the exports map.

#### How to integrate a new application (operational checklist)

1. **Pick a fetch impersonation**: browser same-origin HTTP / in-process `host.handler.fetch` injection / your own transport-aspect subclass (e.g. future Electron IPC, see the "Subclass table" below).
2. **Write an assembly module under `apps/`**: `startHost()` + a client subclass + the application's private signal/print/exit semantics; a mixture never becomes a package — assembly is written in the app.
3. **Import `dsh-host-webserver` only if you need HTTP carriage**, otherwise zero ports.

The two existing applications preserve the division: the Web application mounts Host, carrier, and browser composition, while `dsh --profile headless` mounts a direct core runner with zero Host, HTTP, or ports. ACP-class protocol bridges do not follow the client-carrier checklist: they expose core to the external ecosystem and mount directly via `ctx.plugin(entry-point plugin)` without fetch.

## Message protocol

The sections from here down are the protocol body carried by the front layer (`dsh-host-apiproxy`). The wire has exactly four message kinds (the four quadrants) — the Web carriage in the right column is only an example; swapping the carrier (in-process/IPC) leaves the quadrants unchanged:

```
                 client 发起                      server 发起
  request   ① ClientRequest                 ③ ServerRequest
            （POST /api/<method> body）      （WebSocket message：session 事件、审批/问答 requested）
  response  ② ServerResponse                ④ ClientResponse
            （该 POST 的 HTTP 应答体）        （POST /api/respond body，回填 ③ 的 rpcId）
```

### Wire full forms: a four-member named discriminated union (`api/rpc.ts`)

| Type | Discriminant tag | Fields | rpcId ownership | Web carriage |
|---|---|---|---|---|
| `ClientRequest` | `'client-request'` | `rpcId` `method` `payload` | client mints | `POST /api/<method>` body |
| `ServerResponse` | `'server-response'` | `rpcId` `result` | echoes ① | that POST's response body (always HTTP 200) |
| `ServerRequest` | `'server-request'` | `rpcId` `method` `payload` | server mints | WebSocket text message |
| `ClientResponse` | `'client-response'` | `rpcId` `result` | echoes ③ | `POST /api/respond` body |

`RpcMessage = ClientRequest | ServerResponse | ServerRequest | ClientResponse`, narrowed via `switch (message.type)`.

**rpcId discipline** (`RpcId` is a branded string with constructor `RpcId()`):

- Whoever initiates mints; a response always echoes the corresponding request's rpcId and **never mints a new id**.
- server-requests split into two kinds, distinguished statically by `method` (= the frame type), with **no third kind**: answerable frames (`approval/requested`, `question/requested`) carry a stable logical request id (minted once on acceptance, reused verbatim on baseline replay, echoed by the client's answer); pure-push frames (`session/event` etc.) carry an rpcId identifying that one push (freshly minted each time).
- Business code never mints: unary minting funnels into the client base class `callUnary`, frame minting funnels into the host side.

### Signature narrow forms and carrier completion

Domain interface signatures perceive only the narrow forms: `RpcRequest<P> = { rpcId, payload }`, `RpcResponse<T> = { rpcId, result: RpcResult<T> }`. The carrier layer completes narrow forms into full forms (adding the `type` tag and `method`); direction is never inferred from the channel. `RpcResult<T> = { ok: true; value } | { ok: false; error: RpcError }` — methods do not throw business errors.

### RpcReceipt: the carrier receipt

The HTTP response body of a `ClientResponse` is `RpcReceipt = { accepted: true } | { accepted: false; reason: 'not-pending' | 'bad-response' }` — a carrier-layer receipt, **not** an RpcMessage (a response has no response); late/duplicate answers get `not-pending`, and the logical convergence point is the `*/resolved` frames.

## The type system: signatures are the source of truth

### RpcMethodMap and derived generics (`api/rpc-map.ts`)

Method parameter/return structures **live only in the interface method signatures**; the map registers the methods themselves; every other position (handler, client, store, tests) references the derived generics — copying literals or introducing flat named types is banned:

```ts ignore-check
export interface RpcMethodMap {
  'session.list': SessionsApi['list']        // map key 即 wire 路径段
  // …其余方法同形登记，全集见 api/rpc-map.ts
}
// 派生泛型（穿透窄形取业务类型；实际声明带 K extends keyof RpcMethodMap 约束）
export type RequestPayload<K> = Parameters<RpcMethodMap[K]>[0]['payload']
export type ResponseValue<K> =
  Awaited<ReturnType<RpcMethodMap[K]>> extends RpcResponse<infer T> ? T : never
```

Stream methods (`events.mux`/`events.host`) stay out of the map (not unary); `respond` stays out of the map (it is a client-response, not a method call).

### The error model (`RpcErrorDetailsMap`)

One example row of an error code:

| code | details | when |
|---|---|---|
| `bad-request` | `{ issues: ZodIssue[] }` | wire/payload zod validation failed |

The full code set is `RpcErrorDetailsMap` in `api/rpc.ts`. `RpcError` is the distributive union expanded from the map: `code` discriminates, `details` narrows automatically after a `switch`; **details is required** — a new code = one map row + one error-schema branch, and omission is a compile error. Transport failures (network down, host not up) are thrown by the carrier as exceptions; the two layers never mix.

### Bidirectional zod validation and anchoring

- **Two-level parse**: the full-form schema once (type/rpcId/method structure + the handler checking path==method) → the business payload dispatched by method/frame type for a second parse; rejection = `bad-request`.
- **Anchoring**: schemas uniformly `satisfies z.ZodType<Wire<T>>` (`api/rpc.schema.ts`). `Wire<T>` is a deep "| undefined" widening — the repo enables `exactOptionalPropertyTypes` while zod `.optional()` outputs `T | undefined`, so anchoring the original type is unusable across the board; on the JSON wire, absence and undefined are indistinguishable, so the widening loses no validation semantics. Passthrough wide branches (`SessionEvent`/`ContentBlock`/frame unions/`RpcError`) and brand-id schemas use explicit casts with comments.
- Brand casts have one point each: every schema file funnels its id cast into one place (`rpcIdSchema` is the only cast point in rpc.schema.ts).

## The contract face (ApiProxy)

The root interface is `ApiProxy = { sessions, host, events, respond }` (`api/index.ts`). A new client-request domain = one new file pair (`<domain>.ts` + `<domain>.schema.ts`) + one root-interface field + one map row.

### The unary method table

One example row (the table structure is the reading key):

| method key | request payload | return value | semantics |
|---|---|---|---|
| `session.list` | `{ cursor?: string }` (cursor is a reserved seat, unimplemented) | `{ items: SessionSummary[] }` | persisted sessions, updatedAt descending; v1 builds no index |

The remaining methods (`session.create`/`session.history`/`session.rename`/`session.prompt`/`session.cancel`/`host.describe`) are not re-copied here — signatures are the source of truth; see `api/sessions.ts`, `api/host.ts`, and `RpcMethodMap`.

### Frames (server→client, named unions)

Two logical streams: the mux stream (`/api/events.mux`, all-session aggregate) and the host stream (`/api/events.host`, host-level events). The browser consumes one downlink WebSocket per stream, while the in-process fetch carrier retains SSE with the same event framing; see the [WebSocket downlink carrier](2026-08-04-websocket-downlink-carrier.md) for the physical boundary. One example frame row:

| frame type | payload | when |
|---|---|---|
| `session/event` | `{ sessionId; event: SessionEvent }` | core passthrough: core events pass verbatim, `assistant/chunk` IS the token stream, no separate delta frame |

The remaining frame types are not re-copied here; the full unions are `MuxFrame`/`HostFrame` in `api/events.ts`. Three semantic points to know: `session/subscribed` carries lastSeq for history-race detection; the `approval/question` requested frames are answerable (stable rpcId) and the resolved frames are the convergence surface; `host/agent-error` is the only outlet for live failures with no turn position.

**Passthrough discipline**: events/messages/content blocks on the wire ARE the core types (`SessionEvent`/`ContentBlock`) — no second DTO set; types reach the browser through the `import type` dependency chain. `SessionEventMap` is merge-extensible: the client applies its documented default (ignore) to unknown types, and the event schema keeps a "valid envelope + unknown type" branch — the envelope stays strict; this is not field-level passthrough.

### Session semantics (impl-side commitments)

- **History = event replay**: one fold (client side); history pagination and live increments share one code path; the server maintains no second materialized-snapshot system. History **page boundaries align to message boundaries** (never cut mid-message; chunks group with their finalized message), and the tail page includes the in-flight partial's chunks.
- **Prompt correlation**: the prompt's rpcId rides MessageSource (`'user-rpc'`) into the `user/message` event; the client uses it to promote the optimistic echo.
- **Reconnect = rebuild**: no resume cursor (`mux`'s `since` signature is a reserved seat, ignored if passed); on disconnect reopen the stream + refetch history; compare `subscribed.lastSeq` with the history tail seq and backfill once if there is a gap.
- **Cold session handling follows ownership**: `session.history` and the source read for `session.fork` inspect persistence without an Agent, while Agent-bound ordinary-session methods such as `prompt` resume through a deduplicated in-flight table. Session-backed subagents reject that generic resume path, and attachment status is not exposed to clients (`running` already covers it).
- **Approvals/questions**: the requested frame mints a stable rpcId on acceptance; first answer wins, and the host's in-memory pending table (keyed by rpcId) is the only referee; after a mux reopen, still-pending requested frames replay after the subscribed frame (rpcId reused verbatim — refresh recovery). The audit events `approval/asked`/`decided` continue through the durable log — frames = the live control plane, events = the durable audit. **Status**: the contract and frame types are shipped; the host-side pending table/wire answerer is unimplemented (`respond` in `api-proxy.ts` is a stub, always `not-pending`); PendingCard v1 is display-only.
- **No protocol version**: client and host release bound together; `host.describe` has no protocolVersion field; introduce one when an independently released client appears.
- **Reserved-method discipline**: the map holds only implemented methods; an unknown method fails loud at envelope parse (`bad-request`) — no not-implemented fallback code. The reservation list (implementing = copy the signature into the domain interface + add the map row + add the schema pair): `session.fork`, `prompt.mode` gaining `'inject'`, `task.list`, `host.listModels`, describe gaining `hostInstanceId`. (`session.rename` graduated from this list: it appends a user-source `session/title` event.)

## The client carrier: the AbstractApiClient class family (`fetch/client.ts`)

**Protocol invariants live in the base class; platform differences are two aspects**: the abstract method `doFetch(url, init)` (transport) + the overridable `onEnvelope` (observation).

### IApiClient: the caller view

The same domain tree as `ApiProxy`, but unary methods **take the business payload directly** — the carrier mints the rpcId and wraps the envelope; business code never mints, and code needing this call's rpcId reads it from the returned `RpcResponse` echo. `ApiProxy` is the narrow-form signature contract the impl side implements; `IApiClient` is the payload-direct view clients consume; `AbstractApiClient` bridges the two. Methods derive per key from `RpcMethodMap` — a map row addition updates them mechanically.

### Protocol paths held by the base class

| Path | Content |
|---|---|
| `callUnary` | mint → tap → POST full form → `serverResponseSchema` parse → **rpcId echo check** (mismatch throws) → tap → emit narrow form |
| `readSse` | streaming fetch (not EventSource), `\n\n` framing, `data:` concatenation, ServerRequest full-form parse, tap, emit narrow `RpcRequest<frame>` |
| `respond` | client-response passthrough (rpcId is an echo — never minted here); response body parsed by `rpcReceiptSchema` |
| unary deadline | Ordinary unary calls use `AbortSignal.timeout` (default 30s, constructor-tunable); user-paced `host.pickDirectory` and `command.execute` omit that deadline but keep caller/connection cancellation; streams have no deadline |
| `resolveBase` | browser = same-origin origin; no-location environment (Node) = the `http://dsh.internal` fake authority |

### The instance-level envelope observation aspect

All four quadrant full forms pass through `onEnvelope`; the base implementation is an **instance-owned microtask-batched buffer** (frame storms must not disturb consumers per frame; module-level state would leak across instances/tests, hence instance-owned). Observers subscribe via `subscribeEnvelopes(listener)` (receiving whole batches as `readonly RpcMessage[]`, returning an unsubscribe function); a listener throw is isolated (observation must never bite the carrier). With no subscribers the buffering costs nothing. No shipped consumer subscribes today — the aspect is the designated seat for wire diagnostics (the retired RPC debug panel was its first consumer, and a future one plugs in without touching the carrier).

### The subclass table (transport carriage)

| Subclass | Package | doFetch | Purpose |
|---|---|---|---|
| `InProcessApiClient` | apiproxy itself | the injected `{ fetch }` handler | **The isomorphic point**: `new InProcessApiClient(toFetchHandler(api))` never touches the network yet runs the real wire serialization/zod/SSE framing; carrier tests and callers can exercise the protocol without opening a port, while product `dsh --profile headless` drives core directly |
| `WebApiClient` | dsh-client-connection | `globalThis.fetch` uplink + one same-origin WebSocket downlink per logical stream | the browser client; physical boundary in the [WebSocket downlink carrier](2026-08-04-websocket-downlink-carrier.md) |
| `FixtureApiClient` | dsh-client-connection | unused (protocol-layer override) | serverless UI development (`?fixture`): overrides the `callUnary`/`openMux`/`openHost`/`respond` virtuals and is itself the fake server (frame rpcIds minted by it, semantics self-consistent) |
| IPC bridge subclass (hypothetical example — no such shell exists) | an Electron shell | IPC serialization round trip | would swap only doFetch; contract and base class unchanged |

## How to extend (operational checklists)

**Add a unary method (5 steps)**: ① add the method signature to the domain interface (parameters/return inline — this is the single source of truth); ② add one `RpcMethodMap` row; ③ add the request/value schema pair in `<domain>.schema.ts` (anchored `Wire<RequestPayload<'…'>>`); ④ add one handler `UNARY_ROUTES` row (the handler's Web carriage is in the web client architecture note); ⑤ implement in the impl (echo `request.rpcId`). On the client side, add the passthrough row to the `IApiClient`/`AbstractApiClient` domain method tables.

**Add a frame type (3 steps)**: ① add a branch to the `MuxFrame`/`HostFrame` union (answerable frames must note the stable-rpcId semantics); ② add a frame-schema branch; ③ the consumers' fold/routing documented-default already covers unknown types — add an explicit branch as needed.

**Add an error code (2 steps)**: ① add one `RpcErrorDetailsMap` row (details required); ② add one `rpcErrorSchema` discriminatedUnion branch.

**Plug in a new carrier**: subclass `AbstractApiClient` implementing only `doFetch`; to intercept at the protocol layer (like the fixture), override the `callUnary`/`openMux`/`openHost` virtuals instead. Contract and base class stay unchanged.

**Promote a reserved method**: copy the reserved signature into the domain interface → add the map row → add the schema pair → add the UNARY_ROUTES row → implement.

## Consequences

Every client consumes one contract: adding a unary method is a five-step mechanical change from a single signature, swapping a carrier touches only a `doFetch` subclass, and every wire message is zod-validated, observable through the envelope tap, and reconcilable by rpcId. Ordinary unary calls remain bounded, while `host.pickDirectory` and `command.execute` may stay pending until the operation finishes or caller/connection cancellation arrives; this accepts that a non-cooperative user-paced operation can hang its request rather than treating valid operation duration as transport failure. The other accepted costs: two groups of packages need explicit tsconfig paths entries, and the reserved methods (fork/inject/task.list/listModels/hostInstanceId) stay dormant until a real consumer arrives.

## Alternatives considered

| Rejected | One-line reason |
|---|---|
| Packaging by product (a web family, an electron family) | Products share host/client capabilities rather than an application implementation; capability-provider layering means a new application needs zero new packages |
| A package per mixture (e.g. a standalone headless package) | A mixture has exactly one consumer (its own app); packaging it is ownerless abstraction, while assembly in the app is readable and disposable |
| Consuming clients connecting to ctx directly (skipping the apiproxy layer) | Clients require wire validation, observability, and multi-client consistency. Direct headless is a local entry point with no client boundary and uses the public Agent/Session seams rather than a client command plane |
| webserver depending on runtime (saving the handler injection) | Structural-typing injection keeps webserver reusable by sidecars/tests with zero workspace deps; a package dependency would drag assembly knowledge into the carrier layer |
| Package names without the group prefix (continuing dsh-<tail>) | `dsh-runtime`/`dsh-web-ui` lose their belonging in the flat npm namespace; the cost is one explicit paths entry per package |
| Reusing the in-repo JSON-RPC 2.0 (dsh-sdk-jsonrpc-server) | Numeric error codes degrade to a single fallback code, contracts get aligned by hand in two copies, and naming drifts without a convention |
| A three-envelope model (Request/Response/Frame envelopes, signatures direction-blind) | rpcId correlation is logical-layer; frame and response direction semantics inferred from the channel break the moment the carrier changes |
| Named Request/Response type pairs as the source of truth (map registering type pairs) | Flat named types are a second name for the same fact; signature inference makes adding a method a one-place change |
| REST-style paths | The consumer is our own client with no third-party REST expectations; RPC mapping straight onto the method table is more mechanical |
| A DTO layer (a second wire-only structure set) | Core types reach the browser type-only at zero cost; a DTO is a permanent two-way synchronization tax |
| Cursor resumption (implementing mux since) | Reconnect = rebuild (opencode-style) covers all v1 needs; the signature keeps the seat, implementation waits for a real consumer |
| A createApiClient factory function (the original implementation) | Platform differences (transport/observation) are inheritance aspects, not parameters; the class family lets the fixture substitute at the protocol layer instead of wrapping a fake envelope |
| Applying the 30-second transport deadline to `command.execute` | Command duration is operation work, not a transport-health budget; the deadline kills valid long-running handlers, while caller/connection cancellation already supplies the required stop path |
