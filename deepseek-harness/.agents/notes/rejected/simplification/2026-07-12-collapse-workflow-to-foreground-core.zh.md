# Agent Note: 将工作流收缩至已使用的前台核心

Status: rejected — 工作流进度是有意设计的观测接口；应通过消费方使其发挥作用，而非删除它。

[English](2026-07-12-collapse-workflow-to-foreground-core.md) | 中文

## 问题

工作流能力在前台执行用于编排 subagent 的 JavaScript，但它同时携带了一套无人消费的进度观测系统。没有任何生产环境的监听器订阅六个 `workflow/*` 事件中的任何一个；监听器仅存在于工作流测试中。尽管如此，seam 定义了 run/phase/agent（智能体）outcome 载荷，worker 发送 phase/log/agent 生命周期协议消息，host 通过一个 `liveAgents` 配对账本转发它们，引擎维护 run id 仅仅是为了关联这些通知。

这套进度词汇不仅仅是未被使用；它在不经重新设计的情况下也无法服务于其唯一已命名的未来消费方。`WorkflowRunInfo` 包含 `{id, meta}` 但没有父 agent、会话或工具调用标识，而面向模型的工具也从不暴露 run id。一个全局 ACP（Agent Client Protocol）监听器无法将事件路由到正确的客户端会话。`meta.phases` 从未被查询，`phase(title)` 不对其做校验，phase 的 `detail`/`model` 和 agent 的 `label`/`phase` 仅供事件消费，`whenToUse` 被校验和复制但从未被渲染或用于选择。`phase()` 和 `log()` 仍然跨越 worker 边界，尽管没有接收方。

这些观测者移除后，live handle 仍重复携带事件机制所需的数据。`WorkflowRun.id` 没有非事件消费方，而工具读取 `run.meta.name` 只是为了渲染一个它已经以 `args.meta.name` 形式持有的值；两者都不属于执行/取消 handle。

取消机制也为一个同步启动提供了两条公开通道。`WorkflowStartRequest.signal` 被传递给 worker host，而唯一的生产调用方另外将同一个 signal 桥接到 `WorkflowRun.cancel()`。因为 `start()` 在控制权让出之前就返回了 run，不存在需要请求时取消的就绪窗口；重复的 signal 增加了 host 的 listener/disarm 状态却没有封堵任何竞态。

`WorkflowError.fatal` 是同一种推测性分支的微缩版：生产代码中的构造全都采用 fatal 模式，`fatal: false` 仅存在于测试中，组合子已经通过 `instanceof` 区分工作流失败。

## 提案

保留已使用的核心：`agent(prompt, { schema, model })`、`parallel`、`pipeline`、`args`、并发/agent 上限、取消、有界 dispose（资源释放）、结构化结果、worker 隔离与前台工具收集。移除所有 `workflow/*` 事件及其仅供事件使用的 info/outcome 类型；移除 `phase()`、`log()`、agent 的 `label`/`phase`、phase 声明、`whenToUse` 及其 worker 消息/host 观测者；将工作流元数据收缩为工具实际使用的 name；移除仅供事件使用的 run id/meta 快照与合成的 agent-end 账本。将 `WorkflowRun` 收缩为 `result`、`cancel()` 和 `dispose()`；工具渲染请求中已有的 name。移除 `WorkflowStartRequest.signal` 及 worker host 的 input-signal listener/disarm 状态，保留调用方从其 abort signal 到 `run.cancel()` 的桥接。将 `WorkflowError` 变为单一的 fatal 错误类，不再有布尔模式或 `isFatalWorkflowError()` 辅助函数。

修订已实施的动态工作流 Agent Note，并更新 seam/工具/worker README、工具 schema、生成的 catalog 与包依赖图、worker type-equiv 记录、单元测试以及工作流快照/header fixture（测试前置数据）。如果进度 UI 工作被立项，应从一份命名了父 agent/会话/工具调用的关联约定出发，而非原样复活这套协议。

## 曾考虑的替代方案

**为未来 UI 保留预建的观测词汇。** 当前形态类似 Claude Code 的动态工作流元数据，host 有意地将每个转发的 agent start 与 worker 的 end 或一个合成的终止 end 配对。移除它意味着放弃形态兼容性，使进度 UI 成为一项全新的设计任务；但现有载荷仍缺少可路由的归属信息，因此仅靠成对完整的生命周期也无法在不重新设计的情况下让已命名的 ACP 消费方可行。

## 验收标准

- 工作流公开约定仅包含有生产消费方的执行、取消、结果与 dispose 约定。
- 不再保留任何工作流事件、phase/log 协议消息、run-id 生成器、仅供进度使用的元数据、host 配对账本或 fatal 模式分支。
- run handle 不再有 id/meta 回显，取消在同步 `start()` 返回后只有一条持有者拥有的通道。
- parallel/pipeline 行为、上限、取消后的完全停稳、worker 隔离、结构化输出与面向模型的工作流场景保持测试覆盖。
- 类型检查、覆盖率、快照、doc-sync（文档同步门禁）、module-graph 校验、构建与 hygiene 全部通过。

## 风险

这是对工作流 DSL、事件分类体系、handle 与 start request 的编译可见收缩。现有提供描述性元数据的工作流调用，以及使用 `phase`、`log` 或 label 的脚本，都必须相应精简；程序化调用方需自行将 abort source 桥接到返回的 handle；未来的观测者必须添加一个关联性更好的事件约定。使工作流有用的执行语义不变。
