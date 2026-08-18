# Agent Note: Client plugin loading — plain packages, dsh.client plugins, and the two-phase boot

Status: implemented

English | [中文](2026-07-23-client-plugin-loading-model.zh.md)

> Scope: the browser-side plugin loading machinery — what is a plugin, how code arrives, and how hot reload rides on that model. This note owns the loading chain; the [web client architecture note](2026-07-19-gui-web-client-architecture.md) defers to it for loading and keeps owning slots, the data object layer, and the React face.

## Problem

On the host, cordis plugin loading stands on Node's module machinery — the require cache and the internal ESM loader own module identity and bytes. The vendored `@cordisjs/plugin-loader` implements plugin governance and hot reload on top of that substrate, and the two meet at one boundary: `Loader.internal`.

The browser client runs the same cordis plugin mechanism, so it needs the same substrate underneath — and the browser has no Node module system.

Conventional frontend engineering digests all dependencies at build time: one bundle, externals resolved by the bundler, nothing left to manage at runtime. Runtime module management on top of that is the unusual requirement here. The client therefore splits into two layers: the upper layer is cordis plugin loading through the same vendored Loader, and the lower layer is module-granular dependency management — `dsh-client-modules`.

The lower layer supplies four capabilities: externals (the platform list), remote arrival (same-origin external classic scripts plus lazy factory registration), versioning (content-hash revs), and hot update (invalidate/prefetch).

Plugin bundles are built independently outside Vite's module graph. Feeding response text into an inline script leaves the browser with a dynamic source execution: no standard source-map chain connects the network resource, generated bundle, and TypeScript/TSX source, so performance profiles and stacks stop at generated `client.js`; the module system must also buffer the complete source and split one arrival responsibility across fetch and execute transport boundaries.

On top of that, client and host plugins register and load consistently: a package declares `dsh.client` once, the host scans the declaration into the boot graph, and the same Loader semantics govern entries on both sides.

The first-generation client loader (`createClientLoader`) hand-wrote both layers in one function. The fusion left no unload/reload path (loads were one-shot, style tags never removed), hand-copied dependency lists that had already drifted across three files, and a module-table backdoor for cross-plugin imports that duplicated cordis's service mechanism while making load order a correctness constraint. The structure below replaced it.

## Decision

### Two package kinds; `dsh.client` means plugin, period

What makes a package a plugin? One rule: **a package is a plugin package once its consumption is cordis dependency injection; until then it is a plain package.** How code reaches the page is not part of the taxonomy — arrival follows from the kind instead of defining it.

- **Plain packages** are the absolute base the module system itself needs, plus libraries not yet converted to DI: the react family, cordis, `@deepseek-ai/dsh-client-modules` (the module system itself — it can never be a plugin, because modules precede all modules), the web shell kernel, and — for now — ui-slots, web-react, ui-primitives. Plain packages are shell-bundled, seeded into the module table, and invisible to the host graph.
- **Plugin packages** are everything else. Each one carries a `dsh.client` manifest declaration (`{ platform, inject, immediately? }`) and one uniform shape: the shared tsdown preset emits `lib/client.js`, and `exports["./client"]` points at that bundle. Each is a governed entry of the host-authored graph. The current set is connection, runtime, ui-theme, i18n, hmr (dev graphs only), ui-layout, ui-sidebar, ui-conversation, ui-model-selector, ui-user-questions, and ui-trajectory.

The manifest owns the package's loading contract: its `inject` dependency edges, plus the optional `immediately` prefetch mark (absent means lazy). The composing app owns only the roster.

To add a plugin package: declare `dsh.client`, emit the `./client` bundle through the shared preset, add the name to the composing app's roster. Nothing else changes hands.

When does a plain package become a plugin? The upgrade law, recorded so the migration path stays honest: **a plain package becomes a plugin package when its consumers switch to cordis DI, not before.** Three promotions are queued: ui-slots (the slots machinery now living in runtime — SlotRegistry, the renderer contract, the root slot), web-react (the renderer install moving into its own `apply`), and ui-primitives (once components are served through slots/services). Until then they stay plain, and their symbol exports stay ordinary static imports.

Four edge rules govern imports across the two kinds. None of them depends on any per-package mark:

