# Agent Note: Trajectory 步骤单元格与轮次列表 chrome

Status: implemented
Archived: 2026-07-26

[English](2026-07-23-trajectory-step-cell.md) | 中文

## Problem

trajectory 标签页需要可复用的步骤行与轮次列表 chrome，以展示展开后的 assistant 块、自身耗时、Message token 列，以及进行中的工作。若不将会话事件时间折叠进会话节点，并将块展开为单元格，UI 就无法对齐产品 chrome。

## Decision

[`@deepseek-ai/dsh-client-ui-trajectory`](../../../../packages/client/ui-trajectory/README.md) 拥有展示型 trajectory 列表 chrome：

- [`TrajectoryCell`](../../../../packages/client/ui-trajectory/src/client/TrajectoryCell.tsx) — 高 38px 的步骤行，类型为 User / Message / Tool（无 Think、Call、Result 行）。reasoning 块跳过（无块级时钟）。每对 `tool-call` + `tool-result` 折成一行 Tool（`name ·` 加截断参数），Time 在两端皆知时为 `result.time − callTime`。Message 行携带来自 `assistant.usage` 的 Input/Output/Think token 列。自身耗时 Time 使用 `+Ns` / `+N.1s`，缺失时为 `—`。选中态绘制 2px 内嵌的 `--dsw-alias-brand-primary-new-colorprimary-new-color` 环（`selected` prop），且未接线到 chat 选中。
- [`TrajectoryTurn`](../../../../packages/client/ui-trajectory/src/client/TrajectoryTurn.tsx) / header / group header — 粘性 Turn 条背景通栏铺 `ghost-active-fill`；标题／列标与 Message/Step 主体落在居中的 `max-width: 880px` 内容道。单元格右侧列与 Turn 标头共用几何（`320 = 4×71 + 3×12`）；cell pad 20/8。
- [`deriveTrajectoryLayout`](../../../../packages/client/ui-trajectory/src/client/layout.ts) 将 assistant `blocks[]` 展开为单元格，按 `callId` 将 tool-call 与 tool-result 配对为 Tool，折叠 `partial` 与 `runningCalls`（去重），仅将用量挂在 Message 上（含无 text 块时的空回退行），并以墙钟跨度 + 工具直方图构建分组描述（`1.5s bash×6`）。`user/message` 无线上 turn，故每条 User 行归入下一 assistant/steering 的 turn，否则归入进行中的 `partial` turn，否则为 `lastAssistantTurn + 1`（或 `1`）。context 节点不产出单元格，但仍推进 Message 耗时游标。

[`ConversationNode`](../../../../packages/client/runtime/src/client/sessions/conversation.ts) 携带来自 `SessionEvent.time` 的 `time`；`ToolResultNode.callTime` 与 `RunningToolCall.time` 来自配对的 `tool/call`。耗时规则：User 为 `+0s`；Message = assistant.time − 上一表面时间（含跳过的 context）；Tool = 在两者皆知时 result.time − callTime；进行中 Tool = `—`。分组标头耗时为组内最早→最晚绝对时间（墙钟跨度；Tool 贡献起点与起点+自身耗时）。

## Alternatives considered

**为 reasoning 块保留 Think 单元格。** 否决：单条 `assistant/message.time` 无法给出 Think 自身耗时（除非上 chunk 级时钟）；与其显示 `—`，不如省略该行。

**保留分开的 Call 与 Result 行。** 否决：Result 没有可展示的自身耗时；一行 Tool 承载 call→result 区间。

**自会话／轮次起点累计耗时。** 否决；Time 列是每行自身的耗时。

**将用量挂在展开后的第一行。** 否决；用量仅附着于 Message。

**用 Date.now() 显示进行中工具的耗时。** 延后；进行中的 Time 保持为 `—`。

## Consequences

一旦 fold 发出 `time`，Trajectory 标签页即可渲染带自身耗时的已定稿与进行中展开行。行为导向的覆盖位于 `packages/client/ui-trajectory/tests/{cell,layout,views}.spec.tsx`。chat 选中深链与更细的块级时钟仍延后。
