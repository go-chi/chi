# Agent Note: Subagent 生命周期丰富化——lastAssistantMessage（仅观察）

Status: implemented
Archived: 2026-07-26

[English](2026-06-30-subagent-observe-enrich.md) | 中文

## 问题

钩子子系统（[拦截 seam Agent Note](2026-06-30-interception-seams.md)）允许插件在生命周期节点观察和拦截 agent（智能体）。Claude Code 和 Codex 都暴露了 **SubagentStart / SubagentStop** 钩子，且 CC 的钩子携带 subagent 的最终消息。harness 已经发出 `subagent/start` 和 `subagent/end` 生命周期事件（[subagent 能力 seam](2026-06-21-subagent-capability-seam.md)），但其载荷极为精简（`provider`、`id`，以及 end 时的 `stopReason`），不足以让钩子桥接层在不单独访问活跃 run 的情况下报告 subagent 产出了什么。

本 Agent Note 丰富 end 载荷。它刻意限定为**仅观察**：不改变控制流，不引入 waterfall（瀑布式事件）。影响 run 的 subagent-stop 决策（续行、改变 run 的注入）属于另一个更大的重设计，不在本 Agent Note 范围内。

## 决策

**在 `SubagentRunEndInfo` 中添加 `lastAssistantMessage`——子 agent 的最终输出。** 在正常结束路径上，它是只读的类型化 `SubagentResult.output`，观察者无需持有 run 即可看到子 agent 产出了什么。在基础设施拒绝（不存在 `SubagentResult`）的情况下，该字段缺失，事件报告 `stopReason: 'error'`。提供方与监听方是受信任的同进程协作者，遵守借用不可变载荷的契约。

两个事件仍为普通 **`emit`**。异步的 `SubagentService.start()` 将结果观察附加到就绪的提供方 run 上，发出 `subagent/start`，然后返回该 run；进程内监听方因此可以通过 `ctx.agents.get(info.id)` 访问已发布的子 agent，而远程提供方无需在本地注册表中有对应条目。提供方启动被拒绝时不发出任何事件。回调保持仅观察，且逐监听方隔离确保一个异常订阅者不会阻塞活跃 run 或饿死后续监听方。

## 曾考虑的替代方案

**`agentType` subagent 类别标签**（CC 的 `subagent_type` 在 harness 中的对应物），放在请求与两个生命周期载荷上。早期草案曾包含它；评审中移除，因为它是 Claude Code 的概念，不适合我们自己的 seam（此处没有任何逻辑解释它，唯一消费方是 CC 方言桥接层）。CC 桥接层改为直接为其 SubagentStart/Stop 的 `agent_type` matcher 填入 Claude Code 自身的默认值 `"general-purpose"`，因此本 Agent Note 只交付**一项**丰富化：`lastAssistantMessage`。

**控制流式 `subagent/end`**：推迟；见下文。

## 为何仅观察，以及推迟了什么

控制流式 `subagent/end`（一个被 await 的 waterfall，返回停止/继续决策，与其他拦截 seam 一致）需要：将 `subagent/end` 从 emit 改为 waterfall、重构 `SubagentService.start` 使其在结算前 await 监听方、在进程内提供方中实现 `resume` 能力以便「继续」能真正重新运行子 agent。这属于[能力 seam Agent Note](2026-06-21-subagent-capability-seam.md) 已推迟的后台/steering（中途引导）subagent 重设计（同一个重设计还将统一 subagent 与 bash 之间的长时间运行工具处理）。本 Agent Note 交付钩子桥接层当前所需的仅观察丰富化；`FIXME(subagent-continuation)` / `TODO` 锚点标记了控制流版本在重设计发生时的落点。

## 后果

钩子桥接层（或原生插件）现在可以通过订阅既有 emit 将子 agent 的 `lastAssistantMessage` 转发给 SubagentStop 处理器，无需新的控制流接口。词汇新增记录在 [docs/core-data-structures/subagent.md](../../../../docs/core-data-structures/subagent.md)（事件行文部分）与两个 subagent README 中；catalog 已重新生成。生产行为无变化——事件触发方式与之前完全一致，end 载荷上多了一个可选字段——因此无需更新快照或 e2e 测试。