- **Plugin ↔ plugin value imports are a build error.** This holds regardless of either side's `immediately` declaration — the rule must not depend on a mark someone can flip. Cooperation goes through cordis inject/services. `import type` is exempt; the type chain is untouched. This rule is why `scopeOf` is a `SessionRuntime` method and why `transportError` lives in `dsh-host-apiproxy`'s wire layer (its `RpcResult` home, inline-safe).
- **Plugin → plain package value imports are externals**, judged against the platform list. That list is one constant in the shell (`platform.ts`: react family, cordis, ui-slots, web-react, ui-primitives), imported by both the tsdown preset (for the external judgement) and `seed.ts` (for the table warm-up). One constant, two consumers — the hand-sync drift class stays dead.
- **The purity gate covers every plugin package.** Its three branches: platform imports become externals; INLINE_SAFE wire layers are inlined; any other workspace leak is a build error. The uniform bundle shape is what makes this coverage total — every plugin builds through the same preset, so no package can sit outside the gate.
- **The shell is self-sufficient.** The kernel (boot + loading page) value-imports no plugin package; its status stores are hand-rolled. The fail-loud presentation must not depend on the system whose failure it reports.

### One module system, one plugin governor

The browser mirrors the host's division of labor. `dsh-client-modules` (`ClientModuleSystem`) takes the module-system seat that Node's internal ESM loader holds host-side; the same vendored `@cordisjs/plugin-loader` keeps the governance seat on both sides. The line between them in one sentence: **the module system owns module identity and bytes — how code arrives, registers, and becomes an exports; the Loader owns plugin lifecycle — when a plugin mounts, what it waits for, and how it is torn down.**

`ClientModuleSystem` is a lazy CJS table. Executing a bundle only **registers** its factory — the bundle calls `window.__ModuleLoader__.load({ id, factory })` and nothing else happens. Every module body side effect, CSS injection included, lives inside the factory closure and runs at materialization: the first `require`/import of that id, memoized after that. A factory that requires a registered-but-unmaterialized sibling materializes it recursively, so no sort order exists anywhere. When asked to import an id, the table resolves through a fixed branch order: seed word → memoized record → static registration (shell-own modules, e.g. app-shell) → registered factory → graph-row external classic-script load → loud throw. That final throw is the runtime mirror of the build-time purity gate. The system also keeps per-module bookkeeping — owned `<style data-plugin>` tag ids, observed require edges — and exposes the two verbs HMR needs: `prefetch(id)` (load the script and register its factory; concurrent calls share one in-flight task) and `invalidate(id)` (drop the factory and record so the next arrival reloads it).

The vendored Loader consumes the module system through its `internal` contract — the only call site is `tree.import` — and owns everything entry-shaped: entry creation, fiber activation through cordis service waiting (PENDING until injected services exist, cascading when a service is provided), update/refresh, teardown. The governance code is byte-identical to the host side, per vendor policy. Browserization is compile-time mapping in the shell's vite config: a `node:module` stub alias plus `process.*` defines make `ModuleLoader.fromInternal()` return undefined — exactly the empty slot the shell fills. The module system mounts as `ctx.modules`.

### External-script arrival and source maps

Each graph row's `url` goes to a same-origin external classic `<script src>` with `async` set. The browser owns the network request and script execution; the node is removed as soon as `load` or `error` settles so HMR cannot accumulate dead nodes. Successful settlement also requires the graph row's factory id to exist in the module table, or arrival fails; registration still does not run the factory, so the side-effect boundary remains first materialization.

The shared tsdown preset emits `client.js.map` for every plugin and rewrites first-party source paths into the browser-resolvable repository shape `/packages/<group>/<package>/src/...`. Other workspace sources inlined into a bundle likewise resolve to their `packages/` owner, while dependency paths remain unchanged; `sourcesContent` carries the source, so the host only serves the map at `/plugins/<id>/client.js.map` and exposes no source route. The Vite shell also emits source maps, letting both shell code and out-of-graph plugins map stacks and performance profiles back to TypeScript/TSX.

