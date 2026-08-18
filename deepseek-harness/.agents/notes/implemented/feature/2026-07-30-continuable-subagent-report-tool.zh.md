# Agent Note: 可继续 subagent 报告工具

Status: implemented

[English](2026-07-30-continuable-subagent-report-tool.md) | 中文

## 问题

可继续的进程内 subagent 能够接收 parent 后续发来的消息、保留后代、结算并冷恢复，但基础生命周期无法让它们将选中内容发送给直接 parent。child 的完整输出已可从持久化会话中重建，因此缺失的能力是显式投递，而非结果存储。

如果将每条 assistant 最终消息都视为隐式结果，就会混淆轮次完成与报告。长期运行的 child 可能在某个轮次中无内容可报告，也可能在另一个轮次多次报告进展，而且报告后必须仍可继续工作。因此，接收方权限、静默投递与唤醒投递、确认、持久性和重试行为都需要一份显式约定。

## 决策

新增可独立安装的 `@deepseek-ai/dsh-tool-subagent-report` 包。它会向每个可继续进程内 child Activation 贡献一个普通的面向模型 `report` 工具。机制本身接受一个轮次中调用零次或多次；child 会另行被要求在结束前调用一次（见[报告义务](2026-08-06-continuable-child-report-obligation.md)）。调用成功既不会结束该轮次或结算 Activation，也不会阻止 parent 之后继续 follow-up；完成轮次也绝不会自动报告。

该功能是协作控制，不是承载结果的执行包装层。它不新增 Task、`SubagentRun`、结果 promise、Activation 状态、投递队列或回放路径。

### 面向模型的约定

`report` 只接受 `{ output: string }`，也只返回 `{ messageId: string }`。它不接受 child id、接收方 id 或投递模式。`exec.agent` 将工具调用绑定到发送报告的 child；服务从持久化 `parentSession` 中推导唯一接收方，调度则由部署配置决定。

`messageId` 是 parent 接受的用户角色消息所对应的稳定 `MessageId`。它不是 `InboxItemId`：静默投递不创建 inbox 条目实例，唤醒投递则会为同一条稳定消息创建一个条目实例。它也不是已读回执、parent 日志确认、轮次完成回执或持久化 flush。

工具描述会明确报告操作在结束前必须执行、可重复、仅限直接 parent 且不会结束轮次。它还会警告：发送被接受后，后续 `tools/post-execute` 失败可能替换工具结果，因此工具结果失败时内容仍可能已经送达。没有幂等键时，更强的表述会诱导调用方在结果不明确的失败后重复重试。

该工具使用不带 location 的通用渲染，其确认中包含 `messageId`。作用域局部注册使呈现与执行保持一致：root、one-shot child、远程提供方、同级作用域和无 agent（智能体）执行既不能看到，也不能执行 `report`。它会在 child 的全局 `toolFilter` 之后安装，因此委派 allow-list 不会意外移除这条结构性返回通道；不需要返回通道的部署不安装该包。

### 服务权限

subagent seam 暴露 `ctx.subagents.reportFrom(child, content, { delivery, signal }): Promise<MessageId>`。确切的在线 child Agent 是发送方凭据。继续执行管理器只接受 `handle.agent === child` 的 Activation，从 child 的持久化 header 中推导其直接 parent，并要求该 id 在最终的同步授权与发送区间解析为一个在线 parent Agent。该 API 不接受由调用方选择的接收方、祖先或发送方字段。

root、one-shot child、伪造对象、陈旧 Agent 和同 id 替换对象都以 `UNAUTHORIZED` 失败。正在关闭的 child Activation 以 `ACTIVATION_CLOSING` 失败；管理器 drain 和接受前取消保留既有的生命周期错误。直接 parent 不存在或拒绝接受时，以 `PARENT_UNAVAILABLE` 和 `direct parent is not live; report was not delivered` 失败。失败不返回 id，不冷恢复 parent，不写入离线邮箱，也不会修改缺失 parent 的会话。

嵌套报告恰好跨越一条边。grandchild 会向其直接 child parent 报告，绝不会直接向顶层 coordinator 报告。中间 child 可以稍后显式报告自己归纳的更新。

### 投递策略

