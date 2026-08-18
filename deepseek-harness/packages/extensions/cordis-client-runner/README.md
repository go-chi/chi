# @deepseek-ai/dsh-cordis-client-runner

English | [中文](README.zh.md)

Browser half of dynamic dual-half plugin packages. The host-side runner holds every definition's code in process memory and asks the open pages, over a `cordis/request-run` event, whether to run one; this package answers that request, turns the definition into a live browser plugin, and turns a `dynamicCordisRunner/retract` event back into a clean page.

## What it does

1. **Event subscription** — the four announcements are forwarded host cordis events, so this package consumes `cordis/request-run`, `cordis/request-run-resolved`, and `dynamicCordisRunner/retract` through `ctx.remote.$on`, whose key set IS the api-remotes allowlist.
2. **Closure evaluation** — the browser half's source runs as an async function body whose parameters are its symbol surface (`React`, `console`, `styles`, `host`, plus teaching traps shadowing `setTimeout`/`fetch`/`require`). No JSX, no TypeScript, no module imports.
3. **Guard facade** — `apply` receives a whitelisting proxy over the real fiber ctx: lifecycle verbs plus the services the returned plugin declared in its own `inject` (so the object form `{ inject: ['slots'], apply(ctx) {} }` is what reaches a service; a plain function has no declaration site and reaches none). The `slots` seat assigns the shadowing priority (registering IS shadowing, newest run wins); the `theme` seat pins the override layer's source to the package id and hangs its disposer on the fiber.
4. **Loader entries** — the guarded plugin is seated in the module table and mounted through `loader.create`, so a dynamic package rides the same activation gating, fiber-effect cleanup, and status projection as a static one. Unload is entry removal plus factory invalidation plus style removal.
5. **Run orchestration** — a `cordis/request-run` event asks this page whether to run a definition. Whoever answers drives the run in order: the host half first, then the source fetch, then the browser half, then one resolution carrying what happened. A user pressing "run" is itself the authorization and orchestrates the same way with nothing to answer — and for a host-only definition the run ends at the host half, because there is no second half to fetch or load here.
6. **Package-internal RPC** — a package's `host.call` routes to its own host half through the `dynamicCordisRunner` Remote namespace (`invoke`), and each routing failure code becomes its own teaching error. Both directions carry JSON only: an omitted argument travels as `null` (so `host.call('listServices')` is legal and the handler receives `null`), and a payload the generated codec refuses — a function, `undefined`, a class instance — becomes a teaching error naming the call and the contract instead of the codec's bare field name.
7. **Render-failure reflow** — the slot registry's supervision seam (`slots.onEntryError`) fires for every entry-boundary crash on the page; the ones belonging to a package this runner seated go to two outlets from that one observation: upstream to the authoring session (`reportRenderFailure`, for the model) and onto this package's own `renderFailures` face field (for the panel row). Ownership is keyed on component identity, recorded when the guard's `register` proxy seats it, because the registry stores the component verbatim — so no parallel ledger of entries has to be kept in step. This is post-settle diagnosis only: it carries no settle authority, never touches a run resolution, and a failed report is swallowed rather than turning one crash into two.

## Lifecycle

Loads converge by `(id, rev)` against live state: loading a revision this page already runs answers from live state without reloading (so a replayed run does not look unanswered), a newer revision replaces it, and the same revision after a retract loads afresh. Operations serialize per definition.

Nothing loads at activation, and nothing is restored after a refresh — a page runs a dynamic package only when someone answers a run request or asks for it here.

## What a run surface reads and calls

`ctx.dynamicCordisRunner` is the whole face:

