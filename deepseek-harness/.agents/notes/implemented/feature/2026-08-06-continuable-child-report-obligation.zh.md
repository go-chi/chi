# Agent Note: 可继续 child 的返回通道是一项义务

Status: implemented

[English](2026-08-06-continuable-child-report-obligation.md) | 中文

## 问题

可继续后台 child 拥有自己的 Session，因此它写在那里的任何内容都不会到达启动它的 agent。[report 工具](2026-07-30-continuable-subagent-report-tool.md)为该 child 提供了一条返回通道，却把它呈现为若干选项之一：schema 里写着「可调用零次或多次」，child 的提示词中没有任何地方要求它调用该工具，而已采纳的默认调度（`quiet`）会把报告加入已停驻 parent 的下一次请求，却不唤醒它。

这些选择单独看都站得住脚。合在一起，它们让这条返回通道无法作为委派契约使用。一个完成工作、把答案写进自己 transcript（文本记录）随后停止的 child，会让 parent 一无所获；而确实上报了的 child，面对的是一个已经停驻、要等到别的事件把它唤醒才会读到报告的 parent。外部反馈中的 parent 忙轮询 `list_agents`、反复向已结算 child 发送消息、以及放弃 `subagent` 改用 `workflow`，都可归结为同一处缺失的保证。

## 决策

返回通道是 child 收到的一条指令，而不是它需要自行发现的能力。report 包会向每个可继续进程内 child 安装两项作用域局部注册，并由同一个 disposer 撤销两者：

- `report` 工具，其描述现在说明 child 要在结束前调用一次并给出自足的最终结果，并在部分进展会改变 parent 下一步动作时提前调用；
- 一个 order 为 117 的 `tool:report` 系统提示词 section，用 child 自己的语气承载同一条义务，使从不细读工具描述的 child 仍能收到它。

`reportDelivery` 的默认值现在是 `wakeup`。一条被接受的报告恰好创建一个普通的后续 parent 轮次并唤醒停驻的 parent 驱动；它仍然绝不 steering（中途引导）已开始的轮次。对于宁可让报告无人阅读也要避免轮次放大的部署，`quiet` 依旧可用。

### 为什么 section 与描述同时存在

两者针对不同的失效模式。工具描述是在模型已经在考虑 `report` 时被读到的；提示词 section 是在它判断自己是否已经完成时被读到的。这条义务必须同时出现在两处，因为本次修复的失效——child 直接停下——发生在第二处。

该 section 注册在 child 自己的作用域上，与[child 组合](../../../../packages/subagent/subagent/src/child-agent.ts)为遮蔽式 persona 已经使用的机制相同，因此 parent 与所有同级都看不到该工具与该指引。工具注册失败时，`installReportTool` 会回滚该 section；它返回的 disposer 会先尝试撤销两项注册，再抛出清理失败。

### 是指令，不是强制

没有任何东西会拒绝一个从不上报的 child。没有任何运行时路径会检查是否发送过报告，`report` 仍接受一个轮次中调用零次或多次。本次改动是面向模型的措辞加上一个调度默认值；服务权限、确认与恢复契约都保持不变。

这条边界是刻意划定的：提示词文本只能到达仍在运行自身循环的 child。被错误、token 上限、取消或拆卸终止的 child 根本没有机会遵守，因此运行时会自己记录结算这件事，而不是信任这条指令（见[由管理器负责的结算投递](2026-08-06-manager-owned-subagent-settlement-delivery.md)）。

### 快照覆盖

整体组装的 ACP `subagent-report` 场景现在演练随附的默认行为：child 上报，停驻的 parent 就该报告执行一个普通轮次，随后的提示词仍能从持久化日志中把报告读回来。由于该 child 的作用域现在组合出类别 pin 无法描述的提示词，快照 harness 新增了 `pinsChildSystemPrompts`，它与既有 `pinsChildToolSchemas` 完全对称：把一个 child fixture 的提示词移入 `system-prompt.<n>.expected.md`，其余请求 header 字段仍归类别 pin 所有，要求 sidecar 恰好在声明时存在，并拒绝与该类别 pin 完全相同的 sidecar，使冗余副本无法悄悄漂移。

## 备选方案

**保留 `quiet` 作为默认值，只依赖提示词。** 这曾是随附的立场，而它本身什么也没有解决：一条 parent 从不阅读的报告，与一条从未发送的报告无法区分。[report 工具 Agent Note](2026-07-30-continuable-subagent-report-tool.md)对「始终唤醒」的否决，前提是 parent 还有别的理由去查看自己的上下文；已停驻的后台协调者并没有。轮次放大才是真正的代价，而它现在是 `quiet` 仍然保留的理由，而不是它作为默认值的理由。

**让 child 按调用选择投递模式。** 与最初的否决相同：模型将掌握调度压力，行为也会随调用而非随部署变化。

**只把义务写在工具描述里。** 描述是在从多个工具中选择时被读到的。本次改动针对的 child 并不在选择工具，它认为自己已经做完了。提示词指引才是能触及该判断的界面。

**在结算时拒绝沉默的 child，以此强制该义务。** 没有什么可以拒绝：当结算可被观察时 child 的循环已经结束，让它的拆卸失败只会毁掉工作而不会送达结果。由运行时无条件投递终止事实才是这一情形的答案，而它属于继续执行管理器，不属于本包。

## 后果

- 加载本包后，每个可继续进程内 child 的每次请求都会多出一个提示词 section 和一段更长的 `report` 描述；其他任何 Agent 的请求都不变。
- 默认部署会为每条被接受的报告唤醒 parent 一次。频繁上报的嵌套树会消耗额外的 parent 轮次；`quiet` 是有文档记载的退路。
- `installReportTool` 需要 child 作用域中的 `ctx.systemPrompt`，因此本包在 `inject` 中声明 `systemPrompt`，从而在加载时失败，而不是等到下一次 child 物化时。
- 单元覆盖固定了新默认值、两处关键指令措辞、该 section 相对 parent 与同级均仅限 child 的作用域，以及两项注册在安装回滚或撤销时的清理。
- 三个带可继续 child 的整体组装 ACP 场景通过新的 sidecar 逐字固定完整的 child 提示词；今后任何对 child 作用域 section 的改动都会让这些场景失败，而不是悄悄通过。

### 已接受的风险

默认唤醒会在深层树中放大模型工作量。部署通过 `reportDelivery` 掌握该取舍，且放大幅度以每条被接受报告一个轮次为界。

child 仍可能不上报就结束，本次改动无法检测这一点。只有运行时自己的[结算记账](2026-08-06-manager-owned-subagent-settlement-delivery.md)才能补上这一情形。
