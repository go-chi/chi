# Agent Note: 按意图命名的 subagent 继续执行操作

Status: implemented

[English](2026-07-27-intent-named-subagent-continuation-operations.md) | 中文

当前基于 Activation 的实现由[可继续的 subagent](../feature/2026-07-28-continuable-subagent-conversations.md)负责。它保留本记录命名的 `followup` 操作，返回已接受的 `MessageId`，使用裸 `Agent` 参数作为确切的在线直属父级权限，并将提供方对可继续 child 的参与限制为 `prepareContinuable`。

## 问题

将可继续 child 的编排合并到 `ctx.subagents` 后，提供方分发与调用方意图共存于同一个公开服务中。`resume(name, request)` 接受描述符、已鉴权的 parent、持久化 child id 与激活信号，而只有内部继续执行管理器才能正确解析这些数据。`sendMessage(...)` 暴露的是传输层措辞，而不是 `Agent` 已采用的 `followup` 意图；它还将来源与信号拆成独立参数，扩大了操作接口，而每个调用方都必须以原子方式同时使用二者。

持久性边界还同时公开了 `SessionStore.flush()` 与 `flushRequired()`。二者执行相同的作用域内并行分发，唯一差别是是否接受空的监听器快照，因此会话接口将一个消费方的策略编码为第二项操作。

## 决策

`SubagentRuntime` 分离四种执行意图：`start(name, request)` 返回普通的、由持有方负责的 one-shot run；`startContinuable(spec)` 建立持久化 child，并返回其 id 与已接受的初始 `MessageId`；`followup(parent, childId, content, { source, signal })` 发送后续 parent 内容；`reportFrom(child, content, { delivery, signal })` 将选定的 child 内容发送给其直接 parent。`followup` 与 `Agent.followup()` 一致，而 `SubagentRun.steer()` 仍是范围更窄的能力，仅向已确认仍在运行的 run 提供 steering（中途引导）。面向模型的工具保留稳定的 `send_message` 与 `report` 名称，并将路由委托给对应的意图方法。

调用方请求与提供方请求相互分离。`SubagentStartRequest` 包含调用方提供的 one-shot 数据；`ResolvedSubagentStartRequest` 会在调用 `SubagentProvider.start()` 前加入由服务解析的描述符。创建可继续 child 时，管理器将 `ContinuableCreateRequest` 传给可选的 `SubagentProvider.prepareContinuable()`，且只接收分离的创建数据。`SubagentRuntime.resume()` 与提供方恢复分发均不存在：继续执行管理器加载描述符、对 parent 进行鉴权，并负责 Agent 实体化、提示词投递、冷恢复与 teardown。

`SessionStore.flush(session)` 是唯一的持久性屏障，并返回 `Promise<boolean>`。至少一个作用域内监听器成功参与后，它解析为 `true`；监听器快照为空时解析为 `false`；所有监听器结算后，如有失败，则以注册顺序最靠前的监听器错误拒绝。参与结果无法表明所选的持久化后端是否已经存储状态。普通检查点可以忽略该布尔值；继续执行管理器同样将最终 flush 视为 best-effort 屏障，有意忽略参与结果，记录拒绝日志，并仍会对 child 执行 dispose（资源释放）并释放所有权。

## 已考虑的替代方案

**保留公开的提供方恢复分发。** 继续执行管理器之外，没有任何生产调用方同时负责安全调用所需的描述符查找、直接 parent 鉴权、Agent 实体化、Activation 所有权与 child-first teardown。公开方法会暴露已解析的实现数据，却没有合理的独立调用意图；提供方改为通过 `prepareContinuable` 贡献分离的首次创建数据，且从不参与冷恢复。

**在服务上保留 `sendMessage`。** 面向模型的工具发送消息，但服务操作表达的是后续操作，既可能对运行中的激活执行 steering，也可能从持久化存储恢复。`followup` 与结构化 `Agent` 接口保持一致，也不承诺特定路由。

**保留 `flushRequired()`。** 第二个方法只封装了空监听器检查。由现有屏障返回是否有监听器参与，可以让分发只保留一套实现，并让每个调用方自行判定缺少监听器是否可接受。

**合并普通启动与可继续启动。** 一个标志会让同一方法要么等待由持有方负责的 one-shot run 就绪后返回，要么立即返回持久化 child 与消息标识。按意图拆分的方法无需返回值联合类型即可保留所有权与时序差异。

## 影响

- Cordis 服务目录只包含调用方操作；提供方可以通过 `SubagentProvider.prepareContinuable?()` 选择参与可继续 child 的首次创建，但不会获得 Agent 生命周期权限或公开恢复操作。
- 后续操作的来源与取消信号通过同一个选项对象传递，与 `Agent` 上按意图命名的辅助方法形态一致，同时保留在线投递与从持久化存储恢复的语义。
- 会话持久性只有一个屏障操作。参与结果仍可观测，但任何可继续 child 路径都不会将任意监听器参与视为持久化后端已存储状态的证明。
- `send_message` 与 `report` schema、已接受的消息标识、`AgentHandle` 所有权、持久化事件词汇与模型可见的 transcript（文本记录）遵循上文链接的基于 Activation 的实现。
