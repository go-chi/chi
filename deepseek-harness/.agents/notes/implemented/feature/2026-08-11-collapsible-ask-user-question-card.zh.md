# Agent Note: 可收起的提问卡片

Status: implemented

[English](2026-08-11-collapsible-ask-user-question-card.md) | 中文

## Problem

`dsh` 的 ask-user 接管界面把待回答的问题组渲染为底部卡片，高度上限为 `min(60vh, 520px)`；当问题批次较长、或用户想先阅读上方的会话记录再决定时，卡片会占满大部分视口且无法缩小——上方会话几乎被遮住，只能看到顶部几行。

## Decision

在提问卡片头部（现有的"放弃整组问题"按钮旁）增加收起/展开切换按钮。收起时隐藏选项主体和底部操作区，只保留一条头部（eyebrow、标题、两个图标按钮），用户仍能看到"有未答问题"的信号；展开后恢复完整卡片。

- 状态存放在 `QuestionFlow` 的本地 state（`minimized`），因此收起/展开不会丢失草稿和当前题目索引——已选答案仍可直接提交。
- 切换按钮使用 `IconChevronDownOutline14` / `IconChevronUpOutline14`，复用现有 24px 图标按钮网格；`aria-expanded` 反映卡片状态，文案在 `nav.minimize` / `nav.maximize` 之间切换（收起后按钮对读屏器显示为"展开"）。
- 收起时选项主体和底部通过 `{!minimized && ...}` 卸载，a11y 树中不残留隐藏的可交互面。
- 提交/取消进行中（`busy !== null`）时收起按钮禁用，与现有放弃按钮的守卫一致。
- CSS：`.cardMinimized` 去掉 `max-height` 上限并隐藏 `.body` / `.footer`；`.header` 增加底部 padding，避免折叠后过于局促。
- 范围：只有通用提问流（`QuestionFlow`）获得该切换。计划评审卡片（`PlanReviewPanel`）是另一种形态（对一个计划做一次决策），保持现有布局。

## Consequences

- 用户可以缩小提问卡片以阅读会话，再展开作答——草稿和位置因状态存放在流程组件中而得以保留。
- 收起动作紧邻放弃按钮，二者共用图标按钮样式，头部保持平衡。
- 新增产品文案仅落在 `question` locale 命名空间（`nav.minimize` / `nav.maximize`），按字典契约中英成对。

## Alternatives considered

- **滚动时自动收起**：用户滚动会话时自动折叠卡片可以省空间，但会在交互中途与用户对抗，并意外隐藏"待答问题"信号；显式切换把决定权交给用户。
- **可拖拽调整大小**：拖拽手柄让用户自由调整卡片大小，但比需求所需的机制更复杂，也没有解决"让卡片完全让开"的诉求。
- **按会话持久化折叠状态**：锦上添花，但提问是单次交互；持久化引入存储与同步复杂度，对这个界面没有明确收益。
