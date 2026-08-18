# lsp/ - LSP capability family

English | [中文](README.zh.md)

The language-server capability seam: an LSP Service Definition, a generic stdio provider, and the model-facing `lsp` tool. All **product** packages.

| Package | Role | ctx key |
|---|---|---|
| `lsp/` | Service Definition (provider registry by branded id + extension mapping, per-query selection, vocabulary, `LspError`) | `ctx.lsp` |
| `lsp-stdio/` | Generic multi-server stdio backend over `ctx.fs` and `ctx.subprocess` (JSON-RPC, transient-open queries) | (registers providers on `ctx.lsp`) |
| `tool-lsp/` | Model-facing `lsp` tool (four operations, one-based UTF-16 cursor coordinates) | (registers on `ctx.tools`) |

The Service Definition lives at `lsp/lsp/`. The seam exposes exactly four semantic operations — `goToDefinition`, `findReferences`, `goToImplementation`, `hover` — and no generic JSON-RPC escape hatch, so a provider swap does not change how the model asks for navigation and no protocol payload or unreviewed mutation reaches the model contract. Providers register **capabilities**, not tools; `tool-lsp` is the only owner of the model-facing name, schema, prompt guidance, and presentation.

See the [LSP capability seam Agent Note](../../.agents/notes/implemented/architecture/2026-07-15-lsp-capability-seam.md) for the design rationale, including why documents open transiently per query, why the stdio host consumes the shared filesystem/subprocess execution world, and why extension ownership is exclusive within one runtime.

The subsystem reference — operations, coordinates, requests/results, `LspError` — is [docs/subsystems/lsp.md](../../docs/subsystems/lsp.md); design rationale in the [LSP capability seam Agent Note](../../.agents/notes/implemented/architecture/2026-07-15-lsp-capability-seam.md).
