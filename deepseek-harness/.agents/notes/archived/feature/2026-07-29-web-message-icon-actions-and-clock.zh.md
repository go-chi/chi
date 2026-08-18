# Agent Note: Web 消息 IconActions 与时钟

Status: implemented
Archived: 2026-08-07

[English](2026-07-29-web-message-icon-actions-and-clock.md) | 中文

## 问题

Web 聊天的用户气泡已有复制、分支、编辑 IconActions，但没有时钟。已定稿的 assistant 叙述下方完全没有操作栏，尽管 harness 设计稿在回答结束后展示复制、分支、时钟。流式回复不得在逐 token 输出期间闪现该操作栏。经 memo 优化的行在跨午夜时仍保持稳定 props，因此一次性的 `Date.now()` 会让昨日消息一直卡在 `HH:mm`。

## 决策

**用户气泡在既有 IconActions 行的开头添加感知日期的本地时钟；每个轮次中最后一条带 text 内容的 assistant 在正文下追加带 `margin-top: 16px` 的复制、分支、时钟；两边只要挂载就保持可见，并在下一个本地午夜重新格式化。**

assistant 一侧的座位由[已完成轮次决策](../bug-fix/2026-08-05-turn-tail-actions-require-a-completed-turn.md)收紧：只有存在 `turn/end` 的轮次才授予该行，仍在产出步骤的轮次不把该行交给任何节点。user 一侧的分支控件被 [user 气泡分支移除决策](../simplification/2026-08-06-user-bubbles-drop-the-branch-action.md)直接移除；user 行的 IconActions 只有时钟与复制。

两边都通过 `formatMessageClock` 格式化 `node.time`：同一日历日 → `HH:mm`，同年更早 → `M月D日 HH:mm`，跨年 → `YYYY年M月D日 HH:mm`。`useCalendarDay` 是组件本地的日刻度（定时到下一个本地午夜），因此 memo 行在日历日变化时会重渲染，且不新增框架钩子。`MessageItem` 把标签放在复制之前（figma `388:20051`）。`ChatView` 通过 `assistantActionsSeqs` 推导轮次尾部的 seq，并不为轮次中间的内容传入 `time`；`AssistantMarkdown` 把该行放在分支之后（figma `43:32997`），且仅在 `streaming` 为 false、已知事件时间、且节点含非空 text 内容时渲染。纯 Think 节点、轮次中间的叙述与流式尾部省略该行。复制写入拼接后的 text 块。两种消息行都把自己的事件 `seq` 交给同一个 fork 回调；真实 mutation 契约由 [Web session fork 操作](2026-07-27-web-session-fork-actions.md)定义。剪贴板写入与时钟辅助函数放在 `message-chrome.ts`。组装后的界面由 `apps/web/tests/message-actions.e2e.ts`（冷 seed 历史 + aria golden）钉住；aria 归一化把每种时钟形态折叠为 `{{clock}}`。

## 曾考虑的方案

**在流式过程中展示 assistant IconActions。** 否决：需求是输出完成后才展示该行；中途 chrome 会闪烁，并诱使复制半截回答。

**给每个已定稿 assistant 节点（含纯 Think）都挂 IconActions。** 否决：没有 text 内容时复制没有可写内容，且在每一步／Think 下重复 chrome 会打乱流程；只有内容输出拥有该座位。

**给多步骤轮次中的每一条带 text 内容的 assistant 都挂 IconActions。** 否决：轮次中间的叙述（工具调用前的 text）不是已定稿答案；在每一步下重复复制、分支、时钟会打乱流程。只有该轮次中最后一条内容 assistant 拥有该座位。

**在具备 hover 能力的指针上用 hover 才揭示操作行。** 否决：行一旦存在就应保持可发现；用 opacity 隐藏容易漏看，且需要父级 hover 选择器重复挂载门控。

**由 IconActions 决策同时定义 session fork 语义。** 否决：本笔记只拥有消息 chrome、时钟与挂载门控；边界选择、失败行为和切换语义属于独立的 [Web session fork 操作](2026-07-27-web-session-fork-actions.md)，避免展示组件成为 session mutation 的第二正家。

**通过 chat store 或 inject 钩子发布日历日。** 否决：日刻度只是展示层本地状态，没有跨入口消费方；组件本地 timeout 符合「行为钩子可拥有不订阅外部源的状态」这一客户端规则。

## 后果

每个轮次中最后一条已定稿的内容回答在行挂载后立刻暴露复制、分支与事件时钟；轮次中间的内容与纯 Think 节点不带 chrome。用户与 assistant 时钟共用同一套跨天、跨年加宽规则，并在午夜后无需消息变更即可刷新。逐消息分页仍是包 README 中记录的暂缓 footer 功能位。包级测试钉住三种时钟形态、午夜加宽、assistant 仅内容门控、轮次尾部 seq 门控，以及 user/assistant 分支按钮各自传递的事件 `seq`；Web e2e 场景钉住组装后的 IconActions chrome。