该包会校验 `reportDelivery: 'quiet' | 'wakeup'`，默认值为 `wakeup`（见[默认值反转的理由](2026-08-06-continuable-child-report-obligation.md)）。

静默投递调用 `parent.inject()`。它会添加模型可见上下文，但不启动 parent 模型请求：若 parent 空闲，则在调用返回前追加消息；若 parent 正在准入或运行，则暂存报告，留到下一个安全日志位置。该模式不创建 inbox 条目实例，因此也不会产生虚构的继续执行管理器接受记录。

唤醒投递调用 `parent.followup()`。它会创建一个普通的 FIFO parent 轮次，唤醒已停驻的 parent driver，且绝不 steering（中途引导）已开始的轮次。当该 parent 本身也是可继续 Activation 时，发送会使用管理器现有的准入计数，防止 parent 在同步入队与准入微任务之间结算。

两种模式都会将一条用户角色消息封装为 `Background subagent <child-id> reported:`，后面跟随完全原样的 `output`。持久化消息来源为 `{ kind: 'subagent-report', senderSessionId: child.id }`。并发发送的顺序由 Agent 的常规规则决定；subagent 层不会创建第二条队列。

### 确认与恢复

成功表示确切的在线 parent 已同步接受该消息。空闲 parent 在接受静默注入时已经完成追加，而暂存的静默上下文只有到达正常日志边界后才可重建。唤醒投递包含一个 inbox 条目实例，其 id 与返回的稳定消息 id 保持分离。

首个版本不提供持久化邮箱、幂等键、投递回执、重试协议或恰好一次保证。进程故障可能让调用方无法确定结果，在结果未知时重试则可能重复报告。parent 不可用时，持久化 child transcript（文本记录）仍是恢复来源。

### 组合与生命周期

subagent seam 新增 `registerContinuableSetup(contribution): () => void`，由 `SubagentActivationSetupRegistry` 支撑。每个同步贡献都会接收尚未发布的 child 上下文，并返回其安装的 disposer。继续执行管理器首先应用基础 child 组合，然后通过同一个用于首次创建与冷恢复的设置闭包，按注册顺序应用当前贡献。

注册表负责注册、每个 child 的安装记录、设置回滚、child 作用域清理和立即撤销。应用一个批次会返回 Agent setup 提交对象，用于在每次 setup 的 await 结算后以及紧邻 Agent 发布前重新校验配置状态。因此，某项贡献抛出异常或被并发撤销时，会在 Agent 与会话发布前拒绝操作并回滚该批次。新注册项只会在驻留 child 的下一个 Activation 生效；移除注册项时，会先将它对新设置关闭，再立即撤销为正在预配置或驻留的每个 child 安装的实例。注册 dispose（资源释放）与 child 上下文 dispose 都是幂等的，两者都会先尝试每项释放，再聚合失败。

该 seam 使继续执行管理器无需知道工具名。report 包只安装 `report` 及其 child 作用域指引 section；`@deepseek-ai/dsh-tool-subagent-control` 则独立安装 parent 侧的 `send_message` 和 `list_agents`。部署时可安装任一方向、同时安装两者或两者均不安装。提供方仍只负责数据，持久化描述符不会对 report 可用性或投递模式建立快照，冷恢复则使用部署当前的贡献与策略。

### 快照覆盖

ACP（Agent Client Protocol）快照 harness 新增 `waitForSubagentTurnEnd`，按与 `session.N.jsonl` 相同的顺序选择第 N 个已收集 child。它会等待一个包含请求 header 的已闭合 child 轮次，以防可继续 child 早期播种描述符的轮次错误满足该边界。这样，整体组装的场景无需伪造 parent 可见信号，就能等待 child 侧报告。

手写快照会启动一个可继续 child，执行真实的作用域局部 `report` 工具，观察默认唤醒投递所产生的那一个普通 parent 轮次，然后提交一条后续 parent 提示词，使其消费封装后的报告。它声明 child pin `1`，因此本不属于全局的 `report` schema 与该 child 自身的提示词会分别与 `tool-schemas.1.expected.json` 和 `system-prompt.1.expected.md` 比对，root 则继续使用类别 pin。生成的工具目录会另外铸造一个 child 作用域，以收录同一个作用域局部 schema。

