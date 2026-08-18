# Agent Note: 卡片工具行通过同一个 ToolRow 折叠

Status: implemented
Archived: 2026-08-07

[English](2026-07-31-web-cards-toolrow.md) | 中文

## 问题

Web 客户端在连续几个 PR 里长出五种卡片渲染意图——terminal、diff、read、search、web，每一种都作为一个键控 toolview 注册项落在 `packages/client/ui-conversation/src/client/toolviews/` 下。它们在两处出现分歧，之前每个 PR 都承认却推迟处理：

- **Chrome 重复。** `read-row`、`search-row`、`web-row`、`file-mutation-row` 各自把摘要行（行首状态槽、视觉隐藏状态、标题、分隔点、路径链接/摘要）手绘成自己的 `<div className={css.root}>`，配一份私有 `.module.css`，而不是组合共享的 `ToolRow`。`read-row` 带着一个 `jscpd:ignore` 标记，点名这处重复并指向"一处针对所有行一次性处理的独立改动"——就是本次改动。
- **常驻 vs 折叠。** 那四个行把卡片（`ReadBlock`/`SearchBlock`/`WebBlock`/`DiffBlock`）常驻在摘要下方——始终展开——而终端卡片（经 `GenericToolCard`/`BashRow`）与每个文本行都从折叠状态起步，藏在 ToolRow 的整行展开之后。一个有多个 read/search/web/edit 调用的对话就成了一堵始终打开的卡片墙，违背了消息流作为摘要面的目的。

## 决策

`ToolRow` 拥有每一种卡片，而每个键控卡片行都组合它。ToolRow 原本就接收 `terminal` 与 `diff` 卡片材料；现在还接收 `read`、`search`、`web`，在其默认折叠的展开 body 里用对应原语渲染当前存在的那一种（按 chat 的 `CHAT_*` 上限截断）。一次调用最多携带一种卡片，因此这些 prop 互斥，body 取第一个存在的。

四个键控行——`ReadRow`、`SearchRow`、`WebRow`、`FileMutationRow`——丢掉手绘 chrome 与私有 CSS，成为薄薄的 `ToolRow` 组合，与 `AskQuestionRow` 完全一样：推导卡片模型，作为对应的 ToolRow prop 传入，为文件工具转发 `filePath`/`onOpenFile`，为无卡片的失败路径转发 `output`/`errorSummary`。每个行现在是 `ToolRowProps & PropsLocale<'conversation'>` 并以 `locale: NS` 注册，因为 ToolRow 需要对话的 `t` 来渲染其终端/代码 body 文案。`GenericToolCard`（渲染点兜底）对 read/search/web 做同样的事，所以一个没有自己键控行的卡片声明工具也以同样方式折叠。

`DetailsPanel` 的 Output 区不变：面板是单次调用的阅读面，因此它以原语的完整高度常驻渲染每张卡片，被截断的搜索也把恢复脚注留在那里。

## 后果

- 所有工具行共享一套展开交互：折叠时是单行摘要，整行切换卡片。卡片在展开前不在 DOM 里（`DisclosureRow` 只在打开时渲染 `children`），因此测试围绕一次 `[data-expandable]` 点击断言"先无后有"。
- 已删除：`read-row.module.css`、`search-row.module.css`、`web-row.module.css`、`file-mutation-row.module.css`、`GenericToolCard.module.css`。这些行不再带自己的 CSS；ToolRow 的 module 拥有 chrome 与卡片 body 的缩进。
- 无卡片的失败路径（出错的改动，出错/嵌套/旧日志的搜索）不再画自己的 `.failure`/恢复 `<div>`；它们改走 ToolRow 的 `output`（Output 区）与 `errorSummary`（折叠摘要首行），后者已经用 `error.name: error.code` 兜底压平结果文本。
- `bash-sample` 有意保留自己本地的展开 chrome（第三方姿态的范例，从不引入 chat 域）；它本来就是折叠的，因此行为不变。

## 考虑过的替代方案

- **保持行常驻，只统一 chrome。** 否决：用户的要求是默认折叠，而常驻卡片正是让流不可扫读的原因。
- **在行与 ToolRow 之间加一层共享的 `CardRow` 包装。** 否决：ToolRow 一旦接收每一种卡片，它本身就是那层包装；再加一层就是 package 规则警告的过早抽取。
