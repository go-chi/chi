# @deepseek-ai/dsh-lsp-stdio

English | [中文](README.zh.md)

A **generic stdio language-server backend** for `ctx.lsp`. One plugin instance accepts a named server table and registers one isolated provider per entry. It reads through `ctx.fs` and launches through `ctx.subprocess`, so the server and source always inhabit the mounted execution world. This is a generic host, not a language-server catalog or installer — deployments configure commands and mappings explicitly; presets belong in `cordis.yml` overlays.

Namespace plugin (`name` / `inject` / `Config` / `apply`, no default export).

## What it does

- Resolves every server-local setting before registration; an invalid mapping or registration conflict rolls back earlier entries, so a failed load leaves no provider routes.
- Lazily single-flights one server process per `(server id, canonical workspace target)`. A live server error is not replayed; if the selected pooled transport fails before or during a read-only query, the provider awaits its disposal and retries that query once on a fresh process.
- Uses a compatibility-first **transient-open** sequence per query: resolve and byte-bound the source while streaming it through `ctx.fs`, `textDocument/didOpen` (version 1, full text), the requested request, then `textDocument/didClose` in `finally`. A failed or canceled `didOpen` write terminates the instance before the pool can reuse it. Documents close after each call, so the first version needs no `didChange`, content cache, or document LRU.
- Serializes each source-read/open/query/close lifecycle through one abortable per-workspace queue so queued calls read current source only when their turn starts; distinct workspaces run in parallel. Provider disposal aborts filesystem and protocol work, awaits workspace lookups that have not entered a queue, then drains every queue and server.
- After protocol shutdown fails, terminates the server's descendant tree through the subprocess seam (POSIX process-group signaling; Windows `taskkill /T /F`). Tree-kill delivery is contained like every group signal — it races server exit — and quiescence is confirmed by the handle's tree-liveness wait rather than by the kill's own outcome.
- Resolves the server executable, cwd, process, and protocol streams through `ctx.subprocess`; `initialize.processId` is `null` because another machine or PID namespace must not monitor the harness process.
- Uses `ctx.fs` canonical containment, file URIs, and streamed text validation, but emits no `fs/observed`: only the LSP result is model-visible, so a query does not satisfy read-before-write policy.

## Configuration

The `servers` record key is the stable provider id reserved on `ctx.lsp`; each value has this shape:

| Server key | Default | Meaning |
|---|---|---|
| `command` | (required) | Executable to spawn — absolute, or resolved on the child PATH at load. Launch uses no shell. |
| `args` | `[]` | Arguments passed to the executable. |
| `env` | `{}` | Extra env merged on top of the credential-scrubbed ambient env (vars matching `KEY`/`PASSWORD`/`SECRET`/`TOKEN` are not forwarded); an explicit `DSH_*` entry merges after the seam's scrub of ambient ones. |
| `extensionToLanguage` | (required) | Lowercase leading-dot extension → LSP language id (e.g. `{ '.ts': 'typescript' }`). |
| `initializationOptions` | `null` | Static `initialize` options forwarded to the server. |
| `configuration` | `null` | Static answer to every `workspace/configuration` item. |
| `maxMessageBytes` | `16000000` | Largest single framed message accepted from the server. |
| `maxStderrBytes` | `1000000` | Largest stderr tail retained for diagnostics. |
| `maxDocumentBytes` | `4000000` | Largest source file this host will open. |
| `shutdownTimeoutMs` | `5000` | Graceful `shutdown`/`exit` budget before escalation. |
| `killGraceMs` | `2000` | Grace for request cancellation and for SIGTERM→SIGKILL escalation. |

`servers` must contain at least one entry, and every id must be non-empty. Timer budgets must be positive integers no greater than Node's `2_147_483_647` ms timer limit. All executables resolve at load after credential scrubbing; a bad later entry prevents every provider from registering. Processes launch lazily on the first matching query.

## Protocol behavior

Initialization advertises `general.positionEncodings: ['utf-16']`, `workspace: { workspaceFolders: true, configuration: true }`, `textDocument.hover.contentFormat: ['markdown', 'plaintext']`, and `linkSupport: true` for definition and implementation, with no dynamic registration. The server's returned capabilities are authoritative: an unsupported operation, or synchronization without transient open/close, fails the query. An omitted server `positionEncoding` defaults to `utf-16`; any other value is a protocol error. The client answers `workspace/configuration` from static config, accepts lifecycle bookkeeping requests, and rejects `workspace/applyEdit` — it never applies edits or runs commands. Navigation maps `Location` directly and `LocationLink` from `targetUri` + `targetSelectionRange`; hover normalization takes valid `MarkupContent.value`, preserves string `MarkedString`s, renders language-tagged values as fenced code, and joins arrays with one blank line. Missing results, malformed ranges or positions, and malformed hover encodings fail as structured `LSP_MALFORMED_RESPONSE` errors.

## Security boundary

The provider trusts its configured server and claims no sandbox confinement. It delegates canonical identity, containment, regular-file streaming, UTF-8 validation, and file-URI encoding to `ctx.fs`; it rejects missing, non-regular, non-UTF-8, oversized, or canonically out-of-workspace query sources before server startup. Containment is evaluated before the stream opens and does not promise stable-handle identity across concurrent path replacement. Result locations may be external, but an external path cannot become a query source. A deployment must mount filesystem and subprocess providers for the same execution world; split-world composition is invalid.

## Model Experience

Indirectly, through `dsh-tool-lsp`, which surfaces this provider's normalized results; this host contributes no prompt or schema itself.

#### KV Cache effect

No direct invalidation; `dsh-tool-lsp` owns request-prefix changes.

## Known Limitations and Deferred Work

- **No confinement policy** — this package trusts the configured server and does not sandbox its process; a restricted deployment must supply appropriate process/filesystem providers or a same-world sandbox wrapper.
- **Transient-open compatibility floor** — servers whose synchronization omits open/close (or advertise `None`) are unsupported even if closed-document queries would work; the pinned TypeScript e2e establishes one compatibility floor, not a cross-language claim.
- **Per-server/workspace serialization latency** — parallel agents sharing one server and workspace queue behind one process; long-lived workspace processes consume memory until disposal.
- **A hard-killed harness orphans language servers** — `initialize.processId: null` removes server-side client-PID monitoring, so servers are cleaned only by graceful service disposal; a SIGKILL'd harness leaves them running until they exit on their own.
