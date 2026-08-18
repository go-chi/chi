# Agent Note: Assistant timing line renders after the message body

Status: implemented
Archived: 2026-08-04

[English](2026-07-27-assistant-timing-header-trailing.md) | 中文

## Problem

TUI 的助手消息此前以一行开头，把 `Assistant` 标签和步骤计时串拼在一起（`Assistant · Model wait 0.0s · Completed …`）。计时放在正文之前，使耗时数据远离它所描述的回答；一旦完成，回复的首行还被读者会略过的元数据行压在下面。

## Decision

**把标签与计时拆开；计时作为消息的末行渲染。**

`AssistantMessageComponent`（packages/ui/tui/src/index.ts）现在把加粗的 `Assistant` 标签作为首行，并把暗色的计时串（仍由 `StreamingAssistantComponent.rebuild()` 组装为 `header`，settled 时含 `· Completed …` 后缀）作为最后一个子节点，追加在 reasoning 与正文之后。计时内容、隐藏零值桶以及完成时间的行为均不变——仅位置从消息顶部移到底部。

## Alternatives considered

**把整行表头（含标签）都移到末尾。** 否决：`Assistant` 标签让读者知道是谁在说话，应与 `You` 标签一样置顶；只有计时这类元数据才受益于置底。

**计时仍内联，但作为标签下方的第二行置顶。** 否决：这仍把耗时数据与完成的回答分离，并在提示与回复之间保留两行元数据。

## Consequences

每条助手消息按 标签 → reasoning → 回答 → 计时 阅读，完成计时紧挨它所度量的回复。无密钥的 TUI 快照套件已刷新，在每个 fixture 中固定新布局；`tui.spec.ts` 中四处原先匹配旧内联串 `Assistant · Model wait …` 的断言，现改为分别断言标签与计时，因为两者不再连续渲染。
