# Agent Note: TUI 隐藏模式把一个轮次的 assistant 步骤折叠为一条消息

Status: implemented
Archived: 2026-08-04

[English](2026-07-29-tui-hidden-mode-assistant-fold.md) | 中文

## 问题

Ctrl+O 的隐藏阶段（[整合的 TUI 展示](../architecture/2026-07-28-consolidated-tui-presentation.md)）去掉工具卡片，让 transcript（文本记录）读作一段对话，但每个模型步骤仍渲染自己的 `Assistant` 标题。因此一个多步骤轮次（文本 → 工具 → 文本）会显示多个连续、之间空无一物的 `Assistant` 区块——被移除的工具卡片正是重复标题曾经的唯一理由。Codex 风格的纯对话阅读需要每轮次一条 assistant 消息。

## 决定

隐藏模式同时也是一条折叠规则，且纯粹作为 TUI 展示实现：在每个轮次内，第一个渲染内容可见（有文本，或在 reasoning 显示开启时有 reasoning）的步骤拥有该轮次唯一的 `Assistant` 标题；其余步骤渲染为无标题的续段，没有可见正文的步骤则完全不渲染——仅有工具调用的步骤既不占用标题，也不留下空白段。折叠与展开阶段保留每步各自的标题；离开隐藏阶段会恢复它们。

机制：`StreamingAssistantComponent` 携带自己的 `StepPosition` 和一个 `setFoldedContinuation` 展示标志；`createTuiChat` 维护每轮次的步骤组件列表，并在 Ctrl+O、每个流式 text/reasoning chunk、消息结算，以及失败流被撤回（可能把标题移交给下一个步骤）时重新推导折叠。transcript 重建会清空该映射并重放日志，因此恢复、压缩替换、调整尺寸和主题切换收敛到同一折叠结果。步骤计时页脚保持按步骤归属，不受影响。

## 考虑过的替代方案

- **把多个步骤合并为一个组件**——与按步骤的流式生命周期、重试撤回和计时页脚冲突；在现有组件上加标志只改变标题与前导间距。
- **在会话日志或 `deriveMessages` 中折叠**——为一种 UI 阅读模式改变持久 / 模型可见的历史；日志保持按步骤的形状。
- **所有可见性阶段都折叠**——折叠 / 展开阶段在步骤之间穿插工具卡片，此时每步的标题用来划分哪段输出属于哪个步骤。

## 后果

隐藏模式现在每轮次读作一条 assistant 消息；轮次之间仍由各自的标题分隔。折叠是重新计算的状态，从不存储，因此会话与持久化格式没有变化。覆盖：TUI 单元测试覆盖 Ctrl+O 循环的标题计数、仅工具的首步骤标题移交、按轮次分隔，以及实时流式 + 重建收敛；无密钥快照 `tool-cards-hidden-folded` 固定折叠后的帧。
