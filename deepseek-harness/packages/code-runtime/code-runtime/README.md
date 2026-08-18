# @deepseek-ai/dsh-code-runtime

English | [中文](README.zh.md)

The **`CodeRuntime`** (`ctx.codeRuntime`) defines WHAT a code runtime does — run one model-written program against a set of host-provided async bindings and report `{ value, logs, error? }` — without saying HOW.

This package owns the Service Definition role of the capability (the bash trio is the template — see [capability seams](../../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)): providers subclass `CodeRuntime` and register the service; the Consumer is the tool registry's Code Mode, which generates the model-facing SDK and bridges tool dispatch — both specified in the [Code Mode Agent Note](../../../.agents/notes/implemented/feature/2026-06-15-code-mode.md), whose first provider is a Node worker-thread backend. The runtime knows nothing about tools or sessions: it is handed named async functions and a program string, and everything tool-shaped stays with the Consumer.

## Service API (`ctx.codeRuntime`)

| Member | Semantics |
|---|---|
| `run(request)` | Execute one program against the request's bindings. **Resolves with an error FIELD for every program outcome** — parse/transform failure, thrown exception, invalid completion, output overflow, budget expiry, abort, or substrate death (`CodeRunFailure`'s orthogonal `kind` taxonomy); it rejects only for caller misuse of the Service Definition contract (e.g. a run submitted after disposal). The program runs as the body of an async function: top-level `await`/`return` work, and a lossless JSON completion becomes `result.value`. |
| `language` | Readonly descriptor: the source language `run` expects. `'typescript'` and `'python'` are the well-known values — those `dsh-tools` presents; only `'typescript'` has a published backend. Informational, not gating — a consumer that generates language-specific presentation switches on it and fails loud on a language it cannot present. |
| `isolation` | Readonly descriptor: the execution substrate (`'worker-thread'`, `'process'`, `'container'`). A label for deployments and diagnostics, **not a security claim**. |

Semantics every implementation must honor (contract details in the class JSDoc): binding calls bridge complete lossless-JSON arguments and resolutions with no seam-level byte cap; the program is treated as a hostile peer (arbitrary binding names are own properties, malformed traffic never crashes the host); no state survives between runs; disposal terminates in-flight runs AND awaits their exit before completing.

## Vocabulary

`CodeRunRequest` (`program`, `bindings`, `signal?`) carries everything the runtime acts on — defaulting (time budgets and outer-output cap) is the provider's validated config, never a hidden `??` inside `run()`. `bindings` is a list of `CodeBindingNamespace`s (`global` + `functions` + optional `errorClass`), each exposed to the program as one global object of async callables returning `CodeJsonValue`, the service-local structural equivalent of canonical `JsonValue` that keeps this Service Definition package independent of sessions. An `errorClass` descriptor names a real program-global constructor and the own property that receives the rejected member name; runtimes remain independent of Consumer terms such as `ToolCallError`. `CodeRunResult` reports the lossless JSON completion `value?`, ordered `logs: string[]`, and the `error?` (`CodeRunFailure`: `kind` + model-feedable `message`). See `src/types.ts` for the full contracts.

Binding-global and error-class names are **language-portable**: they must match the identifier subset `[A-Za-z_][A-Za-z0-9_]*` (no JS-only `$`) and clear the seam-exported exclusion sets, so one `bindings` list is valid against every backend regardless of its `language`. The package exports the contract every backend enforces — `PORTABLE_RESERVED_WORDS` (ECMAScript ∪ Python reserved words), `RESERVED_BINDING_GLOBALS` (backend-owned globals such as `console`), `RESERVED_ERROR_MEMBERS` and `DUNDER_MEMBER` (error-member exclusions) — so a name like `$tools`, `lambda`, or `__dsh_main__` makes `run()` reject as seam misuse on any backend, not just some. See `src/index.ts` for the exact sets and rationale.

## Model Experience

Indirectly, through Code Mode in `dsh-tools`, which exposes `run_code` and returns program logs, values, or failures as retained tool-result tokens.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **`run()` is one-shot** — `logs` arrive only on the resolved `CodeRunResult`; the seam exposes no streaming-log or progress API for a live program's output.
- **A persistent REPL-style kernel is recorded future work** — the no-state-between-runs contract stands until a persistent-kernel backend brings its own logging story ([Code Mode Agent Note](../../../.agents/notes/implemented/feature/2026-06-15-code-mode.md)).
- **Only the worker-thread backend ships** — `'process'`/`'container'` are declared well-known `isolation` values with no implementation; a hard security boundary awaits a container backend.
- **Intermediate binding values have no byte cap** — implementations remain subject to structured-clone cost and process memory, while a provider or executor may already have imposed its own acquisition bound.
