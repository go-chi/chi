# @deepseek-ai/dsh-tool-todo

[English](README.md) | 中文

面向模型的 `todo_write` 工具：agent（智能体）的完整任务列表，每次调用都会整体替换。

## 功能

注册一个工具 `todo_write(todos: [{ content, status }])` 到 `ctx.tools`。模型每次调用都会发送完整列表，不存在部分更新或单项编辑。每次调用都会向调用 agent 的会话日志追加 `todo/write` 事件（完整列表快照），具体调用 `agent.session.append('todo/write', { todos })`；当前列表是最新的该类事件（回放时后写覆盖先写）。

`status` 是 `pending`、`in_progress` 或 `completed` 之一。

## 单一所有者

该列表属于调用工具的唯一 agent 会话。不存在 subagent／共享／swarm scope：非 agent 调用方（没有 `exec.agent`）无处写入列表，因此会被拒绝。这是有意设置的 scope 限制，详见 Agent Note。

## 配置

`allowParallelInProgress` 是必填项：每个组合都必须选择是否允许多个 todo 同时处于 `in_progress`。这是部署层的选择而非固定规则：并发的活跃任务是否合理，取决于工具无法观测的运行时并发情况。可能并行展开工作的 agent 使用 `true`，`false` 则强制执行单活跃项纪律。

该开关会同时改变面向模型的指令与接受的输入——`true` 要求模型标记每个正在推进的任务并接受任意数量；`false` 要求恰好一个，并以 `Error: invalid todos: at most one task may be in_progress (got <n>)` 拒绝标记更多的调用。持久日志不变式**不**跟随它：在允许并行时写下的日志，在部署收紧策略之后仍必须可回放，因此不变式对活跃数量保持沉默。

## 验证

除 schema 的类型／必填／枚举检查外，`execute` 还会拒绝空或重复的 `content`，以及 `content`/`status` 之外的任何条目键——扩展条目形状（id、嵌套）会明确报错而不是被静默压平，保证落日志的快照与模型自认为写入的内容一致。同时可以有多少任务处于 `in_progress` 由部署决定（见 § 配置）：选择 `true` 的组合允许并行工作（并发 subagent、后台命令）同时将多个任务标记为 `in_progress`。列表的顺序及及时更新由模型依照工具描述负责。

## 渲染

规范结果为 `{ todos, counts: { pending, inProgress, completed } }`；其 Native 渲染器返回精简的更新确认。工具还会写入完整 `todo/write` 会话事件。UI 订阅事件流，并自行渲染该持久化列表：[web 客户端](../../client/ui-conversation)基于当前有效计划（其后没有更晚 `turn/start` 的最近一次 `todo/write`）显示计划条和专属工具行（[展示](../../../.agents/notes/implemented/feature/2026-07-23-web-todo-display.md)、[生命周期](../../../.agents/notes/implemented/feature/2026-07-28-todo-plan-clears-on-next-turn.md)）。

## 会话投影

当组合挂载了 `ctx.sessionProjections`（[`@deepseek-ai/dsh-session-projection`](../../session/session-projection/README.md)）时，本包在一个注入的子插件中注册 `todos` 投影单元：`init` = `null`（尚无写入）、`apply` = 从每个 `todo/write` 取整表，并在每个 `turn/start` 清为 `null`（当前有效计划；`turn/end` 保留刚完成的清单；其余事件都返回同一个状态引用）、`view` = 恒等、`stateVersion` = 2。该键在本包中合并进 `SessionProjectionMap`（经 Service Definition 包的 `/types` 出口）；框架驱动该单元，载体通过历史尾页与 `session/projection` 推送帧提供该值。未挂载注册表的组合不受影响。生命周期理由见 [在下一轮次清空 todo 计划](../../../.agents/notes/implemented/feature/2026-07-28-todo-plan-clears-on-next-turn.md)。

## 导出形状

函数／命名空间插件：导出 `name`/`inject`/`apply`，不提供默认导出。意外的 `export default` 会被 Loader 的 `unwrapExports` 折叠为默认导出，并导致 `inject` 丢失（参见 [docs/postmortem/0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)）。

## 模型体验

### 工具 schema

#### 模型看到的内容

模型会看到生成的 [`todo_write` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-todo)。

#### Token 影响

工具可见的每个请求都有固定的 schema token 开销。

#### KV Cache 影响

只要定义和可见性不变，前缀就保持稳定。插件生命周期或 scope 限制可能会使从此 schema 起的缓存复用失效。

### 工具调用历史与结果

#### 模型看到的内容

每个 assistant 工具调用都会在参数中保留整个替换列表。成功时原样返回 `Updated todo list: <pending> pending, <inProgress> in progress, <completed> completed.`。稳定失败文本为 ``Error: invalid todo: `content` must be a non-empty string``、`Error: invalid todos: duplicate content "<content>"`、`Error: todo_write requires an owning agent session`，以及——仅在部署设置了 `allowParallelInProgress: false` 时——`Error: invalid todos: at most one task may be in_progress (got <n>)`。完整 `todo/write` 会话事件是 UI 与回放状态，而非第二条模型消息。

#### Token 影响

token 用量会随模型每次提交的完整列表增长，且这些调用参数会保留到压缩（compaction）。结果本身很小，且形状固定。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV-cache 条目失效。

## 已知限制与暂缓事项

- **仅单一所有者 scope**：列表属于唯一调用 agent 会话；subagent／共享／swarm scope 是有意设置的限制（参见「单一所有者」一节），非 agent 调用方会被拒绝。
- **条目形状有意保持最小**：`content` 加三态 `status`；整表替换不需要稳定 id、优先级或 active-form 字段。
- **整表替换是唯一操作**：没有部分更新，也没有回读工具；模型每次调用都必须重新发送完整列表。
