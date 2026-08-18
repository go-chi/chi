# Agent Note: TUI 步骤计时跟在该步骤最后一条消息之后

Status: implemented
Archived: 2026-08-04

[English](2026-07-27-tui-step-timing-trails-tool-cards.md) | 中文

## 问题

每步的计时摘要（`Model wait … · Completed …`）原本是助手消息组件的子节点，因此直接渲染在助手文本下方。当某一步触发 tool call 时，tool card（工具卡片）会在助手消息*之后*追加到聊天区，使计时行被搁在它们上方——落在该步骤真正的最后一条输出之前一条消息处。该摘要本意是收束一个步骤，因此在任何含 tool call 的步骤上都出现在了错误的位置。

## 决策

计时摘要现在是独立的 `StepTimingComponent`，不再是 `AssistantMessageComponent` 的子节点。`StreamingAssistantComponent` 持有一个并以 `timing` 暴露它，但渲染器把它作为紧随助手消息之后的同级节点挂到聊天区。每当当前打开步骤的 `tool/call` 或 `tool/result` 追加一张卡片，`trailStreamingTiming()` 就把该页脚移回聊天区末尾，使它始终跟在该步骤的最后一条消息之后。在 `step/end` 时该页脚就地定稿——此时已在末尾——并在后续步骤的输出接续时保持钉住。`removeStreaming` 与推理开关重建会把该页脚连同其流式组件一起摘除并重新挂上。

事件顺序让这一点精确成立：在一个步骤内，循环会先追加 `tool/call` 和 `tool/result`，再追加 `step/end`，因此页脚是在 `streaming` 仍被设置时重新定位的，随后在步骤结束时冻结。

## 备选方案

**把计时保留在助手消息内部，改为把 tool card 排到它上方。** 否决：tool card 应位于请求它们的助手文本之后；把它们移到助手消息上方以贴在计时下方，会歪曲 transcript（文本记录）的顺序。

**为整个轮次重算一个末尾页脚，而非每步一个。** 否决：多步轮次会显示各步自己的完成计时，合并它们会丢掉现有计时测试所固定的每步分桶。

**只在 `step/end` 处理器里重新定位页脚。** 否决：tool card 在 `step/end` 之前渲染，因此仅在步骤结束时移动的页脚虽已处于末尾，却无法跟踪步骤中途的重新渲染，而且流式过程中运行态（完成前）的页脚仍会落在 tool card 上方。

## 后果

- 在含 tool call 的步骤上，计时摘要渲染在 tool card 下方，轮次运行期间与完成之后皆如此；相关包快照（`untrusted-controls`、`cordis-tools-pending`、`advanced-cards-*`、`code-mode-pending`、`dynamic-workflow-pending`、`surface-before-compaction`）与示例 transcript（`todo-plan`、`bash-terminal-card`、`code-mode`、`parallel-file-reads`、`dynamic-workflow`、`cordis-dynamic-toolchain`、`code-mode-dispatch-spill`）固定了新顺序。
- 一个单元测试断言完成计时出现在某步骤的工具输出之后；在修复前的顺序下它会失败。
