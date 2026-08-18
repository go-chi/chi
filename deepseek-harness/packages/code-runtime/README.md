# code-runtime/ — code-execution capability family

English | [中文](README.zh.md)

The code-execution capability seam (see [capability seams](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)): a runtime Service Definition for executing one model-written program against host-provided async bindings, capturing what it printed and returned; replaceable providers; and the tool registry's [Code Mode](../core/tools/README.md) Consumer (`tools: { mode: code }` — the `run_code` tool and the SDK generated in the loaded runtime's `language`). Design is in the [Code Mode Agent Note](../../.agents/notes/implemented/feature/2026-06-15-code-mode.md). **Product** packages.

| Package | Role | ctx key |
|---|---|---|
| [`code-runtime/`](code-runtime/README.md) | Service Definition and shared vocabulary | `ctx.codeRuntime` |
| [`code-runtime-worker/`](code-runtime-worker-thread/README.md) | Worker-thread backend | registers `ctx.codeRuntime` |

Providers register the service without changing its Consumer. The child READMEs own language, isolation, and execution-budget details.

The subsystem reference — run requests/results, binding namespaces, the failure taxonomy — is [docs/subsystems/code-runtime.md](../../docs/subsystems/code-runtime.md).
