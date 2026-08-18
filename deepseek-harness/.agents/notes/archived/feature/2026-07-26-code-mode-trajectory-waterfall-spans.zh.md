# Agent Note: trajectory 与 waterfall 视图中的 Code Mode 子调用

Status: implemented
Archived: 2026-07-28

[English](2026-07-26-code-mode-trajectory-waterfall-spans.md) | 中文

> 范围：Code Mode UI 堆叠 PR（Pull Request）链的最后一个 PR，涵盖两个非 chat 视图中的子分发渲染。chat 的嵌套归[子调用行 Agent Note](2026-07-26-code-mode-chat-subcall-rows.md)所有；本篇所消费的计时即[实时并行 Agent Note](2026-07-26-code-mode-live-parallel-dispatch.md)的 start/settle 事件对。

## 问题

trajectory 过去仍把一个 `run_code` 轮次渲染为单个不透明的 Tool 单元格，waterfall 则渲染为一根节点计数条。chat 视图在此前的几个 PR 中已获得嵌套子行，但这两个分析视图（其全部意义恰恰是结构与计时）过去既不显示任何子调用结构，也不显示分发事件对如今已记录的逐子调用墙钟时间。waterfall 的子调用 span 曾被刻意推迟到该事件对存在之后：没有真实计时的 span 就是在撒谎。

## 决策

**trajectory：`subtool` 单元格穿插在其父 Tool 单元格之后。waterfall：所属轮次行之下、带真实计时的子泳道（sub-lane）。**

- **trajectory**：布局 fold 接收快照的 `codeDispatches` 索引；凡某个 Tool 单元格的 `callId` 名下存在分发（assistant 块内的调用、孤儿结果与运行中的调用一视同仁），fold 就在该单元格之后按启动顺序为每个子分发穿插一个 `subtool` 单元格，索引在整个穿插序列中保持连续编号。已结算子调用的耗时来自其 start/settle 事件对（`durationSeconds(sub.time, sub.callTime)`）；运行中的子调用则显示破折号，与原生的进行中约定完全一致。新增的单元格类型带有 `Sub` 标签（business 色调）与 28px 缩进，嵌套关系一眼可辨。
- **waterfall**：`deriveSubSpans` 把分发索引折叠成带真实计时的逐轮次泳道：每个父调用的分发窗口为首个 start → 最后一个 settle，每条泳道的偏移/宽度即其在该窗口中的占比，因此并行的子调用（PR3）会肉眼可见地重叠。每条泳道带有 `timing` 来源标记：`measured`（观察到了成对事件）、`running`（settle 未到 — 以较低不透明度延伸至窗口末端）或 `unknown`（回放窗口只含 settle、`callTime: null` — 画成空心并以「duration unknown」为悬停标题，绝不伪造 0 ms）。泳道绘制在所属轮次的条形行之下，并缩放进固定的泳道预算。
- 两个视图都经由标准的快照 hook 读取 `codeDispatches`：没有新的 wire 数据，也没有新的 store；回放的渲染由构造保证与实时完全一致。

## 曾考虑的替代方案

**把子调用折入轮次 span 的节点计数（给既有的条加权）。** 否决：它隐藏的恰恰是本堆叠 PR 链存在就是为了展示的结构，而且节点计数加权本就已被标记为占位（偏差账本 #3）。

**用专用的子调用面板取代视图内嵌套。** 否决：本堆叠 PR 链已敲定的 UX 是处处嵌套在父级之下；独立面板会与 chat 发生偏差，还会让选中接线翻倍。

**把 waterfall 泳道推迟到 P-III 的时长泳道重新设计。** 否决：子泳道的计时如今已是真实的（即那对事件），而按窗口占比的渲染与轮次级泳道将来的形态无关；推迟只会让本堆叠 PR 链的计时收益搁浅。

## 后果

waterfall 承载了 client 中第一处真实的墙钟时间渲染（轮次条仍是节点计数的占位；这一反差是有意为之，并由悬停标题标注）。trajectory 的单元格索引现在会把子调用计入，因此 Code Mode 轮次上的 `#N` 总数会随之增大。spec 锁定穿插顺序与耗时、运行中的破折号分支、窗口占比（偏移/宽度）、运行中泳道的延伸、unknown 计时（仅 settle）泳道，以及轮次行之下实际渲染出的泳道；构建产物级的 Code Mode fixture 快照另行锁定两个标签页的组装后渲染（带真实 +0.8s 耗时的子单元格、measured 泳道）。