- `activeRuns` — each definition's single in-flight activity: `awaiting-approval` (the request id to answer plus the ask's session, package name, and purpose) or `orchestrating` (the session the run is being carried out for). Both arms name the session because grouping belongs to the run, not to its phase; the waiting arm carries the ask's own text because `cordis_define` broadcasts nothing, so a request can name a definition the last registry read does not cover and then this entry is the only source that row has. A surface renders from it and keeps no copy, which is what makes the affordance survive a remount.
- `renderFailures` — this page's last render crash per definition (slot, teaching message, and whether the crash retired the entry from its cell), on the same notification channel as the live set. Page-local and current by construction: it clears when the package stops, is retracted, or loads again, so a row can render it directly. The host keeps its own last-across-pages copy for the model — the two have different owners and lifetimes, and a surface must not read the host's back in place of this one.
- `lastRunError` — why this page's own attempt failed, per definition. It outlives the activity, because the host disposes only the half a failed request started: a page can be looking at a definition the host reports as running while having nothing loaded itself.
- `approve(requestId)` / `decline(requestId)` / `startUserRun({ agentId, id, hasClientHalf })` — the two entries. All three are idempotent (per request id, and per definition for the user's own run), so a double press cannot start two runs. `hasClientHalf` is required: a host-only definition has no source to fetch, so the caller states the shape from the registry row it is acting on rather than the orchestrator learning it from a failed fetch. An answerable request always has a browser half, because the host runs a host-only definition itself instead of asking a page.
- `subscribe()` / `getSnapshot()` / `isLoaded(id)` — what this page has loaded. `isLoaded` is page-local truth, never the host's "it is running".

## Model Experience

### Run resolution, when a model asked for the run

#### What the model sees

This package contributes no tool, prompt, or context of its own; the first thing it authors that reaches a model is the resolution it sends back for a `cordis/request-run` round trip, which the host turns into the blocked `cordis_run` result. A success carries the loaded revision and, for a browser half parked on services this page does not have, their names. A failure carries one reason — `rejected` when the user refused, `host-half-failed`, or `client-half-failed` — and, for the browser half, this package's own text: the failing stage (`evaluate`, `module-import`, or `activate`) followed by the closure's, guard's, or fiber's message. The guard's teaching errors (an undeclared service, a shadowed browser global, a plugin that returned no `apply`) reach the model through exactly that field. A crash that happens later, while React renders the loaded half, travels the separate post-settle path below.

#### Token effect

Conditional and bounded: at most one resolution per run request, spent inside the `cordis_run` tool result the host already emits. The text is data-dependent (a definition's own error message) and this package retains nothing across requests — a page's later load failures are page-local diagnostics with no model-visible carrier.

#### KV Cache effect

Append-only. A resolution reaches the model only as the tool result for the request that was already in flight, extending the history tail; nothing this package authors rewrites or reorders earlier request tokens, so an otherwise reusable prefix stays reusable. Repeated runs of the same definition each produce their own result rather than replacing an earlier one.

### Render failure, after the run settled

#### What the model sees

A browser half that loads cleanly can still crash when React renders it, and that crash lands after the run was answered — so the model would otherwise be told "ok" and never learn. Every entry-boundary crash of a package this page seated is sent to the host (`reportRenderFailure`) naming the slot, whether the crash retired the entry from its cell (`abdicated`: the package's UI is gone, not merely broken), and a message written for the author: the crash text, plus the redirect for a withheld browser global the text names but does not teach — `window.setInterval` around the closure trap crashes as `is not a function`, which explains nothing on its own. The host keeps the last one per package and shows it through `cordis_inspect`; nothing here reaches a run resolution. The same observation also lands on `renderFailures` for the page's own surface — one observer, two outlets, because "the last crash across pages, for the model" and "what this page is showing now" are different facts with different lifetimes.

#### Token effect

Conditional and bounded by the host's retention, not by this page: one report per crash, and the host keeps only the latest per package, so a repeatedly crashing entry costs the model one paragraph rather than a growing list. The report never enters a tool result of its own — the model pays for it only when it asks.

#### KV Cache effect

None of its own. Reports travel over RPC and are stored, not appended to the conversation; the model reads them through an inspection it chose to make, which extends the tail like any other tool result.

## Known Limitations and Deferred Work

- **A refused resolution is not retried.** The acknowledgement of `resolveRequestRun` is not read, so when the host declines a stale success (`accepted: false`, because the definition's revision moved on while this page was loading) the page keeps what it loaded and does not orchestrate again. The request stays answerable — another page's answer or the caller's cancellation settles it — and the stop that bumped the revision retracts the stale load. Retrying was evaluated and deferred: the window is one revision bump inside a single round trip.
- The plugin declares `remote.dynamic`, so it stays parked until the host-side namespace exists rather than loading packages whose host half it could never reach.
- Slot admission (allow/deny lists per deployment) has no carrier: the dispatched row declares services, not target slots.
- Guard whitelists are hand-mirrored twins of the host-side sandbox facade; sharing one specification is deferred.
