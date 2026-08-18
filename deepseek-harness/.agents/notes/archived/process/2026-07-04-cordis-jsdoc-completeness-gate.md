# Agent Note: JSDoc completeness gate for the cordis surface

Status: implemented
Archived: 2026-07-27

English | [中文](2026-07-04-cordis-jsdoc-completeness-gate.zh.md)

## Problem

The generated Cordis catalog enforced event dispatch modes but not complete service and event contracts. Methods could lack descriptions, and parameters or returns could be undocumented on the cross-plugin API surface where IDE guidance matters most.

The AGENTS.md rule ("every export has a JSDoc explaining semantics") is prose-checkable only by review; the repo's stated preference is to encode invariants in mechanical gates. The scope "cordis service functions and events" has a precise machine definition that only the catalog generator knows: events are the `interface Events` members inside `declare module 'cordis'`, and the service surface is the public methods of the class each `interface Context` key names. An ESLint rule cannot see that mapping; the generator computes it on every run.

## Decision

Extend `scripts/gen-cordis-catalog.ts` — the same walk, the same `@mode` precedent — to enforce JSDoc COMPLETENESS on everything it catalogs. `verify-cordis-catalog` runs inside `doc-sync`, so relevant documentation changes and CI exercise the same gate without separate wiring.

The contract:

- **Events** need description prose plus a non-empty `@param` for every **payload parameter**. A payload parameter is a signature parameter that carries event data; the `this` receiver annotation and the trailing waterfall `next` are exempt — `next` is dispatch machinery whose semantics the `@mode waterfall` tag (and its structural cross-check) already owns, so restating it per event would be boilerplate. Documenting an exempt parameter anyway is allowed; only absence is checked.
- **Service classes** need class-level JSDoc, and every public method needs description prose, a non-empty `@param` per parameter, and a non-empty `@returns` unless the annotated return type is `void`/`Promise<void>` (where `@returns` stays optional — resolution timing can be worth documenting — but is never required).
- **Stale tags error**: an `@param` naming no real parameter is a violation, mirroring the `@mode`-contradicts-signature check. Tag descriptions must be non-empty; their semantic quality beyond that is review's job.
- **Explicitness the walk can check**: the gate is a pure-AST pass (no type checker), so a service method must annotate its return type (an inferred return cannot be classified) and surface parameters must be simple identifiers (a binding pattern has no name for `@param` to match).
- **Violations aggregate** into one error listing every offender — a remediation pass sees the whole list at once. The previously fail-fast `@mode` checks moved into the same aggregated report, with their message texts unchanged.

The generator keeps two views of the same source comment: `parseJsDoc` ends entry prose at the first block tag, while the `ts cordis-catalog` signature block includes the original JSDoc with `@param`, `@returns`, and `@mode` intact. Readers therefore see the complete source contract without block-tag text leaking into the surrounding prose.

Negative-path tests in `packages/core/agent/tests/gen-cordis-catalog.spec.ts` drive `collectEvents`/`collectServices` against synthetic fixtures to prove each guard fires and that the exemptions hold. The authoring rule lives in the root [AGENTS.md](../../../../AGENTS.md) conventions bullet alongside the `@mode` rule.

## Alternatives considered

- **An ESLint rule** — cannot see the scope's machine definition (which `interface Events` members and which `ctx.<key>` classes are the cordis surface); the catalog generator computes exactly that mapping on every run, so the gate lives there.
- **Expanding every method into a separate prose section** — rejected: the catalog stays skimmable by keeping one service section and one signature block, while the JSDoc attached to each declaration preserves the full method contract in place.
- **An escape-hatch tag** — none exists; the surface is small and curated (12 services, 57 methods, 27 events at adoption), and the point is that the check cannot be waved off.

## Consequences

- A new event or service method cannot land with an undocumented parameter or result: the generator refuses to regenerate and `verify-cordis-catalog` fails `doc-sync` and CI. The ~139 gaps found at adoption were filled in the same change, so the gate landed green.
- The service surface must annotate return types explicitly and use identifier parameters. Neither constraint bound at adoption (every method already annotated; no destructured seam parameters existed); both are now load-bearing requirements a violating change will discover mechanically.
- The general AGENTS.md JSDoc rule ("one-liners when one line suffices") acquires a stricter carve-out on this surface: a one-line summary still suffices only when the method has no parameters and a void result.
- `@param` on `next` or `this` stays legal but unchecked — a deliberate asymmetry: the gate enforces the payload contract and refuses to demand boilerplate.
- Each generated event or method fragment carries its original JSDoc, while the prose summary remains tag-free. Source edits therefore refresh both the readable index and the exact contract shown beside the signature.
