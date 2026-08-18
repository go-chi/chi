# @deepseek-ai/dsh-acp-demo

English | [中文](README.zh.md)

ACP automation server app: the default agent spine, client-created agents through [`@deepseek-ai/dsh-acp`](../../acp/acp/README.md), JSONL persistence, and semantic checkpointing behind one JSON-RPC stdio bin. Programmatic clients create fresh sessions; this package mounts no human UI.

## Composition

| Plugin | Role |
|---|---|
| `@deepseek-ai/dsh-agent-spine-demo` | Providerless agent spine with no pre-created agents; `session/new` creates each agent. |
| `@deepseek-ai/dsh-session-persistence-jsonl` | Durable session logs used by checkpointing, observability, and snapshot replay. |
| `@deepseek-ai/dsh-session-checkpoint-policy` | Durability barriers before model calls and top-level tool effects, plus completed-step checkpoints. |
| `@deepseek-ai/dsh-session-query-sqlite` | Derived exact/FTS session-query service, opened before the ACP transport so leaf consumers are ready for the first model request. |
| `@deepseek-ai/dsh-acp` | Automation-only ACP transport over stdin/stdout. |

The app does not install commands, user interaction, session navigation, configuration pickers, or a stdout logger. It owns these plugins through one ordered effect so the query service is ready before ACP accepts work and ACP sessions quiesce before checkpointing and persistence detach. Leaf configurations supply LLM, executor, sandbox, approval, filesystem, and model-facing tool plugins.

## Config

| Key | Default | Routed to |
|---|---|---|
| `provider` | required | Provider route for each ACP-created agent. |
| `model` | required | Model for each ACP-created agent. |
| `maxParallelToolCalls` | agent-loop default | Positive-integer tool-call concurrency cap; `1` is serial. |
| `persona` | — | Deployment persona template for `dsh-system-prompt`. |
| `toolOrder` | lexicographic | Explicit model-facing tool order for `dsh-system-prompt`. |
| `tools` | `{ mode: 'native' }` | Native, Code Mode, or combined model tool transport. |
| `dshHome` | `$DSH_HOME` or `~/.dsh` | Harness home shared by bash and local skill discovery. |
| `sessionTitle` | spine example limits | Durable fallback-title limits; titles remain off the ACP wire. |
| `persistenceRoot` | `./.sessions` | JSONL backend root and parent directory of the derived `session-query.db` index. |
| `packChunks` | `true` | Pack consecutive delta-chunk events in storage. |
| `persistenceCompression` | `zstd` | Checksummed Zstandard frames or raw `none`. |
| `workspaceContext` | required | Workspace-instruction byte budget/config, or `false`. |
| `skills` | owner defaults | Skill registry, local provider, and model-facing skill tool. |
| `toolBash` | owner defaults | Model-facing bash tool config. |
| `jobs` | `{ maxConcurrentJobsPerOwner: 10 }` | Process-local per-owner active-task admission. |
| `toolJobs` | owner defaults | Generic background-job control config, or `false`. |
| `goals` | owner defaults | Persisted same-session goal domain and model tools, or `false`. |

The shipped [`examples/acp-agent/cordis.yml`](../../../examples/acp-agent/cordis.yml) adds the DeepSeek adapter, sandboxed bash and filesystem providers, one-shot approval policy, compaction, subagents, workflows, hooks, and model-facing tools. The app supplies the derived session-query index, while the model-facing query consumer remains an explicit leaf opt-in. Snapshot overlays replace only nondeterministic providers or policy values.

## Bin

`dsh-acp-demo [--config path-to-cordis.yml]` (short form `-c`; default `./cordis.yml`) loads the gitignored `.env`, except in replay mode; `DSH_SNAPSHOT=replay` selects the sibling `cordis.snapshot.yml`; stdin EOF disposes the context and flushes sessions before exit. Loader's installed optional `node-addon-require-builtin` peer resolves bare plugin specifiers for the built bin under plain Node. Diagnostics use stderr because stdout is the ACP wire.

## Model Experience

Indirectly, through `dsh-agent-spine-demo` and the leaf's model-facing plugins. ACP prompt text becomes the ordinary logged user message; protocol metadata and permission choices do not enter the model request.

#### KV Cache effect

Append-only per session; the app adds no request-prefix content itself.

## Known Limitations and Deferred Work

- **JSONL persistence is fixed** — a different backend requires another composition.
- **Sibling plugins can corrupt stdout** — the app cannot prevent another entry from writing non-protocol bytes.
- **Fresh automation sessions only** — resume and human interaction belong to other entry points.
