# Agent Note: Drop the unconsumed web observation surface — the `providers-change` event and the status methods

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-04-drop-unconsumed-web-observation-surface.zh.md)

## Problem

`WebService` exposes an observation surface no production code observes:

- **`web/providers-change`** (`packages/web/web/src/index.ts`) is declared and emitted on every provider registration and disposal, and each registration effect's rollback yield is ordered BEFORE the emit solely so a throwing change listener unwinds the registration. No listener exists outside the package's own two unit tests (one of which exists to pin that rollback ordering).
- **`searchStatus()` / `fetchStatus()` and the `WebCapabilityStatus` union** (same package) have zero production callers: `dsh-tool-web` executes directly through `ctx.web.search()`/`fetch()` and surfaces unavailability as the structured `WebError` codes the seam throws at execution time (`packages/web/tool-web/src/search.ts`, `packages/web/tool-web/src/fetch.ts`); the only status callers are the web packages' own tests. The prose in `packages/web/tool-web/README.md` and [architecture.md](../../../../docs/architecture.md) claims the tool "reads only the aggregated `searchStatus()`/`fetchStatus()`" — drift that survives only because nothing checks prose against call sites.

The seam's own design starves both surfaces of consumers: tool registration follows product ENABLEMENT, not provider availability (`packages/web/tool-web/src/index.ts`), and provider selection resolves at execution time, never cached — so there is no cache to invalidate, no registration set to recompute, and no caller that needs an availability probe distinct from executing and routing the structured error. HMR cleanup is carried by the effect disposers themselves.

This mirrors [drop the unconsumed `llm/adapter-change` event](2026-06-20-drop-unconsumed-llm-adapter-change-event.md), which removed the same notification shape, the same rollback-before-emit machinery, and the same listener-throw test from `LlmService`. That Agent Note's keep/cut criterion — keep `tools/change` for its plausible user-facing tool-list consumer, cut the boot-time backend-registry signal — puts a web-provider registry squarely on the cut side; the status methods are the same judgment applied to a pull surface instead of a push one.

## Decision

Remove the registry-change event, aggregated status methods and type, and their dedicated tests. Provider-private status remains for execution-time selection. Caller-facing coverage now asserts successful execution or structured selection errors, and the owning web docs describe that on-call contract.

## Alternatives considered

### Why not keep it?

The web seam Agent Note specified both deliberately — the event as a minimal HMR-visibility signal, the status methods as the tool's aggregated diagnostics — and a future provider-status panel is imaginable. But the same Agent Note's other choices starved them: derived-on-call selection and enablement-based registration leave no consumer that CAN need either, the shipped tool demonstrates the real pattern (execute and route the structured error), and the drifted README sentence shows the promised consumer never materialized. Per AGENTS.md "Agent Notes are proposals, not golden truth", these are the parts of that proposal the code has since shown to over-reach; a future observer reintroduces the smallest signal or query it actually consumes, shaped by that consumer.

## Verification

No `providers-change`, `searchStatus`, `fetchStatus`, or `WebCapabilityStatus` spelling survives outside Agent Note history; the catalog is fresh (`verify-cordis-catalog` green); registration/disposal HMR-safety tests prove cleanup through execution behavior; and the tool-web README plus the architecture paragraph describe the execution-time error-routing contract the tool actually has.

## Consequences

A future provider-picker UI or diagnostics panel that wants change notifications or a status query re-adds the smallest surface it consumes; the identical judgment, and its reversal condition, is already recorded on the llm precedent.