`rev` remains the script URL's query parameter and content-consistency anchor, and the bundle and map are both served with `no-cache`. An external script's `error` event exposes neither response status nor body, so failure diagnostics name only the URL; the same-origin host and build-stamped handoff id form the identity boundary, while the post-`load` factory-presence check rejects an artifact that did not register the expected id.

### The loading flow, end to end

What happens between `dsh web` starting and the UI appearing? Three stages: the host composes and serves a graph, the shell prefetches, then cordis orchestrates.

**Host side — compose the graph.**

1. The composing app (`apps/cli`) ships the roster as ordinary rows in its `cordis.yml` config tree — client plugin packages are entry rows like every host plugin, including the always-mounted `client-hmr` row. A roster row that fails to import is caught by `assertEntriesLoaded`; a row whose fiber rejects is reported with its original stack by `assertEntriesActivated` ([host boot decision](2026-07-24-web-config-tree-boot-and-transport-layering.md)).
2. The `dsh-client-modules` node half (the package is dual-face: its browser half is the module table) scans loader entries' package.json `dsh.client` declarations and composes `window.__DSH_BOOT__`: `{ rev, entries: [{ id, url, rev, inject?, immediately? }] }`. The `inject` edges and the `immediately` mark come from manifests, never hand-copied. It refuses declared plugins without built `./client` bundles and groups their package/path rows under one required source-build instruction; malformed declaration fields also fail activation, and the host audit reports either error from the FAILED fiber.
3. Scanning is incremental per package — there is no full-rescan code path. Each cordis `internal/plugin` emission marks the fiber's entry name dirty (entry-less fibers drop O(1)); a microtask flush reconciles each dirty name against live loader entries, with package metadata (including the negative "not a client package" verdict) cached per name forever and bundle re-hashing reachable only through `rebuilt(id)`. The activation pass seeds the same dirty set from current entries and flushes synchronously, so first scan and steady state share one implementation. Each bundle's content hash is its `rev` (cache busting + HMR diff anchor), the row set hashes into `graph.rev`, and every row is served as a script resource at `/plugins/<id>/client.js?rev=…`, with its source map at the same path plus `.map`. The graph types are single-sourced in the modules package's `./client` export — the webserver knows nothing about the graph (it is a plain route-registration plugin; modules registers the bundle route and taps the index render itself).

Why is the roster yml rows and not a scan? Because which plugins compose into a deployment is a composition decision, not a package property — a package declaring `dsh.client` in the repo does not mean this deployment mounts it, so discovery-by-scan cannot make that call; the node half scans only what the tree actually mounted.

**Phase one — the module face.** The shell builds the module system over the graph, then prefetches every `immediately` row in parallel. Prefetch loads the external script and registers its factory only. A single row's prefetch failure is swallowed here: phase two's import retries the load and owns the loud failure, so one bad row cannot mask the others. `immediately` is a prefetch mark — not a barrier, not an identity. The package declares it, the registry carries it into the row. The infrastructure plugins (connection, runtime, ui-theme, i18n, plus hmr) declare it; UI plugins simply arrive on demand.

**Phase two — the plugin face.**

1. The kernel mounts the vendored Loader and injects the module system as `internal` before any entry exists. Ordering matters: `tree.import`'s bare-import fallback must never run in a browser.
2. It creates one entry per graph row, plus the app-shell pseudo-row. The assembly entry is shell-own code the kernel appends itself — registered static with the module system, never part of the host graph — so it rides the same entry lifecycle and status coverage as everything else.
3. Creation order carries no semantics; fibers activate through service waiting.
4. `settled` = every entry created + `loader.await()` quiescent + an all-ACTIVE sweep. The sweep lists each import-failed, FAILED, or PENDING fiber with its missing services. It exists because cordis inject waits have no timeout — the sweep is the fail-loud floor.
5. The loading page's boot status is a projection of real fiber states via `internal/status`. The settled flip switches to the real UI in one pass.

### Hot reload: one driver plugin, self-watched bundles

Hot reload is a composition decision: the web bundle mounts the `client-hmr` row (a normal plugin package) unconditionally; its node half brings the bundle watch and the SSE channel, and the chain stays idle until a rebuild watcher rewrites client bundles. A composition that must not expose it disables the row.

