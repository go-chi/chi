# @deepseek-ai/dsh-goal-round-driver

[English](README.md) | 中文

[`ctx.goals`](../goal/README.md) 的同会话续行驱动器。它通过公开 `Agent` 与会话服务，把 phase 为 active 且已启用续行的目标转换为连续的 [Goal Round](../../../docs/glossary.md#goal-round)；[同会话驱动器 Agent Note](../../../.agents/notes/implemented/feature/2026-07-19-same-session-goal-round-driver.md) 记载竞态与生命周期方面的设计理由。

## 组合

```yaml
- id: goal
  name: '@deepseek-ai/dsh-goal'

- id: tool-goal
  name: '@deepseek-ai/dsh-tool-goal'

- id: goal-round-driver
  name: '@deepseek-ai/dsh-goal-round-driver'
```

该插件没有可调配置。`maxGoalRounds` 属于目标定义，面向模型的阻塞阈值则属于 [`dsh-tool-goal`](../tool-goal/README.md)；在驱动器中重复任一数值都可能产生分歧策略。

## Round 约定

当对应的活跃 agent（智能体）实例处于 idle 状态，且目标 phase 为 active、已启用续行并有剩余容量时，驱动器先为待处理 goal 变更创建检查点，再预留 `roundsStarted + 1`，对应当前 `{ goalId, revision }`。它会排入一条 `<goal_round>` 提示词，并携带 `GoalMessageSource`。`agent/pre-step` 监听器会在下游监听器前后验证完整的已领取记录与当前 goal；只有进入步骤的 `user/message` 才会增加 `roundsStarted`。因陈旧而被拒绝的预留不会消耗 Round 编号。

`MessageId` 通过持久 inbox 插入和领取来标识预留消息；它不标识轮次结果。人类消息不消耗 goal 上限。如果人类工作在预留前进入 inbox，或加入预留的待处理批次，自动工作会让行，直到 agent 进入 idle；混合批次中的待处理自动提示词会被拒绝，只有在该检查点之后才重新预留。

保留的提示词会点明经过 JSON 引用的目标与 `round/maxGoalRounds`，将当前工作区、工具结果和持久会话状态视为权威信息，要求在完成前提供证据，并要求在工作仍未完成时保持目标 active。引用可将多行或形似标签的目标文本保留为数据。goal 生命周期变更仍必须通过 `dsh-tool-goal` 的独立权限检查。

## Idle 检查点

整个 agent 进入 idle 时，持久 goal phase 和 revision 具有权威性。phase 为 active、已启用续行且仍有容量的 goal 会预留下一 Round；完成、暂停、阻塞和编辑都会阻止续行。驱动器不会通过关联 goal 消息与 `turn/end` 来对前一段活动分类，因此提供方错误和 token 上限不属于提示词级 goal 结果。

## 生命周期与持久性

`goal/changed` 会产生持久性义务。排队工作前，驱动器会等待 `ctx.sessions.flush()`，并在等待后重新检查 goal revision 与竞争输入。通过 `agent/error` 到达的 flush 失败会停用续行，避免另一 Round 启动。

此插件加载到现有 agent 上时绝不会继承续行启用状态。`GoalService.disarm()` 会移除进程本地权限，而不改变持久 phase、revision 或历史；之后由用户明确授权的 resume 会记录重新启用续行。会话 resume 和 fork 后，goal 领域通过 `agent/session-start` 处理应用相同规则。

取消会移除 inbox 中待处理的工作，或留下 agent 范围的 aborted 状态。在下一次 idle 检查点，驱动器会暂停存在已预留或已准入尝试的 goal，避免取消后自动重启；与 goal 尝试无关的取消只会撤销进程本地续行权限。如果 pause 变更失败，驱动器会回退到停用续行。插件 teardown 会关闭准入，停用所有活跃 goal 的续行，以 `parent` cause 取消正在进行的工作，并在事件防护仍生效的情况下等待驱动器和 agent 完全停稳。

## 模型体验

### Goal Round 提示词

#### 模型看到的内容

每个已准入 Round 都是一段保留的用户角色 `<goal_round>` 块，其中点明完整目标与正数 Round 编号。更早的用户消息、goal 状态快照、assistant 输出与工具记录仍保留在同一会话历史中。

#### Token 影响

每个已准入 Round 会增加一个固定指令块和目标。后续请求会重新发送保留的 Round，直到压缩（compaction）将其遮蔽；不会创建新 agent，也不会复制对话前缀。

#### KV Cache 影响

在一个 epoch 内仅追加：每个已准入 Round 都会在可复用前缀后扩展现有对话。压缩可能替换派生历史后缀，并移动可复用边界。

## 已知限制与暂缓事项

- **没有独立评估器**：面向模型的 goal 策略会判断证据是否足以完成，以及 blocker 在语义上是否未变；评估器支持的认证仍保持暂缓。
- **只在同一会话执行**：此包有意不 spawn 新 agent、不 fork 会话前缀，也不实现 Ralph 风格的独立尝试；该工作流属于单独的插件层。
- **已接受队列的卸载竞态**：Cordis 插件卸载是异步的。已经被 agent inbox 接受的 goal 提示词可以在卸载开始前启动并消耗其 Round；teardown 随后会取消请求、停用 goal 的续行并等待完全停稳。不会再启动后续 Round。
- **只有 Round 上限，不是资源预算**：token、货币、时间与提供方配额策略保持独立。对应的会话事件不会归属于 goal 消息，也不会映射为 goal 阻塞代码。
- **异常情况不自动重试**：暂时性的提供方与持久化失败需要之后由用户授权 resume，而不会采用隐式重试策略。
