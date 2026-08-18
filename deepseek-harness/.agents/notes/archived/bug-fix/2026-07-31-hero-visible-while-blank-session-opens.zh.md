# Agent Note: 空白会话打开期间保持 hero 可见

Status: implemented
Archived: 2026-08-07

[English](2026-07-31-hero-visible-while-blank-session-opens.md) | 中文

## 问题

会话根节点为"正在打开且 composer 处于 `blank`"的会话保留了一个 `settling` 阶段：在历史记录返回之前，hero 与 docked 的归属不可知，因此宁可隐藏 composer 座位（`visibility:hidden`），也不要先闪出居中的 hero 再跳到底部输入条。启动时的自动选择把这道防护变成了它本要防止的缺陷。从无工作区的 hero 进入时，`WorkspacesService.startInitialSelection` 会连接最近的工作区并打开其空白会话；`open()` 一落地 `openState` 立即翻为 `loading`，中间栏因此在整个历史往返期间保持空白，随后重绘一次——每次启动看起来都像整页刷新。

## 决策

`ConversationRoot` 在读取会话快照的同时读取会话列表摘要的 `blank` 标志，并让"摘要已证明为空白"的会话豁免 settling：`settling` 额外要求 `summaryBlank !== true`，而 `hero` 在摘要证明会话为空白时接受处于 blank 的 composer——覆盖全部 open state，而非仅 `loading`。列表已报告为空白的会话只可能落到 hero，因此隐藏毫无收益，只换来一次可见闪烁；同一份证明在打开开始之前（`cold`）与打开失败之后（`error`）同样成立，而此前的条件会在这两种状态下落到 active 阶段，在 `ConversationSession` 为空白会话隐藏的外壳之下渲染出一条停靠的裸 composer。只要摘要没有证明会话为空白——无论是报告 `blank: false` 的行，还是列表尚未跟上因而根本没有该行——`summaryBlank` 都不为 `true`，保守的 settling 隐藏行为保持不变。

摘要标志与快照自身的 `blank` 是两个不同来源：快照描述正在打开的这个会话，摘要则是在打开操作完成之前就已存在的列表行。只有后者足够早，可用于决定阶段。

## 备选方案

**彻底移除 settling 阶段。** 否决，因为对没有摘要行的会话它仍有价值：在缺少任何关于"是否为空"的先验断言时，hero 与 docked 的归属确实不可知，而它所防止的那种闪烁更糟糕。

**推迟 `loading` 的翻转，直到历史返回。** 否决，因为 `openState` 是打开操作的权威状态；为了压制一个呈现层瑕疵而推迟它，会向其他所有消费者误报数据状态。

**为 settling 的隐藏加交叉淡入或其他动画。** 否决，因为无论如何该栏在往返期间都没有内容可展示——正确的修复是不隐藏结局已知的内容，而不是把隐藏装饰得好看些。

## 推迟事项

诊断期间发现的对象层引用抖动——空操作投影铸造出新的快照、创建路径重复投影一次、`select()` 在异步续体中使用 `notifyNow`——确实存在，但与这次可见闪烁相互独立。

## 影响

启动自动选择会立即渲染 hero，并在整个历史往返期间保持 composer 座位与 header 可见，因此启动进入最近工作区不再像页面重载。摘要未证明为空白的会话保持原有的 settling 行为，这道防护仍覆盖它当初针对的场景。骨架测试固定了摘要的三种形态：报告 `blank: false` 的行进入 settling；根本没有该行同样进入 settling；摘要已证明为空白的会话在 `loading` 期间渲染 hero 外壳与可用的文本框。

组装级覆盖是 `apps/web/tests/startup-auto-selection.e2e.ts`（无密钥的 Web 浏览器泳道）。首次连接 Workspace 时，它断言 blank Session 出现前后 Hero root、Workspace chip、滚动主体、composer seat 与 textarea 都是同一 DOM 节点。随后它在浏览器网络边界上扣住 `session.history` 的响应，并在自动选择的打开仍在飞行途中断言可见画面——hero 阶段、hero 标题、已绘制的 composer——外加整次加载记录到的阶段时间线恰好为 `['hero']`。扣住这次往返正是第二个用例成为回归测试而非竞态的原因：对着回环主机，打开会快到无从采样；而一旦回退这条豁免，被扣住的这段窗口恰恰就是根节点报告 `settling` 的时刻。
