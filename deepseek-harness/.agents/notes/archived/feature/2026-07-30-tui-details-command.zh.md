# Agent Note: 用于 transcript 细节状态的 /details 命令

Status: implemented
Archived: 2026-08-04

[English](2026-07-30-tui-details-command.md) | 中文

## Problem

TUI 的 transcript（文本记录）细节状态——工具卡片可见性（`collapsed`/`expanded`/`hidden`，见[整合的 TUI 展示](../architecture/2026-07-28-consolidated-tui-presentation.md)）与 reasoning 块显示——过去只能通过 Ctrl+O 循环和 Ctrl+R 切换来触达。想要某个特定模式的用户必须循环经过其他模式，无法一次操作同时设置两个维度，也无法查询当前状态；吞掉这些控制键的终端更是完全没有替代途径。

## Decision

`dsh-tui` 在其他 agent 作用域命令旁注册 `/details`。裸 `/details` 打开 `DetailsDialog`：一个居中的键盘开关，每个维度一个条目——`Tool cards` 与 `Reasoning`——显示实时值：Tab 循环高亮条目并立即应用变更，对话框背后的 transcript 即是预览，Enter、Esc 或 Ctrl+C 关闭；其宽度由配置键 `detailsDialogWidth` 决定，选择器打开时再次执行 `/details` 会替换它，与 `/model` 浮层一致。参数直接命名目标状态：`collapsed|expanded|hidden` 让工具卡片跳到该阶段，`reasoning on|off` 设置 reasoning 显示，裸 `reasoning` 切换它，且指令可在一次调用中组合。未知 token 返回携带用法行的命令错误。每个入口改动的都是与快捷键相同的闭包状态，重构后循环与切换成为 `setToolsVisibility`/`setReasoning` 之上的薄封装；快捷键及其通知保持不变。

组合调用先应用 reasoning 再应用可见性，因为 `setReasoning` 会从会话事件重建 transcript，而重建会丢弃非持久的通知组件；若最后才应用它，会抹掉刚追加的可见性通知。

reasoning 重建暴露了一个重放缺陷，本变更在 `renderEvent` 中修复：实时路径会在同一步骤的后续 `assistant/message` 之前清除已结算的 `StreamingAssistantComponent`（因此第二条消息获得新组件），但 `rebuildTranscript` 重放复用了已结算组件，`settle()` 覆盖其内容，静默丢掉了前一条消息的文本。已结算检查现在位于 `renderEvent` 的 `assistant/message` 分支——两条路径共用一个归属地——此前错误的 `untrusted-controls` 快照（reasoning 与文本被丢弃后只剩空 `Assistant` 标题）已重录为包含内容的版本。

## Alternatives considered

**裸 `/details` 像 Ctrl+O 一样循环。** 否决：命令相对快捷键的价值在于命名绝对状态；循环命令只是按键更多的快捷键，裸调用作为选择器更有用——它在展示当前状态的同时提供所有目标。

**裸 `/details` 仅输出文本状态报告。** 首版如此实现，后被选择器取代：报告回答了“我在哪”，但改变任何东西仍需第二次、拼写参数的调用；选择器展示同样的状态并在一次交互中应用变更。文本语法保留给脚本、肌肉记忆和两维组合变更。

**拆分 `/tools` 与 `/reasoning` 两个命令。** 否决：两个维度同属一个展示关注点（“transcript 显示多少细节”），单一命令让注册表与 `/help` 列表更小，同时允许一次组合调用。

**按模式提供配置键默认值。** 超出范围：`showReasoning` 已作为配置存在；命令是其上的运行时状态，与快捷键一致。

## Consequences

- 用户可以跳到任意细节模式、一次设置两个维度，并在选择器中看到当前状态——包括在拦截 Ctrl+O/Ctrl+R 的终端上。
- 解析器接受无序 token，因此 `/details reasoning expanded` 会切换 reasoning 并展开卡片；每个维度以最后一个指令为准。这一宽松是刻意的，并记录在 README 中。
- 选择器没有待定状态与取消：每次 Tab 都是已生效、已通知的真实变更，关闭从不回退。循环过头的用户继续 Tab 到想要的值即可。
- 当一个步骤携带多条 `assistant/message` 事件时，transcript 重建不再丢失 assistant 消息；`details-command` 快照固定参数表面与修复后的重放，`details-selector` 固定 Tab 将 `hidden` 应用为 `collapsed` 后仍打开的开关，包括其背后恢复显示的工具卡片。
