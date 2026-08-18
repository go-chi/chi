# @deepseek-ai/dsh-lsp

English | [中文](README.zh.md)

The **LSP capability seam**: an abstract `LspService` (`ctx.lsp`) defining WHAT semantic code navigation the harness has — go to definition, find references, find implementations, hover — over language-server providers, without binding the model contract to local subprocesses.

This package owns the Service Definition role of the LSP capability:

| Package | Role |
|---|---|
| `@deepseek-ai/dsh-lsp` (this) | Service Definition: the service, provider registry keyed by branded id + extension mapping, per-query selection, request/result vocabulary, the `LspError` taxonomy |
| `@deepseek-ai/dsh-lsp-stdio` | Service Provider: a generic local backend that registers configured stdio language-server providers |
| `@deepseek-ai/dsh-tool-lsp` | Consumer: the model-facing `lsp` tool over `ctx.lsp` |

The seam exposes exactly four semantic operations — `goToDefinition`, `findReferences`, `goToImplementation`, `hover` — and no generic JSON-RPC escape hatch, so no protocol payload or unreviewed command/mutation reaches a provider through `ctx.lsp`.

## Service API (`ctx.lsp`)

| Member | Semantics |
|---|---|
| `registerProvider(provider)` | Register a backend, atomically reserving its branded `id` and every normalized file extension. Any invalid input or conflict publishes nothing and throws `LspError` (`LSP_INVALID_PROVIDER` / `LSP_CONFLICT`). Returns a disposer releasing all reservations. Disposed with the calling fiber. |
| `query(request, signal?)` | Select the provider by the file's final extension, derive the `languageId` from that provider's mapping, and run one query. No match throws `LspError` `LSP_UNAVAILABLE`. |

Selection is per query and order-independent: a provider owns a set of extensions exclusively, so registration and HMR order never change routing. Extension keys normalize to lowercase, leading-dot form; the `languageId` only synchronizes the transient document, never participates in selection. The first version has no glob, language-id, or explicit route selector.

Providers register **capabilities**, not tools. `dsh-tool-lsp` is the only owner of the model-facing name, description, prompt guidance, schema, and presentation.

## Vocabulary

`LspQueryRequest` (`operation`, `filePath`, `position`, `workspaceRoot`) — every field required, so no field needs implementation defaulting and there is no `resolve()` step. Positions and ranges are zero-based UTF-16, matching the protocol; the tool owns the one-based cursor convention. `findReferences` always includes declarations — providers enforce this internally, so callers get no flag. `LspQueryResult` is a CLOSED discriminated union: `{ kind: 'locations'; locations; resolvedWorkspaceUri }` for navigation, `{ kind: 'hover'; hover }` for hover (content or `null`) — consumers `switch` to exhaustiveness so a new arm breaks compilation until handled. `resolvedWorkspaceUri` is the provider's canonical workspace `file:` URI; callers relativize location URIs against it instead of applying host-platform path rules to the possibly symlinked request root. See `src/types.ts` for the full contracts and `src/index.ts` for the `LspError` codes, including `LSP_DISPOSED` and `LSP_MALFORMED_RESPONSE`.

## Model Experience

Indirectly, through `dsh-tool-lsp`, which owns the model-facing `lsp` schema, prompt, and rendered results while this registry contributes no prompt or schema itself.

#### KV Cache effect

No direct invalidation; `dsh-tool-lsp` owns request-prefix changes.

## Known Limitations and Deferred Work

- **Exclusive extension ownership within one runtime** — two providers cannot both claim `.ts`, even with different language ids; overlaps fail registration. The intended extension is a deployment-configured selector above registrations, which can relax exclusive reservation without adding provider choice to model input ([seam Agent Note](../../../.agents/notes/implemented/architecture/2026-07-15-lsp-capability-seam.md)).
- **Four operations only** — symbols and call hierarchy are deferred (they need different schemas); diagnostics need separate freshness/accumulation rules; mutations (rename, code actions, formatting) require separate tools with preview, permission, and write-policy integration.
- **No observation API** — availability is observed only by running `query()` and routing the thrown `LspError` codes; there is no provider-change event or capability-status query.
