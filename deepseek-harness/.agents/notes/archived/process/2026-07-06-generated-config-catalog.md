# Agent Note: Generated plugin config catalog

Status: implemented
Archived: 2026-07-27

English | [中文](2026-07-06-generated-config-catalog.zh.md)

## Problem

The repository had no source-backed reference for plugin configuration. Package READMEs documented fields inconsistently, did not enumerate which packages are loadable, and did not verify that runtime schemas agree with declared config types.

## Decision

`scripts/gen-config-catalog.ts` emits [docs/config-catalog.md](../../../../docs/config-catalog.md) from each plugin's declared config type and JSDoc, with injection requirements, referenced-type links, and a source pointer. Package-local types are included transitively; workspace and external types are linked or named. Deterministic `--write` and `--check` modes make the committed page a generated artifact.

Pure AST generation is correct here for the same reason it is for the events/services catalog and NOT for the tool catalog: a config type is a static declaration and every schemastery schema in the repo is a static `z.object`/`z.intersect` literal, so the source is the whole truth — nothing about the config surface is runtime-composed.

Specific choices:

- **The config type is the second-parameter type.** What the catalog documents is the declared type of `apply(ctx, config)` / the service constructor's `(ctx, config)` — the value cordis actually passes — not a `Config` export located by naming convention. This is what makes the walk total: it works for interfaces named `AcpConfig` or `BasicCompactConfig`, for types declared in a sibling file, and for plugins with no validating schema at all.
- **Classification is total.** Every `packages/<group>/<pkg>` entry resolves, mirroring the Loader's `unwrapExports` (`exports.default ?? exports`), to a configurable plugin, a config-free plugin, an abstract seam class, or a library — each rendered in its own section — and an unclassifiable entry hard-errors. A new package cannot be silently undocumented.
- **Per-field JSDoc is enforced.** Every property of a pasted declaration (nested type literals included) needs non-empty JSDoc prose, or generation fails. The paste IS the documentation, so this is the same forcing function the events catalog applies via `@mode`: thin source docs fail the gate rather than yielding a thin catalog.
- **Schema keys are checked against the declared type.** The generator resolves nested object and array paths through local and workspace types. Definite missing paths fail; external or dynamic shapes that cannot be enumerated are skipped. The check is intentionally one-way because declared types may contain runtime-only fields excluded from loader config.
- **A dedicated fence.** Pasted declarations use a ` ```ts config-catalog ` info string that `doc-typecheck` skips (a lone declaration referencing imported types is not standalone-compilable), excluded from the opt-out ratio — the same treatment the `cordis-catalog` and `persistence-catalog` fences get.
- **A single file at `docs/config-catalog.md`**, not a one-file directory: the page serves one audience (the `cordis.yml` author) with one axis, unlike `cordis-catalog/`, which holds two sibling pages.

The package README `## Config` sections stay. The overlap is accepted deliberately: the README is the curated per-package contract (config semantics in deployment context, alongside limitations and extension points), the catalog is the exhaustive generated enumeration. Because the catalog is generated, a disagreement between the two indicts the README, and the fix is a README edit — the catalog cannot drift.

## Alternatives considered

- **Synthesized per-field rendering** — a bullet list, table, or annotated-YAML snippet per field, assembled from parsed JSDoc plus schema metadata. Rejected for the verbatim paste: the interface with its JSDoc is already the authored contract in its authored form, and a synthesizing renderer re-formats prose it does not own, adding a rendering layer that can misrepresent it.
- **Runtime boot + schema introspection, as the tool catalog does** — rejected: nothing here is runtime-composed, and the schema alone under-documents the surface (prose-documented defaults, runtime-only fields, plugins with no schema at all). Booting would add fragility without adding truth.
- **Two-directional schema/interface equality** — rejected for the subset check: the declared type legitimately carries members the schema refuses to accept from config (runtime-only seams).
- **Retiring the README `## Config` sections in the same change** — rejected: the accepted duplication keeps the per-package contract readable in place, and a sweep would have to fold each README's extra facts into field JSDoc first — separable work the catalog does not depend on.

## Consequences

- The catalog cannot drift: a source change the committed file does not reflect fails `verify-config-catalog` in `doc-sync` and CI. An undocumented config field, an unresolvable referenced type name, or a schema key missing from the config type fails the generator outright.
- Config prose now has a forcing function at the declaration: writing a new config field means writing its JSDoc, which becomes the catalog entry verbatim.
- The generator hard-errors on shapes it cannot walk statically — an aliased package-local config import, a schema built by anything other than `object`/`intersect` composition, an unlisted global type name. Introducing such a shape includes teaching the generator (or the shape stays out of the repo), which is the point: the catalog stays the whole truth.
- `gen-cordis-catalog.ts` exports its JSDoc/pointer helpers and `LINK_MAP` for reuse, so the two catalogs cross-link types identically and a link-map addition serves both.
