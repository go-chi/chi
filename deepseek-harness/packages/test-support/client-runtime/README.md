# @deepseek-ai/dsh-client-test-runtime

English | [中文](README.zh.md)

jsdom slot test runtime for client feature specs: a real Cordis `Context`, the production `SlotRegistry` and web-react renderer, assembled around typed session/workspace doubles. Feature suites exercise declaration, registration, scope, store, inject, rendering, updates, and disposal without hand-building the machinery per suite — and without a second implementation of any production logic.

The doubles implement the same outward faces features receive through ctx (`TestSessions implements ISessions`, `TestWorkspaces implements IWorkspaces`; each fixture session is a `FixtureSession implements SessionFace`; `stubSettingsScope` is a `SettingsScope` with test-driven publications and a write spy), so a production face change breaks the bench at compile time instead of silently drifting. Provide-bundle materialization runs the production `SessionProvideChannel` — the one implementation shared with `SessionRuntime`. Fixtures feed plain data: list rows, conversation snapshots (immer-patched via `updateSnapshot`), projection values, and `ISession`-typed behavior stubs that fail loud when a spec calls an unstubbed verb. The typed `provide()` constrains fakes for declared service names to `Partial` of that service's outward face.

Local DOM snapshots: `declare(children)` registers an auto frame whose per-key `<div data-slot>` wrappers are snapshot roots; `renderSlot(key, owner)` returns the slot-local view (container, scoped Testing Library queries, in-place `update(owner)`); a registered snapshot serializer folds CSS-module class hashes (`_frame_a1b2c3` → `frame`) to keep `.snap` files structural and collapses `<svg>` internals to a `data-content` fingerprint. Suites needing a custom page frame use `root.declare(children, Frame)` instead; `mount(plugin)` runs a real fiber with fail-loud service prechecks, and `dispose()` tears down views, feature fibers, minted scopes, and persisted store state on one axis.

Not part of the product plugin graph (no `dsh.client`); feature packages depend on it in `devDependencies` only.

## Model Experience

None, as this package is browser-side test infrastructure; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Consumed through repository source aliases only.** Specs resolve the package through tsconfig `paths` to `src`; the built `lib/` artifact re-exports `@deepseek-ai/dsh-client-runtime/client`, whose bundle is a browser loader script with no Node ESM exports, so `lib/index.js` is not importable under plain Node. Every consumer is an in-repository Vitest suite; there is no Node-compatible runtime entry.
- **Conversation snapshots are fixture data, not replayed history.** `updateSnapshot` writes the snapshot store directly; the wire-to-snapshot computation stays covered by the runtime package's own tests and the replay e2e. A fixture can therefore express states the production projection would never produce.