How does a rebuilt bundle become a reload signal? The hmr node half observes it itself — no builder tells it. It reads bundle paths from `ctx.clientModules.clientPath(id)`, and one HMR-owned interval stat-polls every current graph row. Adding a row is ordered as synchronous stat baseline, then immediate `clientModuleHost.rebuilt(id)`: a write after the module host's graph hash but before that baseline is caught by the immediate re-hash, while a write after the baseline leaves a stat delta for the next poll. This avoids `fs.watchFile`, whose asynchronous first baseline can silently absorb a construction-time rebuild. Watch membership follows `onGraphChanged`; vanished rows drop out, and a bundle missing at poll time keeps its row dirty so reappearance forces a re-hash even with identical metadata. On a mtime/size delta or dirty row, `clientModuleHost.rebuilt(id)` is the single re-hash entry point; when the `rev` actually changed, the node half broadcasts a `rebuilt` frame on `GET /plugins/events` — a system SSE channel that sends the full graph on connect and `rebuilt` frames on change, presentation-only wire that never enters the session log. Polling is deliberate because inotify does not fire on the weka network mount, the same reason the build-side watcher needs `--poll`; the interval is a validated config field (default 500ms), and disposal clears the one timer. Rebuilding bundles is any tsdown watch process's business — `scripts/dev-web.ts` remains the watch-build entry point, discovering its package list through `dsh.client` while scanning `packages/*/*/package.json` at startup — and builder and host share zero protocol. A torn read self-heals: stats keep changing while the write completes, so the next poll re-hashes and broadcasts the final rev.

On the browser side, the driver reloads one plugin per frame, serialized:

1. `invalidate` — drop the stale factory and record. A live factory would make the next step a no-op.
2. `prefetch` — load the external script and register the fresh factory, while the old fiber still serves.
3. `registry.delete` — before touching the fiber. A bare fiber dispose trips the vendored Loader's self-dispose branch, which would disable the entry permanently.
4. Drain the old fiber's disposers.
5. Remove owned `<style data-plugin>` tags.
6. `entry.refresh()` — re-imports, materializing the fresh factory. CSS re-injects here, under the same stable tag ids.
7. `fiber.await()` — rethrows loud.

Every plugin shares this one semantics; an `immediately` row reloads exactly like a lazy one. Dependency cascade costs zero client code: a fiber's activation epoch strings its service providers' uids, so replacing a provider's fiber re-loads every dependent through cordis itself. Reloading connection or runtime cascades the whole UI — correct, if heavy.

The support boundary, stated honestly. Reload is coarse by design: fresh fiber, fresh components, React state lost, data layer untouched — react-refresh-grade state preservation conflicts with "re-executing the bundle re-runs the factory" and is deliberately out. Plain packages (react family, shell kernel, not-yet-promoted libraries) are not entries: changing them means a shell rebuild and a full page reload. No rollback in v1: an import failure leaves the entry fiberless and the next rebuilt frame retries from scratch; an apply failure leaves a FAILED fiber for the status projection; both log loudly. Self-reload works — the in-flight reload finishes in the old bundle's closure and the new apply opens a fresh SSE channel — but frames arriving in the gap are lost, and the next rebuild renotifies. One known dev-only race: a rebuilt frame overlapping a still-in-flight boot arrival shares that arrival's task and may materialize the pre-rebuild bytes; the next frame self-heals.

## Package inventory (today → long term)

| Package | Role | Today | Long term |
|---|---|---|---|
| react family / cordis | platform singletons | shell-bundled, seeded | plain forever (absolute base) |
| vendored `@cordisjs/plugin-loader` | entry governance (same code both sides) | compile-time browserization, kernel-mounted | untouched (vendor policy) |
| `dsh-client-modules` | the client module system | lazy CJS table; two-phase boot | plain forever (modules precede modules) |
| `dsh-client-web` | shell kernel + AppRoot + app-shell assembly | self-sufficient (hand-rolled status stores, no plugin value imports) | keeps shrinking |
| `dsh-client-ui-slots` | slot registry core | plain, seeded | promote to plugin; receive runtime's slots machinery |
| `dsh-client-web-react` | ctx↔React glue | plain, seeded | promote to plugin; renderer install moves into its apply |
| `dsh-client-ui-primitives` | base components | plain, seeded | promote to plugin (components via slots/services) |
| `dsh-client-connection` | wire layer | plugin (`dsh.client` + bundle), declares `immediately` | transport swap (Electron IPC carrier) |
| `dsh-client-runtime` | session object layer + slots service + store engine | plugin, declares `immediately` | keeps shrinking toward a pure session object layer |
| `dsh-client-ui-theme` | theme tokens/service | plugin, declares `immediately`, plus the `./styles/*` source channel | Theme Registry (separate ruling) |
| `dsh-client-i18n` | I18nService | plugin, declares `immediately` | per-deployment locale composition |
| `dsh-client-hmr` | hot reload driver | plugin, declares `immediately` | rollback; reconnect handshake |
| ui-layout / ui-sidebar / ui-conversation / ui-trajectory | UI features | plugins, on-demand | conversation domain split; trajectory real implementation |

