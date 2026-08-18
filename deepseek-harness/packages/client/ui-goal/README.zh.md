# @deepseek-ai/dsh-client-ui-goal

[English](README.md) | 中文

Goal 界面插件（浏览器端部分）：`GoalBar` 条带是 `conversation.input.dock` composer 上下文堆栈中的第二张独立卡片（order 10，位于 Todo 之后、Queue 之前）。活值经 `useProjection('goal')` 到达——host 计算的全量值由历史尾页播种、由 `session/projection` 帧更新——因此本插件不持有领域 store、不设刷新链、不挂事件监听。slot 注入面只携带四个变更动词（edit / pause / resume / clear，经 `ctx.remote.goals` 调用——active 的 goal 提供暂停动作，paused 的提供恢复）；每个动词在调用时从会话当前投影值读取 CAS ref，并将 Remote 调用的拒绝错误内联呈现。由于 React 的 pending 渲染无法拦住同一帧内的点击，横条会同步为变更建立 single-flight 防护；清除成功后，会立即抑制该 goal id 对应的目标显示，直到权威的 null 投影追上。goal 的创建仍归 `/goal` host 命令；加载中、无 goal、已完成和已成功清除的 goal 一律不渲染。

该插件还会通过自有 Conversation Definition 投影每条持久 `/goal` `command/run`。它在通用命令结果 Node 之前构建一个 `command-input` Chat Node，并为该 Node 注册 keyed renderer；renderer 将其呈现为右对齐、使用 14px/22px 等宽字体的用户样式气泡，使用本地化分组名称 `Command input`／`命令输入`，且不含时间戳、复制或分支操作。可见的非命令 Node 会激活新 Chat；重新加载时会根据 run 重建该 Node，而仅包含 `command/done` 的历史窗口只保留通用结果行。该投影绝不会创建 `user/message` 或模型轮次。

`/client` 的导出接口包括插件本体（`apply`/`inject`）、`GoalBar`/`GoalDock` 组件与注入动词面类型。

## 模型体验

间接影响：条带通过调用 `goals/edit`、`goals/pause`、`goals/resume` 和 `goals/clear` Remote 方法提交变更；每次被接受的变更都会在持久 `agent/inbox/spliced` 插入项中提交，goal 投影会立即折叠该插入项，同时将一条 `goal/change` 上下文消息排队。只有后续 pre-step 准入该上下文时，模型才会看到它；丢弃已排队的消息不会回滚投影状态。条带自身不添加任何提示词内容。

#### KV Cache 影响

除非已排队的 goal 上下文获准，否则没有影响。获准的上下文会像其他消息一样扩展历史尾部；准入前被丢弃的插入项不会影响缓存。

## 已知限制与暂缓事项

- **只反映持久 phase**——投影省略进程本地 activation，因此条带无法区分 active-but-disarmed 与 armed 状态；resume 通过 RPC 重新置为 armed 状态。不存在 host 实时 activation 通道。
