# Agent Note: Ship the TUI without `todo_write`; keep it a one-line opt-in

Status: implemented
Archived: 2026-07-26

[English](2026-07-21-tui-todo-write-opt-in.md) | 中文

## Problem

出厂的 tui-agent `cordis.yml` 加载了 `@deepseek-ai/dsh-tool-todo`，默认向模型暴露 `todo_write`。这个工具是一项任务追踪的便利功能，而非像 `bash` 或 `read`/`write`/`edit` 文件系统工具那样的核心编码能力；多数 TUI 会话从不调用它，但出厂加载它会让每一轮的协议工具列表和系统提示词都随之变大。而 TUI 的计划渲染是事件驱动的：`packages/ui/tui/src/index.ts` 监听 `todo/write` 会话事件，`TodoComponent.render` 在列表为空时不返回任何内容，因此这个入口本就能容忍该工具的缺席或存在，与该插件没有任何运行时耦合。

## Decision

tui-agent `cordis.yml` 不再加载 `tool-todo`；`todo_write` 改为可选启用。`code-mode.cordis.yml` 覆盖配置继承基础组合，因此它生成的 SDK 同样不再包含 `todo_write`。启用它只需一条配置项——把 `@deepseek-ai/dsh-tool-todo` 加入 `cordis.yml`（或 `~/.dsh` 的个人覆盖配置）——此后模型照旧记录整份清单的 `todo/write` 快照，TUI 照旧渲染该计划。`TodoItem` 类型与 `todo/write` 事件仍留在 `@deepseek-ai/dsh-session`，TUI 的计划渲染也保持接线，因此默认（禁用）与可选启用（启用）两条路径都是一等公民。同类的 acp-agent、headless-agent、jsonrpc-agent 示例仍然出厂携带该工具。

## Alternatives considered

**在出厂的 TUI 默认配置中保留 `todo_write`。** 否决：它是一项可选启用的便利功能，而非核心工具，出厂加载它会为多数会话都忽略的功能花掉每一轮的工具列表与提示词预算。仍然携带它的示例保留了该插件的真实组合覆盖。

**连同默认配置项一起删掉 TUI 的计划渲染与 todo 测试。** 否决：需求是同时支持启用与禁用两种情形，而事件驱动的 `TodoComponent` 本就在零插件耦合下渲染计划，删掉它等于白白丢弃一项可用能力。取而代之，启用路径保留专门的覆盖。

## Testing

`examples/tui-agent/tests/tui.snapshot.ts` 根据逐场景的 `enableTodo` 开关决定是否挂载 `ToolTodo`：只有 `todo-plan` 场景挂载它（启用路径的证明，其 `session.jsonl`/`terminal.expected.txt` 固定了渲染出的计划），其余每个场景都运行默认的无 todo 组合。`tests/harness.ts` 把 `ToolTodo` 做成一个 `todo` 可选项，只有 `tests/todo-write.e2e.ts` 会开启它，因此带密钥的 todo e2e 仍然驱动真实工具，而其余套件与出厂技术栈保持一致。无密钥的 `tests/tui-keyless-smoke.e2e.ts` 启动真实的 `cordis.yml`，且不对 todo 作任何断言，因此默认启动不受影响。

## Consequences

默认 TUI 的协议工具列表和系统提示词少了一个工具；想要任务追踪的会话加一条插件配置项即可。`examples/tui-agent/composition.md`（已重新生成）及其叶子条目表不再列出 `tool-todo`，`scripts/gen-doc-graphs.ts` 中人工维护的摘要也去掉了它。`@deepseek-ai/dsh-tool-todo` 包本身没有变动，仍由 acp/headless/jsonrpc 示例出厂携带，因此它的覆盖需求在那里得到满足。若要恢复默认，只需重新加入那一条 `cordis.yml` 配置项，并把快照/harness 的可选开关重新打开。
