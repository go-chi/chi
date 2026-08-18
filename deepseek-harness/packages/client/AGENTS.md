# AGENTS.md — Web client stack

Rules for `packages/client/*` (the browser side of the dsh web GUI) plus its build entry `apps/web`. They supplement the repo-wide [conventions](../../AGENTS.md#conventions) and the [package rules](../README.md). Before touching slots, component props, stores, or plugin structure, read the [slot system standard](../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md) (the definitive composition model) and the [web client architecture note](../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md) (loading chain, object layer, services).

Packages here are named with the directory prefix: `@deepseek-ai/dsh-client-<name>`.

## Slot and props discipline

The [slot system standard](../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md) owns the full design; these are the rules you must not violate when writing or reviewing client code:

1. **One API**: a plugin composes UI only through `ctx.slots.register({ name, children?, store?, inject? }, Component)`. There is no separate slot-definition call, no whitelist face object, no face-minting helper. The shell alone renders `'root'`.
2. **children = declaration + authorization**: the slots your component renders are exactly the keys of your register call's `children` object (spec values: `kind`/`scope`). Rendering a slot you didn't declare, or declaring one someone else declared, fails at load — do not work around it; the conflict is the design speaking. Slot names mirror the composition path: `<domain>.<entry>.<hole>` (e.g. `'tool.call.toolview'`).
3. **Component props are the four shares, all derived**: `PropsRuntime<K>` (SlotMap: owner params + `useSession`/`sessionId` on session scope + global `useSessions`/`useWorkspaces`) & `PropsRenderSlots<S>` (children keys) & `PropsStore<H>` (store factory) & the inject face. Never hand-write a member a share already derives; never re-type a share locally.
4. **Hooks are framework-made only**: `useSession`, `useSessions`, `useWorkspaces`, `useStore`, `renderSlot` are the five standing seats, plus the `use<Name>` hooks the renderer binds from provide contributions and inject `hooks` compartments. Business code never creates a hook or selector as a prop value — pass plain data and callbacks. (Component-internal behavioral hooks that subscribe to nothing external are fine.)
5. **Live data has exactly three channels**: parent knows it → owner props at the renderSlot site; only the component knows it → local state; shared across entries or survives remounts → a store declared at register. Derived data is a pure function over framework-hook data (`useMemo`), never its own subscription.
6. **Stores: read `props.useStore`, write `props.actions.*`** — the declared actions are the complete mutation API. Write the store as an exported `createXXXStore()` factory (module-level handles are forbidden — de-facto singletons); share by passing one handle to several registers inside `apply`. Production code never calls the factory or `.create()` outside `apply`; tests do (that is the sanctioned zero-machinery path).
7. **inject returns plain data and callbacks** from the apply closure's own ctx — no hand-made hooks, no ReactNode producers, no whole-service objects. A registrant-private reactive fact uses the reserved `hooks` compartment (bare observables the renderer binds to `use<Name>`; components never see the sources). The plugin may use only the dependencies named by its `inject` declaration; there is no wider ctx to reach for.

## Reactive read and contract-currency discipline

How live data reaches render code, and what UI domains may share:

1. **Everything a render reads that can change outside React arrives through a framework hook** (rule 4 above). Event-handler code may read live snapshots (e.g. `keyboard.snapshot`); render code subscribes.
2. **Business components contain no subscription machinery** — no `useSyncExternalStore`, no manual subscribe wiring, no mirroring an external snapshot into local state or a second store. Give each reactive fact its owning channel instead: registrant-private → the inject `hooks` compartment; cross-entry or remount-surviving → a declared store; per-session standard → `sessions.provide`.
3. **Data-access ladder** — resolve needs in this order: framework hooks (standing seats + provide/inject-bound `use<Name>`) → a declared store (`useStore`/`actions`) → inject callbacks → anything else is a new framework extension point and needs main-thread arbitration.
4. **UI domains share only JSON-compatible data and callbacks.** Owner props, injected values, store state, and provide contributions are plain serializable data or callbacks over such data. The injected `hooks` compartment is the only place for bare observables, and components never receive those sources directly. Route ReactNode content through a slot; do not add ReactNode-valued owner props or injected members (the composer's existing `accessory`/`overlay`/`leftItems`/`rightItems` fields remain until they move to slots).
5. **An observable source keeps two identities stable**: the source object itself (hook binding is cached per source), and its snapshot between changes (`getSnapshot` returns the same reference until the fact moves).
6. **Whoever rebuilds a published value republishes it through the same source in the same step**, and a registration path that can run after consumers exist notifies the live consumers as part of registering.

## Export discipline (client plugin packages)

The `/client` entrypoint of a UI plugin package is its public browser API, not a convenience barrel. Three rules apply package-wide (do not restate them as per-file comments):

1. **A UI plugin exports no values beyond what cordis loading needs** — `apply` / `inject` (and `Config` where present), plus store factories consumed type-only by components (`ReturnType<typeof createXXXStore>`). Shared types (owner data, injected values, composed prop aliases) may also be exported. Implementation components, pure helpers, constants, and store handles stay internal. Adding any new value export requires user sign-off, not a matching consumer.
2. **Same-package tests import internals directly** — relative `../src/client/xxx.ts` from package tests, or the `./src/*` subpath where a spec lives outside the package. Never widen the public API to make a test compile.
3. **Cross-package imports of another plugin's symbols are in principle forbidden.** The sanctioned routes are the slot system (register/renderSlot) and ctx services. If neither fits, stop and escalate — do not add an export to unblock yourself.

## ctx discipline (components never see ctx)

`ctx` belongs to the apply world only: the plugin body and the inject factories closed over it. Components — every `.tsx` under a feature domain — receive all data and callbacks **through the four props shares**; they never call a hook that reaches ctx, never import a service class to poke it, never read a React context (business components see zero contexts — `BindingContext` and its kin are renderer-internal). If a component needs something new, the answer is a prop threaded from its share's source (owner site, store declaration, or inject face), not a hook.

## Layering red lines

The stack has one-way knowledge, settled in the [web client architecture note](../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md):

1. **Data object layer** (`runtime`, React-free): `ConnectionController` → `SessionManager` → `Session` own all business state (event windows, streaming accumulation, reconnect machine), and the snapshot-store engine (zustand/immer, `defineStore`, `shallowEqual`) lives here too — store products are bare observable sources with no hook members. Zero React imports — grep-assertable.
2. **Render machinery** (`web-react`, shell-only glue): all ctx-to-React integration — slot renderer/outlets, `SessionProvider`, and the uSES adapter. Every hook is composed here at the binding site from bare sources; business plugin packages carry no web-react dependency at all.
3. **Presentation components** (plugin packages' `src/client/`, pure props): consumables, expected to be rewritten wholesale. Business logic must not leak into them; everything arrives through the four props shares.

Non-negotiables across the layers:

- **Business data lives in the object layer, never a store.** Entry-declared stores carry shared viewing/interaction state (selection, drafts, panel widths); sessions, frames, and connections stay in the object layer.
- **rpcId is strictly bidirectional**: the initiator mints, the responder echoes; business signatures see only `RpcRequest<P>`, minting stays in the carrier layer ([layering and RPC protocol note](../../.agents/notes/implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md)).
- **Notifier publication discipline**: `notifyNow` is only the direct echo of a user gesture; structural updates use microtask-batched `markDirty`, while visible streaming chunks use cumulative `markFrameDirty`. See `runtime/src/client/sessions/notifier.ts`.
- **The web layer is pure presentation.** Nothing that is "how to draw" (tool-card views, queue states) enters the session log; the host computes such data per frame or pushes it live, and replay recomputes it — falling back to the generic form when it can't. A new *model-visible* input still requires a session event (repo-wide rule).

## Conversation Node discipline

- A Chat business feature registers one `ConversationNodeDefinition` and its keyed `conversation.chat.node` renderer; do not add its event switch or fold to `Session`, `SessionManager`, or a central built-in dispatcher. Follow the [Conversation Node cookbook](../../docs/cookbook/adding-a-conversation-node.md).
- `match(event)` reads only the current event. Every event in a multi-event Context carries or independently derives the same stable business id; `update` folds one Match into State and remains deterministically replayable by log `seq`.
- The append hot path and renderers never scan the full event window, Contexts, or Chat Nodes. Accumulate in State, publish same-Turn/Step facts through `buildLocationData()`, and consume final Node data or constrained Location hooks.

## Directory regime (plugin packages)

One UI feature = one plugin package (`src/client/` browser half). A multi-domain package splits where its code could later become separate packages — ui-conversation is the example: `contract/` (the only shared API), domain directories that never import a sibling domain, and `apply.ts` as the single cross-domain assembly point; `scripts/verify-client-domain-graph.ts` enforces the levels. Registration goes through `slots.register` in `apply` — never module-level side effects.

## Styling

[docs/web-styling.md](../../docs/web-styling.md) is authoritative. Shared `--dsw-*` tokens and global sheets live in `ui-theme/src/styles/`; feature components consume semantic aliases through CSS Modules and `clsx`, with no literal colors, component library, or Tailwind. Product copy is Chinese; code comments are English.

## Testing and coverage

The GUI test structure (three tiers, lane map) is settled in the [GUI testing system note](../../.agents/notes/implemented/process/2026-07-20-gui-testing-system.md); repo-wide policy in [docs/testing.md](../../docs/testing.md).

- Client source packages are inside the per-file 100% coverage gate (`pnpm run test:coverage`). Genuinely unreachable defensive arms take a `/* v8 ignore -- <reason> */` comment with a real reason, never a bare ignore.
- Component specs render with realistic props or a driven fixture runtime and assert user-visible behavior, not class names, hook internals, or render counts.
- The jsdom environment comes from a per-file `// @vitest-environment jsdom` pragma on the spec's first line; the shared config stays node-env.
- Each tier asserts its own layer. Data-layer semantics belong to the runtime and host suites; component specs cover presentation behavior.

## Before you push: the local check ladder

Run the narrowest rung that covers what you touched; escalate only when the change surface demands it.

1. **Every GUI code change** — `pnpm run test:gui` (seconds; no browser, no server): the client suites plus the host-side GUI packages. This is the inner loop; run it as freely as a typecheck.
2. **Any change that can alter the assembled browser or visible conversation/UI output** (client components or copy, `apps/web`, Vite, `dsh-host-webserver`, connection/handler/SSE) — additionally `DSH_SNAPSHOT=replay pnpm run test:web`: rebuilds the frontend dist, then runs the browser smoke pair (the real-host case self-skips without `DEEPSEEK_API_KEY`) plus the keyless replayed e2e scenarios. Linux PR CI uses the same read-only replay mode. Use `DSH_SNAPSHOT=refresh` only after confirming an intentional output change, or `DSH_SNAPSHOT=record` with a key to re-record fixtures.
3. **Before a PR** — use [dsh-pre-push-checks](../../.agents/skills/dsh-pre-push-checks/SKILL.md) to select the narrow checks for the outgoing diff; there is no repo-wide pre-push aggregate.

If `test:gui` is red on code you did not touch, neither silently fix nor ignore it: note it in your handoff so it lands in the next PR window's sweep.

## New plugin package checklist

Bringing up a new `packages/client/<name>` plugin package (ui-workspace is a complete example; ui-sidebar/ui-user-questions are minimal skeletons):

1. **Package skeleton**: `package.json` (`@deepseek-ai/dsh-client-<name>`, exports `.`/`./invariant`/`./client`/`./src/*`/`./package.json`, `dsh.client` manifest, `files` list), `tsconfig.json` (extends `tsconfig.base.client.json`, one `references` entry per workspace dependency plus `runtime-diagnostics/invariants`), `tsdown.config.ts` (`clientBundle(id, ['lib/types/index.js', 'lib/types/invariant.js'])`), `src/index.ts` (empty node-half apply), `src/invariant.ts` (companion with a real reason), `src/css-modules.d.ts` when using CSS Modules, `README.md` with the Model Experience section.
2. **Three registration surfaces, all required** (missing any one fails at a different, later point): the `tsconfig.client.json` aggregate `references` entry; a `dsh.client` row in `packages/bundle/web-app/cordis.patch.yml`; a `packages/bundle/web-app/package.json` dependency (profile boots resolve bare row names through the healed `$DSH_HOME/profiles/node_modules` fallback, which mirrors the app's and each bundle's declared dependencies — a row whose package no manifest declares fails to import). `pnpm-workspace.yaml` already globs `packages/*/*`.
3. **dsh.client manifest semantics**: `platform: 'web'` always; `immediately: true` only for stage-one-prefetch infrastructure rows. `inject` lists package-name dependency edges — they are **informational only** (preflight display, HMR diffing); they do not sequence entry activation or apply order. Activation order is cordis fiber inject waiting on *services*, nothing else.
4. **Registering into another package's slot**: apply order is unconstrained, and a business service is not a declaration barrier. Use `ctx.slots.inject(name, () => ctx.slots.register(...))`; it waits on the actual declaration, removes the contribution when that declaration collapses, reruns after redeclaration, and leaves with the caller's plugin fiber. Return a generator yielding each registration when several contributions must install and roll back atomically. A bare `slots.register` into an undeclared slot remains an error; keep service edges only for services the contribution actually reads.
5. Rebuild the bundle (`pnpm --filter <pkg> bundle`) before probing a live `dsh web` server — the registry serves `lib/client.js`, not sources.

## New component checklist

1. Compose through register: add the slot to `SlotMap`, declare it in its parent entry's `children`, and register your component — see the [slot system standard](../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md). No other composition route exists.
2. Type the props as the four shares (`PropsRuntime` & `PropsRenderSlots` & `PropsStore` & inject face) — derive, don't hand-write. Shared/surviving state goes in a `createXXXStore()` factory declared at register; component-private state stays local.
3. Component tests feed props directly (`createXXXStore().create()` for the store data; plain stubs for framework hooks) and assert behavior without render machinery.
4. Tokens only in CSS; Chinese product copy; English comments.
5. `pnpm run test:gui` green; if the component changes visible assembled output, also run `DSH_SNAPSHOT=replay pnpm run test:web`.
6. Non-trivial change? It needs an Agent Note in the same PR (repo-wide rule) — the GUI notes above are the precedents to extend.
