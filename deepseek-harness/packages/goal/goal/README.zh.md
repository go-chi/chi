# @deepseek-ai/dsh-goal

[English](README.md) | 中文

事件溯源的同会话目标状态。该服务在 agent（智能体）的现有会话中保留一个当前待完成目标，同时将继续执行的权限作为进程本地续行启用状态。[goal 领域 Agent Note](../../../.agents/notes/implemented/feature/2026-07-19-persisted-same-session-goal-domain.md) 负责设计理由；[goal 类型目录](../../../docs/subsystems/goal.md)记录具体的数据形状。

## 配置

```yaml
- id: goal
  name: '@deepseek-ai/dsh-goal'
  config:
    defaultMaxGoalRounds: 256
```

`defaultMaxGoalRounds` 必须是正的安全整数。`create()` 会在提交目标前于内部物化这项部署默认值；请求级取值可以覆盖它。

## 服务约定

`ctx.goals` 只接受以对应 id 注册的完全相同的活跃 `Agent` 实例。`get()` 返回与内部状态脱离的 `GoalView`；变更以 `GoalRef { id, revision }` 作为比较并设置防护，并拒绝陈旧引用。服务通过 [goal.md](../../../docs/subsystems/goal.md#cordis-surface) 的生成区块公开 create、edit、pause、resume、complete、block 和 clear 动词。创建默认值在内部解析。`disarm()` 是仅供生命周期使用的例外：它移除进程本地续行权限，不写入新 revision，也不发出变更事件。

最多只有一个当前目标。创建操作会生成 revision 为 1、phase 为 active 的目标并启用续行。未完成的目标必须编辑、转换或清除；已完成目标可以由拥有全局未使用过的 id 的目标替换。编辑会保留 phase、blocker reason 与 activation。暂停、完成、阻塞和清除都会停用续行。阻塞会记录策略自有的 lower-kebab-case 代码和规范化的自由文本说明；提供方限制、配置预算、执行错误与请求人工输入都使用这一种持久 phase，不会扩增生命周期状态。只有配置的 Round 上限仍有剩余容量时，resume 才接受已停止 phase 或 phase 为 active 但已停用续行的目标；它会清除原 blocker reason。phase 为 active 且已启用续行的目标会拒绝冗余操作。

每次变更都会追加持久的 `goal/change` 事件，其中携带变更后的完整快照；clear 使用带 revision 的 tombstone。因此，goal 状态不依赖 inbox 放置、领取、准入或丢弃。会话日志是唯一的持久权威。

严格回放只从 `goal/change` 派生生命周期变更，并拒绝形状错误、不连续 revision、非法生命周期转换、每目标时间戳非单调，以及不连续的已准入 Goal Round。只有来源为 goal 且已准入的 `user/message` 事件会推进正数 Round。挂钟时间倒退时，变更时间戳会限制在不早于上一次目标更新的值。增量回放会把游标保留在第一个损坏事件处；`goal/changed` 会在持久事件提交后触发，监听器失败会被隔离处理。

续行启用状态绝不持久化。新缓存与每次触发 `agent/session-start` 时都会停用续行，即使回放找到了持久 phase 为 active 的目标。续行驱动器在卸载前或持久性不确定后也会调用 `disarm()`。因此，会话恢复、fork 与驱动器替换会保留目标、phase、revision 和已准入 Round 数量，却不会启动工作；之后必须通过显式 resume 变更重新启用续行。

单独发布的 `./invariant` 配套模块会为每个已挂接会话维护独立折叠。它会在候选事件进入持久日志前拒绝格式错误的 goal 变更、不连续 revision、非法生命周期转换、时间戳回退，以及不连续的已准入 Round。

## 扩展点

策略插件调用服务动词，并响应限定范围的 `goal/changed` 事件。续行消费方将 Round 准入为 `user/message` 事件，并携带 `GoalMessageSource`；普通的人类轮次绝不会增加 `roundsStarted`。消费方使用 `Agent` 接口和事件，不导入 `dsh-agent-loop`。

## 模型体验

### 目标状态变更

#### 模型看到的内容

Goal 变更不会注入模型上下文。`get_goal` 等工具返回当前状态；继续执行消费方可以在调度模型工作时渲染目标描述与 Round 状态。未来如果需要始终可见的 goal 上下文，应由独立上下文插件实现，而不是放在持久化路径中。

#### Token 影响

Goal 变更事件本身不增加模型 token。工具结果和续行调度提示词各自暴露的状态会分别计入 token 用量。

#### KV Cache 影响

在其他组件把 goal 状态暴露为模型可见输入之前，不会影响 KV Cache。

## 已知限制与暂缓事项

- **只负责状态，不负责任务调度**：此包不决定已启用续行的目标何时继续，不重试异常失败，也不取消活跃轮次；这些策略属于 agent seam 消费方。
- **只有 Round 数量预算**：`maxGoalRounds` 不计量 token、货币、挂钟时间或提供方配额。
- **没有独立评估器**：记录完成或阻塞的调用方拥有最终决定权；由评估器支持的认证暂缓到独立策略层。
- **只有一个当前目标**：系统有意不支持并行目标或独立目标数据库；替换或清除后，历史仍可在会话日志中读取。
- **信任进程内生产方**：能直接访问 `Session` 的插件可以追加伪造的 `goal/change` 数据。严格回放会检测格式错误或不一致的记录，并使 goal 访问从该记录起失败，直到日志修复；这是完整性检测，不是插件隔离。
