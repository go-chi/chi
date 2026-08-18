# Agent Note: TUI 为每种轮次结束 kind 呈现原因

Status: implemented
Archived: 2026-08-04

[English](2026-07-24-tui-turn-end-stop-reason-notices.md) | 中文

## 问题

TUI 会为 `error`、`aborted`、`max-tokens`、`rejected`、`interrupted` 这几种轮次结束渲染 transcript（文本记录）通知，但 `disposed` 轮次结束和任何插件新增的 `TurnEndReasonMap` kind 不渲染任何内容。此类轮次结束时，无论实时发生还是从持久化日志回放，agent（智能体）都会在没有任何可见原因的情况下停止工作，违背了「每次停止都要向用户解释」的产品预期。

## 决策

`packages/ui/tui/src/index.ts` 中的 `turn/end` 分支按 reason 的判别字段做 switch，覆盖每一种 kind：`completed` 保持沉默，因为已定稿的助手消息及其 `Completed` 计时头部已经呈现了这一结果；`disposed` 追加 `Turn stopped: the agent was disposed.`；merge 扩展的 default 分支追加 `Turn ended: <kind>.`，让未知的插件新增结果仍能点明 agent 停止的原因。其余各 kind 保留现有通知。

## 备选方案

**为 `completed` 轮次也加一条通知。** 否决，属于噪音：每次普通响应都会平添一行冗余内容，而助手消息加上已冻结的计时头部本就标示了完成。

**因为 `agent/disposed` 也会追加 `Agent "<id>" was disposed.`，就在实时场景下抑制 `disposed` 轮次结束通知。** 否决：两条通知陈述的是不同事实（前者说明这一轮被中途截断，后者说明 agent 已不复存在），而且只有轮次结束通知在回放持久化日志时得以保留，实时发出的 `agent/disposed` 不会在回放中重现。

**让 default 分支保持沉默（沿用先前行为）。** 否决：TUI 不认识的 merge 扩展 kind，恰恰是用户没有其他途径得知 agent 为何停止的情形。

## 后果

- 在 TUI 中，轮次结束永远不会缺少用户可见的原因：每种非 `completed` 的 `turn/end` kind 都会追加一条 transcript 通知，未知的插件新增 kind 也会按名称列明。
- 轮次运行期间实时 dispose（资源释放）会显示两条通知（轮次结束通知加上 `agent/disposed`）；回放日志则只显示轮次结束通知。
- `errors-and-help` 快照把 `disposed` 通知和未知 kind 通知连同现有的失败与中断通知一并固定下来。
