# Post-mortem 0001: ACP server crashed on connect — `export default` dropped the plugin's `inject`

English | [中文](0001-acp-default-export-drops-inject.zh.md)

Status: resolved (fix in PR #41 `feat/acp-2-bridge`)

## Executive summary

Two integration mistakes broke ACP despite full unit coverage: a default export caused the Loader to discard `inject`, and a traced optional-service lookup failed across a shadow boundary. Hand-mounted tests bypassed both paths. The fixes added keyless real-Loader coverage and package rules for plugin exports and optional-service access.

## Summary

The ACP server (`examples/acp-agent`, `@deepseek-ai/dsh-acp`) crashed the instant a real editor (Zed) connected: the first `session/new` request returned `Internal error: cannot get property "agents" without inject`, and `session/load` returned the same for `sessionPersistence`. The bridge was completely non-functional in production despite 178 green unit tests and 100% line coverage. Two independent bugs were hiding behind the same error string, and the test suite missed both for the same reason: every test mounted the plugin through a path that did not exercise how it actually loads or how its services actually resolve.

## Impact

The ACP server could not create or load a single session — the two RPCs an editor calls first. Anyone wiring the agent into Zed got an immediate hard failure. No data loss (nothing persisted before the crash); the cost was entirely "the feature does not work" plus the debugging time to find out why, twice.

## Timeline

- The bridge (RFC 010) landed with a full unit suite for the codec, in-memory transport, generated protocol messages, failure paths, and HMR; a key-gated real-API e2e; and a no-key stdout-purity e2e. All green, 100% coverage.
- A real Zed session immediately failed on `session/new` with `cannot get property "agents" without inject`.
- Investigation initially pursued a Cordis "traceable/shadow" theory (plausible, and the mechanism is real — see Bug #2), then instrumented the actual fiber walk in vendored `reflect.ts` and ran the real subprocess. The trace showed the throw at `apply()` line 179 *at plugin load time*, on the ROOT fiber with no shadow — falsifying the shadow theory for `session/new`.
- Root cause #1 found: a stray `export default apply`. Removing it fixed `session/new`.
- Removing it then exposed Bug #2: `session/load` still threw on `sessionPersistence` — a genuinely distinct mechanism (the shadow walk), confirmed by isolating the fix and re-running the real subprocess.

## Root cause #1 — `export default apply` drops the plugin's `inject` (broke `session/new`)

`packages/acp/acp/src/index.ts` is a *namespace plugin*: it exports `name`, `inject`, `Config`, and `apply` as separate named exports, as every other plugin in the repo does (`invariants`, `llm-deepseek`, `tool-bash`, `tui`, …). But it *also* ended with one extra line no other plugin had:

```ts ignore-check
export const name = 'acp'
export const inject = ['agents', 'sessions', 'sessionPersistence']
export function apply(ctx: Context, config: AcpConfig): void { /* … */ }
// …
export default apply   // ← the bug
```

When a plugin is loaded from `cordis.yml`, the cordis Loader normalizes the imported module through `Loader.unwrapExports` (`vendor/loader/src/index.ts`):

```ts ignore-check
unwrapExports(exports: any) {
  if (isNullable(exports)) return exports
  exports = exports.default ?? exports        // ← prefers `.default`
  if (!exports.__esModule) return exports
  return exports.default ?? exports
}
```

With a default export present, `exports.default ?? exports` resolves to the **bare `apply` function**. A bare function has no `inject`, no `name`, no `Config` properties — those lived as *sibling* named exports on the module namespace, and unwrapping to `.default` threw the namespace away. The Loader then built the plugin's fiber from an empty `inject`.

Consequently `apply` ran in a fiber with **no injected services**. The very first line, `const agents = ctx.agents`, walked the fiber tree (ROOT → Include → Loader → ROOT) and, finding `agents` in no fiber's store and reaching the root fiber (`runtime === null`), threw `cannot get property "agents" without inject`. The crash was at *load time*, not in a later request handler — the request just happened to be what triggered the load in the failing trace.

**Fix:** delete `export default apply`. The Loader then uses the module namespace, honors `inject`/`name`/`Config`, and `apply` runs inside a fiber that actually grants the declared services.

## Root cause #2 — optional service read trips the inject guard through a traceable shadow (broke `session/load`)

With #1 fixed, `session/new` worked but `session/load` still threw `cannot get property "sessionPersistence" without inject`. This one *is* the Cordis traceable/shadow mechanism, and it is worth understanding precisely.

`session/load` calls `agents.resume(...)`, which delegates to `AgentLoop.resume()`, which read `this.ctx.sessionPersistence`. `AgentLoop`'s `static inject` deliberately does NOT include `sessionPersistence` — injecting it would make non-persistent demos pend forever waiting for a backend that never loads. The service is provided by a separate sibling plugin/fiber and read opportunistically.

Service access in Cordis goes through a context proxy (`vendor/cordis/src/reflect.ts`). When a service method is invoked through a *traceable proxy* obtained from a foreign fiber (here: the bridge fiber calls `ctx.agents.resume`, and the registry hands back `this.factory` — the `AgentLoop` — re-wrapped as a fresh traceable proxy bound to the caller), `createShadowMethod` (`vendor/cordis/src/utils.ts`) rebinds `this` to a *shadow* object whose `ctx` carries `[symbols.shadow]` pointing at `AgentLoop`'s own construction context. Inside `resume`, then, `this.ctx.sessionPersistence` resolves with the proxy handler starting its fiber walk from the shadow's fiber:

```ts ignore-check
// reflect.ts get handler
let fiber = (ctx[symbols.shadow] as Context ?? ctx).fiber   // ← starts at AgentLoop's fiber
while (true) {
  const impl = fiber.store?.[prop]
  if (impl) return getTraceable(ctx, impl.value)
  if (prop in fiber.inject) { /* inactive-context error */ }
  if (!fiber.runtime) throw error                            // ← reached root, throw
  if (fiber.parent[symbols.isolate][prop] !== key) throw error
  fiber = fiber.parent.fiber                                 // ← ancestor-only
}
```

The walk is **ancestor-only**. `sessionPersistence` is in neither `AgentLoop`'s fiber store (not in its `static inject`) nor any ancestor on the way to root (it lives on a *sibling* branch), so the walk reaches the root fiber and throws.

Why didn't the in-memory `AgentLoop` resume tests catch this? Because they call `ctx.agents.resume(...)` directly from test code — *outside any plugin fiber*. There, `ctx.fiber.runtime` is `null`, so the proxy handler takes an early bypass:

```ts ignore-check
if (!ctx.fiber.runtime) return ctx.reflect.get(prop, false)   // ← direct global-store lookup, no fiber walk
```

`ctx.reflect.get(name, false)` is a direct lookup in the global service store keyed by the isolate symbol — it ignores fiber topology entirely and finds the service. So from a top-level test the read works; from inside a real plugin fiber, reached via a shadow, it throws. The bridge is exactly the latter.

**Fix:** read the optional service with `ctx.get('sessionPersistence')`, which uses the global isolate-keyed store while preserving active-state checks. Direct property reads remain appropriate for services in the plugin's declared injection set.

## Why every test missed it (the real failure)

Both bugs share one root process gap: **no test exercised the plugin through its real load path or its real call topology.**

- The in-memory harness mounts the bridge by hand-building a plugin object: `ctx.plugin({ name, inject, apply })`. That supplies `inject` manually, so it can never reproduce Bug #1 — `unwrapExports` is called only by the *Loader*, never by `ctx.plugin`. Even `ctx.plugin(NamespaceImport)` would not have caught it.
- The same harness mounts everything flat on one root context, so an `AgentLoop` resume reached from it either runs top-level (the `!runtime` bypass) or through a shadow whose origin still resolves on root — masking Bug #2's ancestor-walk failure.
- The only no-key e2e sent `initialize` and checked stdout purity. `initialize` never reaches the factory, so it sailed past both bugs.
- The only test that drove `session/new`/`session/load` was key-gated, so CI (no key) skipped it — and locally it "passed" only because a stale built `lib/` (with the old code) happened to satisfy module resolution.

100% line coverage was satisfied the whole time. Coverage proves lines *ran*; it says nothing about whether the feature works *the way it ships*.

## Guardrails added

- **Removed `export default apply`** (`packages/acp/acp/src/index.ts`) — the Bug #1 fix.
- **`AgentLoop.resume` reads `this.ctx.get('sessionPersistence')`** (`packages/core/agent-loop/src/index.ts`) — the Bug #2 fix, with a comment explaining the shadow-walk trap.
- **No-key `session/new` e2e over real stdio** (`examples/acp-agent/tests/acp.e2e.ts`): boots the example as a subprocess through the real Loader and asserts `session/new` resolves. This fails loudly on Bug #1 with no API key. Verified it fails when `export default apply` is restored.
- **`TSX_TSCONFIG_PATH` in the e2e spawn**: the subprocess runs from a temp cwd, where tsx cannot find the repo-root tsconfig `paths` map by searching upward — so dsh-* imports silently fell back to built `lib/`. Pointing tsx at the repo tsconfig makes resolution cwd-independent and ensures the test runs *source*, not a possibly-stale build.
- **[docs/testing.md](../testing.md) rule**: "test the real entry path", line coverage is not behavior coverage — codifies the lesson for every future plugin.

## Lessons

- A namespace plugin and a default export are mutually exclusive under the cordis Loader. Pick the namespace form (`name`/`inject`/`Config`/`apply`) and do not add `export default` — `unwrapExports` will discard the namespace.
- For a service a plugin reads opportunistically but does NOT declare in `static inject`, use `ctx.get(name)`, never `ctx.<name>`. The property proxy resolves by an ancestor-only fiber walk that fails through a foreign shadow; `ctx.get(name)` is the topology-independent lookup (and strict by default — an inactive backend reads as `undefined` rather than being handed back mid-teardown).
- A test that constructs a plugin by hand cannot validate how the plugin loads. At least one test must drive the real Loader/export path end-to-end. When the headline operation does not call the model, that test needs no API key — so it belongs in CI, not behind a key gate.
- Trust the trace, not the theory. The elegant shadow explanation was real but was the *second* bug; the *first* was a one-line export mistake that a fiber-walk `console.error` found in minutes after hours of plausible-but-wrong reasoning.
