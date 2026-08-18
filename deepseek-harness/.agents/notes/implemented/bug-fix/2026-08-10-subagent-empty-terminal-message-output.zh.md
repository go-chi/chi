# Agent Note: 用同一条选取规则在空终止消息后保留子代理输出

Status: implemented

[English](2026-08-10-subagent-empty-terminal-message-output.md) | 中文

## 问题

当 `max-tokens` 步骤只组装了工具调用块时，agent loop（智能体循环）会追加一条空内容的 `assistant/message`，因为 `BlockAssembler.blocks()` 会丢弃被截断的工具调用；这条消息仅记录 usage。三个消费方独立选取子 agent 的输出，并把这条 usage 记录当成输出。进程内驱动的 `readResult` 与 continuable Activation 的 `subagent/end` capture 不加过滤地选取最后一条 `assistant/message`，SDK 后端的观察器则让任何 `assistant/message` 优先于累积的文本。在被 max-tokens 截断的多步轮次中，最后那条空消息导致 `SubagentResult.output`、工具结果、遥测与 `subagent/end.lastAssistantMessage` 都漏掉真实的部分回答。进程内驱动也没有流式文本兜底，因此被取消的子 agent 若其唯一文本只存在于 `assistant/chunk` 事件中，也会报告 `[]`。

## 决策

`dsh-subagent` 在 `src/assistant-output.ts` 中拥有唯一的规范选取规则：选取最后一条非空 assistant 消息；没有时选取累积的 `text-delta` 流；忽略空内容消息。增量的 `AssistantOutputFold` 通过 `push(event)` 处理会话事件传输，通过 `pushText(text)` 处理仅分片传输，并通过 `collect()` 完成选取。`finalAssistantOutput(events)` 把规则应用于完整的事件后缀，供进程内 `readResult` 与 Activation capture 使用。SDK 后端折叠通知事件；ACP 后端不暴露完整的 assistant 消息，而是折叠原始分片文本。`SubagentResult.output` 定义结果约定，`subagent/end.lastAssistantMessage` 使用同一规则。子 agent 不产生这两种输出中的任何一种时，一次性与 continuable 运行的生命周期字段都会缺省，而不是空数组。`max-tokens` 或 `aborted` 结果保留实际的终止原因。

前台委派工具使用同一选取规则。非 `completed` 的结果仍是 `isError` 工具结果，但其消息会在终止原因标题之后附上子 agent 的部分文本，让父模型同时接收失败信息与已有输出。

## 验证

无密钥 SDK 后端测试使用 `FAKE_EMPTY_MESSAGE` 发出一条仅记录 usage 的终止消息。`subagent-max-tokens-partial` ACP 快照记录一个子 agent：它流式输出文本与一次工具调用，结束于仅含工具调用的 max-tokens 步骤，持久化日志中含一条空的 usage 消息，并通过父侧的错误工具结果返回部分文本。单元覆盖检查空终止消息、取消、消息顺序、不含文本的非空消息，以及排除工具结果内容。

## 考虑过的替代方案

**各消费方就地修复、不抽共享辅助函数。** 之所以否决：三处独立选取已发生分歧，而同一次运行的观察方必须对其输出达成一致。

**让 loop 不再追加空消息。** 之所以否决：这条消息记录 usage，并在持久化日志中保留该步骤（"model-visible ⟺ logged"）；为处理输出选取而改动会话事件，会影响所有 replay 与 projection 消费方。

**把空内容消息视为错误。** 之所以否决：流式文本才是子代理真实的部分回答，且终止原因已经告诉消费方轮次被截断。

## 后果

被 max-tokens 截断的多步子 agent 会报告其更早的文本；被取消的进程内子 agent 保留中止前已流式的文本；一次性与 continuable 的 `subagent/end` 事件同 `SubagentResult.output` 一致。内容非空但不含文本的消息（例如仅含 reasoning 的内容）仍然优先于流式文本，因为规则检查内容长度，而不是文本是否存在。非空消息同样优先于其后才流式出的文本：子 agent 在流式输出后续步骤时被取消，报告的是更早那条完整消息，终止原因则记录该截断。
