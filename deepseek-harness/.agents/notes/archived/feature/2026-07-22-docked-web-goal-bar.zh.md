# Agent Note: 停靠式 Web 目标条

Status: implemented
Archived: 2026-08-07

[English](2026-07-22-docked-web-goal-bar.md) | 中文

## 问题

Web UI 此前没有任何目标相关的界面：目标栈已随模型工具、TUI/ACP 适配器和 `/goal` 命令交付，但浏览器客户端完全不接触它——既没有运行时动词，也没有指示器。本变更同时引入客户端目标动词（基于 RPC 的运行时会话方法）和第一个目标 UI。摆放位置遵循重新设计的前提：目标的存在感属于输入框的上下文——目标是用户即将提交的工作的属性，因此它的指示器属于 composer 上下文堆栈；[composer 上下文堆栈决策](../bug-fix/2026-07-30-composer-context-stack-order.md) 规定它在 Goal、Todo、Queue 与 composer 之间的位置。设计稿只保留一个闪光图标、一个阶段词（"Ongoing/Paused/Blocked Goal"）、截断后的目标内容，以及编辑／清除图标操作，恢复按钮仅在目标暂停时出现。

## 决策

`GoalBar`（`packages/client/ui-goal/src/client/GoalBar.tsx`）是一个由 props 驱动的自包含组件，在 composer 的 input-dock 列表中注册为第二个条目，位于 Todo 之后、Queue 之前。它采用独立的 752px 卡片，遵循 composer 的水平几何；所有可见状态均使用固定的 36px 高度，切换阶段不会改变尺寸。加载中（`goal === undefined`）、无目标（`goal === null`）和 `phase === 'complete'` 时不渲染任何内容：已完成的目标是历史记录，不是常驻界面元素。

可见性决定标签和操作：active 状态显示 "Ongoing Goal" 并提供暂停／编辑／清除；paused 状态显示 "Paused Goal"，把暂停换成一个恢复图标按钮；blocked 状态显示 "Blocked Goal"，并把 `blockedReason.message` 作为横条的 `title` 悬浮提示。创建目标的入口在 `/goal` 命令上，不在横条里。铅笔图标把横条切换为内联编辑表单，预填当前目标内容：Enter 或勾选按钮通过 `GoalBarActions.onEdit(objective)` 保存，Esc 取消，目标内容全为空白字符时保存按钮保持禁用。编辑成功后表单才会关闭；编辑失败时保留草稿，并在横条中显示错误。恢复和清除失败也显示在横条中。除此之外，清除直接调用 `onClear`，不做确认——清除会保留 durable 墓碑，没有不可恢复的损失。每次变更都会先取得一个同步的组件内 single-flight 锁，因为 React 的 pending 状态渲染无法关闭同一帧内的点击窗口。清除成功后还会立即抑制该 goal id，直到权威的 null 投影追上，因此已确认的墓碑不会留下陈旧的清除控件并再次提交 `GOAL_NOT_FOUND`；失败则释放锁，并且仍可重试。一个以目标 id 为键的 effect 会在目标身份变化时重置瞬态状态并丢弃编辑表单，因此无论已清除标记还是存留草稿，都不会影响替换目标。

`GoalBarActions` 位于 ui-goal 的槽位契约（`packages/client/ui-goal/src/client/slots.ts`），只携带实际渲染的动词：`onEdit`/`onPause`/`onResume`/`onClear`。每个回调都会异步返回显式成功／失败结果，因此 `GoalBar` 自行负责界面转换和错误显示。`apply.ts` 把它们接到运行时会话方法上；运行时会话在内部解析当前目标的 compare-and-set ref，因此 UI 不传 ref。

运行时会话通过由 host 计算的 `goal` 投影获得横条（以及未来 UI）所需的 goal 表面。历史尾页会提供完整当前值作为初始状态；持久 `agent/inbox/spliced` 插入项提交 goal 快照或 clear 墓碑时，`session/projection` 帧会更新该值，后续上下文准入与 UI 新鲜度无关。4 个实际渲染的变更动词与所有同类会话方法一样，把传输层失败折叠为 `{ ok: false }` 结果。

横条的背景色用 `--dsw-alias-interactive-bg-hover`，而不是设计稿里的字面值 `#F5F6F7`：这个半透明的悬浮灰在浅色主题的白色底上正好解析为该值，而在深色模式下能把横条从输入框卡片上衬托出来，静态的浅色 token 在深色模式下会沉进去。所有颜色都是 `--dsw-*` token。

## 测试

`packages/client/ui-goal/tests/goalbar.spec.tsx` 仅通过 props 固定这些行为：加载中／无目标／已完成时不渲染；active 横条渲染标签和目标内容并触发清除；同一帧内快速连续点击清除只会分发一次，清除成功后横条会在投影收敛前隐藏；编辑表单预填内容、拒绝空值、按 Enter 保存、按 Esc 取消，并在目标身份变化时重置；active 横条触发暂停；paused 横条触发恢复；blocked 横条暴露原因悬浮提示。组件失败路径用例证明编辑失败时保留草稿，并且编辑／恢复／清除错误持续显示在横条中且可重试。skeleton 规格测试分别挂载带与不带 `goalActions` 的 `ConversationRoot`；未定义的情形预置了一个 active 目标，因此隐藏横条的是缺失的挂载门，而不是缺失的目标。运行时会话规格测试固定折叠错误结果和投影更新。一个无密钥真实浏览器冒烟测试通过 `boot → RPC → runtime → GoalBar` 启动组装后的应用，并以内联快照记录渲染出的标签、目标内容和操作。

## 考虑过的替代方案

- **把横条放在会话头部**：不予采纳，因为重新设计的前提是目标的存在感属于输入框的上下文；头部横条会使目标与 Todo、Queue 及其限定的提示词彼此分离。
- **为 `undefined` 渲染 "Loading goal…" 占位**：不予采纳，每次打开会话横条都会闪现再坍缩，对一个不到一秒的状态来说只是界面噪音。
- **未设置目标时在横条内提供内联创建入口**：实现评审后不予采纳，创建目标的职责在 `/goal` 命令上，与模型按请求创建目标的模式一致；横条是状态指示器，不是创建入口。
- **在 `GoalBarActions` 中携带完整动词集合（含 `onComplete`）**：作为投机性泛化不予采纳，接口只携带实际渲染的动词（active 横条获得暂停操作后，`onPause` 随之加入）。

## 后果

- Web UI 中目标的存在形式是独立的 composer 上下文横条：闪光图标、阶段标签、截断的目标内容，以及暂停／编辑／清除（暂停时恢复取代暂停）——这是浏览器客户端的第一个目标界面。
- 目标变更在组件内走 single-flight；清除成功后会在投影投递收敛期间立即隐藏与其 id 完全匹配的目标，既防止重复 CAS 错误，又不会把瞬态 UI 状态视为权威。
- 运行时会话通过 RPC 暴露 goal 动词并折叠传输层错误，在打开时和 live 更新时消费 host 的持久完整 goal 投影。
- 目标内容首次可以从 UI 编辑，经由 `goal.edit`，ref 由运行时持有；完成对其他界面（`/goal`、模型工具）照常可用。
- `goal === null` 时不渲染任何内容；输入框不提供常驻的创建入口，创建是 `/goal` 命令的职责。
