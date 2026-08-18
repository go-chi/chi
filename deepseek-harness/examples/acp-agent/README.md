# acp-agent example

English | [中文](README.zh.md)

Automation-oriented [Agent Client Protocol](https://agentclientprotocol.com) server over JSON-RPC stdio. It is intended for parent agents, subagent providers, and other programmatic clients, not as the product UI.

```sh
pnpm run demo:acp             # needs DEEPSEEK_API_KEY (repo-root .env or env)
pnpm run demo:code-mode       # same protocol with the Code Mode tool transport
```

The leaf loads the ACP app, DeepSeek adapter, sandboxed bash and filesystem stacks, one-shot approval policy, compaction, subagents, workflows, hooks, a derived session-query index, and repeat guard. The app creates one fresh agent per `session/new`, persists sessions to JSONL, and keeps stdout protocol-pure. Optional overlays add session queries, filesystem spill storage, Code Mode, or web fetching.

## Protocol channel

Stdout carries only newline-delimited ACP JSON-RPC. `@deepseek-ai/dsh-acp-demo` installs no stdout logger; leaf additions must use stderr for diagnostics.

The automation contract — supported methods, baseline prompt content, committed-text output, and the intentionally absent UI surfaces — lives in [`@deepseek-ai/dsh-acp`](../../packages/acp/acp/README.md).

## Session workspaces and permissions

Each `session/new` supplies an absolute `cwd`. Sandboxed bash and filesystem mutations resolve `workspace-write` against that session cwd, so concurrent sessions can use separate project roots; platform temporary roots remain shared writable scratch space ([sandbox contract](../../packages/sandbox/sandbox/README.md)). `DSH_PERMISSION_MODE` selects `workspace-write` or `danger-full-access` for the deployment.

Under `workspace-write`, a model retry requesting wider sandbox access triggers `session/request_permission` with `allow_once` and `reject_once`. The client decides programmatically; dismissal or an unavailable answer fails closed. The selected outcome applies only to that retry and is recorded through the normal tool-result/audit path. The server never exposes a permission picker or persists client policy.
