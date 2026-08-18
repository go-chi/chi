# Agent Note: 每个会话事件都封闭在一个轮次内

Status: implemented
Archived: 2026-07-28

[English](2026-06-15-turn-enclosure-invariant.md) | 中文

## 问题

持久化的会话持久化后端（在配套变更中引入）以**轮次**作为崩溃恢复边界：崩溃可能留下一个未关闭的最终轮次，`load` 会用一个合成的 `turn/end {kind:'interrupted'}` 将其关闭，同时保留该轮次的真实事件（见[会话持久化](2026-06-14-session-persistence.md)）。这种恢复只有在没有任何*合法的*持久事件位于轮次之外（即上一个 `turn/end` 与下一个 `turn/start` 之间的间隙）时才是良定义的，否则这类事件会被卷入下一个轮次的中断关闭中。

这一假设并不成立。有两条路径在任何轮次之外记录了事件：

1. **排队的用户消息。** agent loop（智能体循环）排空排队消息并在 `turn/start` *之前*追加 `user/message`——于是一个轮次自身的提示词落在了前一个 `turn/end` 与下一个 `turn/start` 之间的间隙中。
2. **空闲时的上下文注入。** `agent.inject()` 直接追加一条 `context/message`。它在生产环境中的真实调用方是 `dsh-tool-bash`，后者从 `ctx.bash.onTaskDone` 注入后台任务完成通知——该回调在后台 bash 任务完成时触发，而这经常发生在 agent **空闲**（轮次之间）时。

在情况 2 中，如果注入的 `context/message` 是 flush/dispose 之前的最后一个事件（之后没有轮次追加 `turn/end`），`scanLog` 会将其视为崩溃残留并在**恢复时丢弃**——注入的上下文已持久写入磁盘，但重新加载后被静默丢失。情况 1 本身无害（`user/message` 之后总会跟着它触发的轮次），但使「什么可以出现在轮次之外」这条规则变得模糊。

## 决策

**每个会话事件都位于一个轮次内部**：在 `turn/start` 与其匹配的 `turn/end` 之间。具体而言：

- agent loop 在 `turn/start` **之后**（轮次内部）追加排队的 `user/message` 事件，而非之前。因此，一旦这些消息被记录，就欠下一个 `turn/end`，既有的 finalizer 保证它被写入。
- agent **运行中**调用 `agent.inject()` 时，它会加入已打开的轮次。当前步骤执行 assistant 工具调用期间，已接受的上下文按到达顺序等待该批次结算，随后在每个已记录结果之后追加；即使执行中断，也会在轮次关闭前写入。
- agent **空闲时**调用 `agent.inject()`，则将 `context/message` 包裹在一个一次性轮次中：`turn/start{trigger:{kind:'injection'}}` → `context/message` → `turn/end{completed}`。一个新的 `injection` 变体加入可合并扩展的 `TurnTriggerMap`。
- agent loop 每次迭代从日志推导下一个轮次编号（`lastTurnNumber(session) + 1`），而不是维护一个私有计数器，这样空闲注入的一次性轮次不会与下一个真实轮次的编号冲突。
- `dsh-session/invariant` companion 将该检查注册到 `ctx.invariants`：选中后，在没有打开轮次的情况下追加 `user/message` / `context/message` / `steering/message` 会抛出归因于 `@deepseek-ai/dsh-session` 的 `InvariantError`。

可序列化性不变式在同一源码边界处强制执行（`Session.append` 对不可 JSON 序列化的数据抛出异常），因此「什么可以进入日志」现在由一个位置统一管控，而非由下游碰巧在监听的某个后端各自发现。

## 曾考虑的替代方案

**放宽读取端而非约束生产端**——让 `scanLog` 提交位于已打开轮次之外的事件。否决：一条单一、可检查的生产端规则优于一个更宽松的边界扫描（后者需要同时推理部分轮次*和*轮次间的散落事件）。

## 后果

轮次现在是*唯一的*持久性/回放边界，因此[会话持久化](2026-06-14-session-persistence.md)的崩溃恢复规则是完备的，而不仅仅是充分的：被中断的最终轮次被关闭（用合成的 `turn/end {interrupted}`），其真实事件得以保留，且零风险将轮次间上下文混入其中，因为不存在轮次间上下文。`scanLog` 保持简洁（最多一个可能未关闭的最终轮次，绝无散落的轮次间事件），空闲时的后台任务通知在持久化 + 恢复后依然存活。

代价：空闲时调用 `agent.inject()` 现在写入三行日志而非一行；派生的历史中多出一个仅包含注入上下文（无 assistant 输出）的轮次——`deriveMessages()` 已经纯粹按事件类型派生，因此渲染结果完全相同。`injection` 触发器是一个新的磁盘词汇值；与每次 `SessionEventMap`/`TurnTriggerMap` 的新增一样，它属于冻结格式的一部分。轮次内的事件顺序发生了变化（`turn/start` 现在先于 `user/message`），这对任何断言旧顺序的代码可观测——agent loop 自身的测试是唯一的此类消费方。

该规则有意采用生产端强制、开发环境检查的方式，而非读取端容忍的方式：未来的后端（SQLite/WAL）无需额外工作即可继承同样干净的边界，而在轮次外记录事件的插件会在开发环境中大声失败，而非在下次重新加载时静默丢失数据。

轮次内检测到的失败在 `turn/end` 之前记录。后续的 flush 失败没有有效的轮次内位置，因此通过 `agent/error` 和日志报告，而非作为会话事件追加。这保持了回放日志的平衡；持久化的运维诊断需要一个独立的遥测通道。
