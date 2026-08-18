# Agent Note: Reorganize packages into a modular hierarchy

Status: implemented
Archived: 2026-07-27

English | [中文](2026-06-20-package-hierarchy.zh.md)

The [redundant-agent removal](../simplification/2026-07-20-remove-stdio-and-echo-agents.md) deletes the original `support/ui-stdio` surface instead of relocating it, and the [automation-only ACP decision](../simplification/2026-07-23-acp-automation-only-protocol.md) places ACP under `packages/acp/acp` instead of the human-UI group. The uniform depth-two hierarchy remains the decision owned here.

## Problem

`packages/` was flat: 18 packages all sat at `packages/<name>/`, so a package's location said nothing about whether it was core product API, a swappable capability seam, a provider adapter, a product integration, or example/test support. The package README carried a `FIXME(package-hierarchy)` and `scripts/publint-all.ts` a `TODO(package-inventory)` flagging exactly this. Core packages, provider integrations, capability seams, example UI support, and snapshot-only replay support all looked equally foundational.

This was not just cosmetic. Because every top-level package looked like part of the same public surface, future removal was harder, and publish/lint/doc scripts had to encode intent through comments or hand-maintained static lists rather than reading it off the layout.

## Decision

Packages are grouped by modular role at a uniform `packages/<group>/<pkg>/` depth. Group directories are pure containers (no `package.json`); every package keeps its `@deepseek-ai/dsh-<pkg>` name — this is repo structure and maintenance policy, not package renaming.

```text
packages/
  core/                  (product API spine)
    session/
    system-prompt/
    tools/
    agent/
    agent-loop/
  llm/                   (product — capability family)
    llm/
    llm-deepseek/
    llm-pi-ai/
  bash/                  (product — capability family)
    bash/
    bash-local/
    tool-bash/
  session-persistence/   (product — capability family)
    session-persistence/
    session-persistence-jsonl/
    session-persistence-sqlite/
  acp/                   (product automation integration)
    acp/
  ui/                    (human interaction and presentation)
  support/               (dev/test/example infrastructure)
    invariants/
    ui-stdio/
    llm-replay/
```

### Placement decisions

- **Same-name nesting for capability families.** A family's interface package sits at `packages/<group>/<group>/` (`llm/llm`, `bash/bash`, `session-persistence/session-persistence`), with implementations and consumers as flat siblings. There is no extra `adapters/`/`impls/` sub-tier — every package is exactly depth 2, which keeps the workspace glob a clean `packages/*/*` and lets one `@deepseek-ai/dsh-*` tsconfig wildcard resolve every package (unique dir names make first-on-disk-wins unambiguous).
- **`session` stays in `core/`; persistence is its own family.** The session log is core product API. Its storage backends form a parallel capability family (`session-persistence/`) mirroring `llm/` and `bash/`, rather than nesting under `core/session/`.
- **`agent-loop` is in `core/`.** It is the one concrete implementation of the `agent` seam, but it ships as the harness's default product loop, so it lives with the core spine. Plugins still depend on the `agent` vocabulary, never on `agent-loop`, so the loop stays swappable.
- **Product automation and human UI are separate groups.** `acp` is a product transport under `acp/`, while commands, approvals, interaction, and presentation adapters live under `ui/`. Dev-only invariants and replay infrastructure remain under `support/`.

### Deduplicating the package lists

The package list had been enumerated in five places. The uniform depth-2 layout lets most of them be derived instead:

- `tsconfig.base.json` maps every package through a single `@deepseek-ai/dsh-*` `paths` wildcard listing one candidate per group, in place of per-package entries. The aggregate configs (`tsconfig.host.json`, `tsconfig.client.json`) reuse that source map and carry the explicit project references that keep package/vendor typecheck boundaries intact. (One subtlety this introduced: a path candidate contains `/*/`, which a naive regex comment-stripper mistakes for a block comment — `scripts/doc-typecheck.ts` reads the JSONC config through TypeScript's parser rather than stripping comments by hand for exactly this reason.)
- `scripts/publint-all.ts` derives its list by reading the hierarchy (`packages/<group>/<pkg>`), resolving the `TODO(package-inventory)`.
- The aggregates' project `references` stay explicit lists — TypeScript project references have no wildcard form. Generating these from a manifest is left to a follow-up (see [discover package inventories](../../proposed/process/2026-06-20-discover-package-inventory.md)).

### Guardrails added

Two doc-sync/hygiene gates keep the structure and its references honest, so the manual checks this restructure required do not have to be repeated by hand:

- `scripts/verify-package-paths.ts` flags a `packages/<path>` reference (in Markdown or a `.ts` comment/string) that does not resolve **and** names a real package in a segment — i.e. a stale path to a moved package. A path naming a package that exists nowhere (a forward-looking proposal) is left alone, so the gate applies uniformly across proposed/implemented/rejected.
- `scripts/check-workspace-constraints.ts` asserts the `packages/<group>/<pkg>` shape: group dirs carry no `package.json`, and no package sits flat at the root or nests deeper. Group names stay open — a new group may be added without editing the gate; only the depth-2 shape is fixed.

## Alternatives considered

- **A third tier (`adapters/` / `impls/` under each family)** — rejected: uniform depth 2 keeps the workspace glob a clean `packages/*/*` and lets one `@deepseek-ai/dsh-*` tsconfig wildcard resolve every package.
- **Nesting persistence under `core/session/`** — rejected: the storage backends form a parallel capability family mirroring `llm/` and `bash/`, while the session log itself stays core product API.
- **`ui-stdio` under `ui/`** — rejected: it was example-coupled dev support, not a product surface.

## Consequences

The restructure churned imports, workspace globs, doc links, build references, and package paths in one coordinated move. That churn is acceptable pre-release (per the AGENTS.md foundation-over-blast-radius stance) because it stops the flat layout from fossilizing support packages as product contracts, and it is a one-time cost: the wildcard `paths`, the glob-derived publint list, and the shape gate mean a new package needs no further structural edits.
