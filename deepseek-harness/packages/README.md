# Packages

English | [中文](README.zh.md)

npm scope: `@deepseek-ai/dsh-*`; Cordis `Service` subclasses and function plugins contribute through `ctx.effect()`, `ctx.on()`, or `ctx.waterfall()`. Rules: [package](AGENTS.md), [root](../AGENTS.md#conventions).

## Hierarchy

Groups hold `packages/<group>/<pkg>/`; names stay `@deepseek-ai/dsh-<pkg>`. **Group READMEs own package/ctx-key maps.**

| Group | Role | Release expectation |
|---|---|---|
| [`core/`](core/README.md) | Product API spine: sessions, prompts, tools, agent services, and the concrete loop | Product — stable API |
| [`api/`](api/README.md) | Remote BFF assembly and Typert RPC gateway | Product — stable API |
| [`typert/`](typert/README.md) | Type graph generation, artifact loading, and runtime registry | Product — stable API |
| [`goal/`](goal/README.md) | Same-session goal persistence and lifecycle | Product — stable API |
| [`schedule/`](schedule/README.md) | Session-local scheduled follow-ups | Product — stable API |
| [`feedback/`](feedback/README.md) | Human feedback | Product — stable API |
| [`identity/`](identity/README.md) | Shared anonymous identity | Product — stable API |
| [`llm/`](llm/README.md) | LLM capability family: the abstract service + provider adapters | Product — stable API |
| [`e2b/`](e2b/README.md) | E2B providers | POC |
| [`subprocess/`](subprocess/README.md) | Subprocess capability family: Service Definition + local process-tree provider | Product — stable API |
| [`shell/`](shell/README.md) | Bash capability family: executor seam, local impl, model-facing tool | Product — stable API |
| [`terminal/`](terminal/README.md) | Persistent PTY capability family: owner-scoped sessions, local implementation, and model-facing tools | Product — stable API |
| [`code-runtime/`](code-runtime/README.md) | Code-execution capability family: Service Definition + worker-thread provider + Code Mode Consumer | Product — stable API |
| [`sandbox/`](sandbox/README.md) | Process-confinement seam; bwrap/Landlock/Seatbelt backends | Product — stable API |
| [`fs/`](fs/README.md) | Filesystem capability family: seam, local impl, model-facing file tools, bash-backed discovery tools | Product — stable API |
| [`lsp/`](lsp/README.md) | LSP capability family: seam, generic stdio provider, and the `lsp` tool | Product — stable API |
| [`skill/`](skill/README.md) | Skill capability family: the provider registry, local provider, and model-facing catalog/loader | Product — stable API |
| [`compaction/`](compaction/README.md) | Compaction capability family: Service Definition + basic provider + command Consumer | Product — stable API |
| [`context/`](context/README.md) | Model-visible request context, including workspace instructions and time context | Product — stable API |
| [`subagent/`](subagent/README.md) | Subagent capability family: the provider-registry contract and the model-facing delegation tool | Product — stable API |
| [`jobs/`](jobs/README.md) | Generic background-job runtime and model-facing `job_*` control tools | Product — stable API |
| [`workflow/`](workflow/README.md) | Workflow seam, worker-thread engine, and model-facing `workflow`/`ralph` tools | Product — stable API |
| [`web/`](web/README.md) | Web capability family: seam, search/fetch provider impls, and the model-facing web tools | Product — stable API |
| [`attachment/`](attachment/README.md) | Durable attachment identity, validation, local content-addressed storage | Product — stable API |
| [`spill/`](spill/README.md) | Spill capability family: storage seam, local impl, tool-result spill policy | Product — stable API |
| [`todo/`](todo/README.md) | The model-facing `todo_write` tool | Product — stable API |
| [`plan/`](plan/README.md) | Plan collaboration state with a direct entry command and reviewed exit | Product — stable API |
| [`preset/`](preset/README.md) | Per-session agent composition from preset `cordis.yml` files | Product — stable API |
| [`guard/`](guard/README.md) | Loop-hygiene guards: advisory repeat-call reminders + the `tools/execute` deadline enforcer | Product — stable API |
| [`bundle/`](bundle/README.md) | Installable `dsh --profile` patch layers | Product — stable API |
| [`extensions/`](extensions/README.md) | Agent runtime self-modification: live plugin/service inspection and model-written plugin mount/unmount ([design](../.agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md)) | Product — stable API |
| [`hooks/`](hooks/README.md) | Hook bridges + the shared Claude Code / Codex wire-protocol library | Product — stable API |
| [`session/`](session/README.md) | Durable session data plane: persistence seam + JSONL/SQLite backends, projection seam, log-backed titles, session reporting | Product — stable API |
| [`session-query/`](session-query/README.md) | Session retrieval family: logical corpus, bounded reads, lineage, event relationships, semantic filtering, and SQLite full-text search | Product — stable API |
| [`settings/`](settings/README.md) | User-settings seam + file-backed provider | Product — stable API |
| [`credentials/`](credentials/README.md) | Credential-reference seam + env-over-`.env` provider | Product — stable API |
| [`storage/`](storage/README.md) | Non-session storage hub + backends + domain form | Product — stable API |
| [`workspace/`](workspace/README.md) | Workspace entity | Product — stable API |
| [`sdk/`](sdk/README.md) | Out-of-process runtime SDK: JSON-RPC protocol, TypeScript client, and server plugin | Product — stable API |
| [`acp/`](acp/README.md) | Automation-only Agent Client Protocol server | Product — stable API |
| [`interaction/`](interaction/README.md) | Human-collaboration plane: approval/interaction seams, permission preset, commands, ask-user tool | Product — stable API |
| [`boot/`](boot/README.md) | Shared app-bin boot glue | Product — stable API |
| [`host/`](host/README.md) | Web-GUI host half: API gateway + HTTP route server | Product — stable API |
| [`client/`](client/README.md) | Web-GUI browser half: shell, wire, object services, slots, `ui-*` plugins | Product — stable API |
| [`examples/`](examples/README.md) | Demo bundles (agent-spine + CLI/ACP/JSON-RPC bins) leaves load | Support — example infra |
| [`test-support/`](test-support/README.md) | Support infrastructure (testkits, invariants, replay, Loader smokes) | Support — lower compatibility expectations |
| [`util/`](util/README.md) | Low-level zero-dependency utilities shared across groups (`Branded<B>`, Harness home/path helpers, timeout, retention) | Support — small, stable, harness-dep-free |

New packages join existing groups; new groups update their README and this table.

## Dependencies

The dependency graph is generated: [docs/module-graph.md](../docs/module-graph.md) (`pnpm run gen-module-graph`, freshness-gated in CI).

**Extension plugins depend on Service Definitions, never concrete providers.** `dsh-agent-loop` is swappable; UI, hook, and tool plugins use `dsh-agent`. Composition bundles, including `dsh-agent-spine-demo`, may depend on spine plugins. Capabilities separate Service Definition / Service Provider / Consumer roles when they evolve independently; see [capability seams](../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md).

Package READMEs cover purpose, APIs, extension points, and [Model Experience](../docs/cookbook/adding-a-package.md#4-write-the-package-readme) unless on the model-agnostic [omission allowlist](../scripts/verify-package-readme-model-experience.ts). They also carry `## Known Limitations and Deferred Work` or use its [allowlist](../scripts/verify-package-readme-limitations.ts).