## 曾考虑的替代方案

### 自动投递每个最终回答

自动投递无法表示零次报告、进展报告或多次精选更新。它还会将报告与结算耦合，并可能重复投递已显式报告的内容。

### 始终唤醒 parent

每次报告都唤醒 parent 会产生未经请求的轮次，还可能沿嵌套 subagent 级联扩散。当初选择静默投递作为默认值，前提是 parent 还有别的理由去读自己的上下文。[报告义务](2026-08-06-continuable-child-report-obligation.md)取代了该选择：已经停驻的后台协调者并没有这样的理由，因此唤醒成为默认值，而本段现在记录的是 `quiet` 为何仍然保留。

### 允许 child 选择投递模式

向模型提供 mode 参数会赋予其控制调度器压力的能力，并使行为依赖部署。child 只决定内容和时机；该内容是否启动另一个 Agent 轮次，由部署配置决定。

### 注册全局工具

全局 `report` 会向 root、one-shot child、远程 child 和无 agent 调用方公布一项无法使用的能力。到执行时才拒绝，会使 schema 可见性与权限不一致。

### 将两个方向合并到 control 包

`send_message` 与 `report` 的受众、作用域、配置和生命周期各不相同。独立的包可让部署授予任意一个方向，而不暗示也授予另一个方向。

### 持久化离线 parent 邮箱

修改或冷恢复不在线的 parent，需要一套新的持久化寻址、权限、冲突、确认和回放协议。要求直接 parent 在线，可以让首个版本继续使用现有 Agent 发送路径。

### 重新引入 Task 或结果 promise

承载结果的包装层会让一次报告或一个轮次看似具有终止性，并重新引入可继续 Activation 已经移除的生命周期不匹配。显式、可重复的发送无需中间执行对象。

### 在 Agent 创建后校验 setup

创建完成后的撤销检查只能在 Agent 与会话均已发布后拒绝 Activation。对返回的 handle 执行 dispose 会移除实时对象，但当前 seam 无法删除持久化内容，因此会留下一个仍可恢复的 child，而继续执行管理器却判定它从未建立。改为返回 `AgentSetupCommit`，Agent 工厂便可在自身的发布边界同步执行同一项可变状态检查。

## 影响

- 只有安装 report 包贡献时，可继续进程内 child 才会恰好暴露一个作用域局部 `report` schema；无关 Agent 永远不会暴露该 schema。
- 工具返回 parent 消息的稳定 `MessageId`。静默投递没有 `InboxItemId`；唤醒投递会产生一个单独的 inbox 条目实例。
- 只有确切的驻留 child 才能报告，且只能报告给根据持久化谱系推导的确切在线直接 parent。服务不接受接收方参数，也不提供离线 fallback。
- 唤醒投递是校验后的默认模式：它会恰好创建一个后续 FIFO 轮次，绝不 steering 已开始的轮次。静默投递则绝不会启动 parent 请求。
- parent 接受后取消或 dispose child 不会撤回报告。接受前，child dispose、drain、parent 丢失或调用方取消都会拒绝操作。
- 新建和恢复的 Activation 都会在发布前组合当前设置贡献。新授权等待下一个 Activation 才生效，而已驻留 child 的授权撤销立即生效。
- 单元覆盖固定可见性、allow-list 行为、两种投递模式、稳定的消息与发送方身份、嵌套路由、无效发送方、缺失的 parent、取消、drain、撤销竞争，以及不存在 Task 或隐式最终报告。
- 无密钥整体组装快照证明真实 child 工具、那一个被唤醒的 parent 轮次、持久化 parent 封装，以及 parent 后续消费。

### 已接受的风险

该接受边界弱于持久化端到端投递。崩溃可能导致结果不明，重试则可能重复报告。

唤醒投递可能在嵌套 child 频繁报告时放大模型工作量。通过 `reportDelivery` 交由部署所有者控制，可以限制该风险，但无法完全消除。

注册表中的存在性就是 parent 在线信号。宿主拥有的 parent 如果已开始 `AgentHandle.dispose()` 但尚未完成其作用域清理，仍可能接受并追加一条本进程不会再处理的报告。要弥合这个缺口，需要 Agent 层面的 dispose 开始信号，不能由 subagent 层推断。
