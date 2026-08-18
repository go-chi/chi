# Agent Note: Generate the Cordis core API reference

Status: implemented
Archived: 2026-07-27

English | [中文](2026-07-20-generated-cordis-core-api.zh.md)

## Problem

Plugin authors need the detailed Cordis APIs behind `ctx`, event dispatch, fibers, plugin registration, and services. The generated [Harness event and service catalogs](2026-06-20-generated-cordis-catalog.md) intentionally summarize inherited Cordis members, so they do not replace a method-level Cordis reference. Keeping a second hand-written copy under the website would drift from the vendored source and make the renderer an additional documentation owner.

## Decision

`scripts/cordis-core-api.ts` reads the public declarations and original JSDoc from `vendor/cordis/src` with the TypeScript compiler API. An explicit page manifest generates five files under [`docs/cordis-catalog/core/`](../../../../docs/cordis-catalog/core/context.md): Context, Events, Fiber, Registry, and Service. `scripts/gen-cordis-catalog.ts` writes these pages together with the Harness event and service catalogs, and `verify-cordis-catalog` rejects stale output.

The generator validates that documented classes and methods retain descriptive JSDoc, including parameter and non-void return contracts. It emits declaration-only `ts cordis-catalog` fences with the original JSDoc, then renders the same description, parameters, and return contract as readable Markdown. Source links point to the vendored files, and the five pages cross-link to one another. The Harness catalogs remain the exhaustive inventory of repository-declared events and `ctx.*` services; the core pages document how the inherited Cordis APIs operate.

`website/docs.ts` publishes the five canonical files under matching `/reference/cordis-api/` and `/en/reference/cordis-api/` routes. Both locales use the English generated source until the generator emits translated pages, so changing language preserves navigation structure and route identity.

## Alternatives considered

**Restore the old website files as canonical Markdown.** This would recover the pages quickly, but their signatures and prose could drift from the vendored implementation and the website would regain a second documentation source.

**Expand the inherited tier of the Harness catalogs in place.** Those catalogs answer which Harness events and services exist. Mixing full framework class references into the same pages would obscure that inventory and reverse their deliberate terse inherited tier.

**Publish vendored source declarations directly.** Source files are authoritative but do not provide stable topic pages, curated public ordering, or website navigation, and they expose implementation bodies that are not part of the reference contract.

## Consequences

The five Cordis API pages follow vendor updates through one deterministic generator and share the repository's documentation freshness gate. The website gains a dedicated Cordis API section without copied site content, while root and English navigation remain structurally identical.

The page manifest is curated, so a newly public Cordis core type needs an explicit generator entry. Generated prose is English-only, and source JSDoc quality directly limits reference quality; Chinese output requires generator-level translation rather than hand-editing the generated files.