## Consequences

One governance implementation runs on both sides of the wire; the browser-specific layer is one module system plus one reload plugin. Plugin packages have one shape, so the purity gate covers them all. Dependency edges and the boot tier live with their owners — the manifests — while the composing app holds only the roster. The drift classes stay structurally closed: share-list hand-sync, load-order coupling, cross-plugin imports, roster/tier double bookkeeping. Browser-native script loading preserves the standard mapping among plugin network resources, generated bundles, and TypeScript/TSX sources, while the module system keeps only one replaceable `loadBundle` hook.

Costs accepted: the vendored Loader carries idle machinery in the browser (EntryTree persistence is a no-op, groups/isolation unused); every plugin edit in dev pays a bundle rebuild plus fiber remount; graph `inject` rows are informational — activation truth is service-level — so a mismatch appears at the settled sweep, not at graph validation; the three not-yet-promoted libraries keep their static-import exports until their DI conversions land; every bundle gains a source-map artifact; and external-script failures provide only coarse URL diagnostics instead of the HTTP status available to an explicit fetch.

Roster: it lives in the web bundle's config tree (`packages/bundle/web-app/cordis.patch.yml`); `mountWebPlugins` and the `CLIENT_PACKAGES` constant are gone, and recomposing a deployment means swapping the yml/overlay. The graph composer moved from a webserver-side registry into the `dsh-client-modules` node half (the package upgraded to dual-face per this note's promotion rule — its consumer now reaches it through cordis DI), and the transport split landed alongside: the webserver became a plain route-registration plugin, `/api/*` binding moved to the connection node half over the upgraded `api-gateway` plugin (`dsh-host-apiproxy` providing `ctx.apiProxy`), and the dev bundle watch + SSE channel moved to the hmr node half.

## Alternatives considered

| Rejected | One-line reason |
|---|---|
| Two-axis taxonomy (entry × arrival) with infrastructure packages lacking `dsh.client` | Erased manifest dependency edges (inject leaked to the composer), split the plugin shape in two, blinded the purity gate to half the plugins |
| Keep evolving the hand-written loader into a governor | Re-implements entry/fiber lifecycle the vendored Loader owns; HMR would have no shared skeleton with the host side |
| Reuse `@cordisjs/plugin-hmr` in the browser | ~80% solves problems the browser doesn't have (fs watching, deep graph coloring, Node's dual caches); the reload skeleton is copied as a shape |
| Module federation | Independently built remote bundles are exactly the form vite federation does not support |
| Import maps | Ruled out earlier; the DI require table is the terminal mechanism |
| Full ctx-ification now (react and libraries via services, no module table) | The module-axis extreme; parked — the upgrade law walks there one package at a time instead |
| Eager instantiation with a frozen table | Requires arrival-time ordering; lazy CJS registration makes recursive `require` self-ordering and matches the naive-puller phase split |
| Fetch response text, then inject an inline `<script>` | Makes the module system buffer the complete source and maintain separate fetch/execute paths; dynamic source execution also breaks the browser-native association among the network resource, source map, and profile |
| Builder-push rebuild channel (`POST /plugins/rebuilt` from the orchestrator's `onSuccess`) | Couples reload to one blessed builder process and a second wire protocol; the webserver already holds every bundle path, and stat polling covers the torn-write race (re-hash on every stat change) that once justified pushing |
