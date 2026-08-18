# Agent Note: 生成式持久化日志事件目录

Status: implemented
Archived: 2026-07-27

[English](2026-07-04-persistence-log-catalog.md) | 中文

## 问题

`SessionEventMap` 是磁盘格式的词汇，但其声明分散在所属的会话包（package）和声明合并中。生成式持久化目录是所有事件、各自完整 payload 声明与源码 JSDoc，以及共享 `SessionEvent` 信封的唯一参考；手工维护的表格会发生漂移，因此被移除。这些记录不是 Cordis 事件——观察者通过唯一的 `session/event` 总线事件接收它们——所以 Cordis 目录无法覆盖。生成器会发现所有声明，文档同步新鲜度门禁会拒绝遗漏或陈旧输出。

## 决策

从源码生成 `docs/persistence-catalog.md`，配合新鲜度门禁，作为第四个参考面：持久化会话日志可以包含的*记录*，与 Cordis 目录（接线）、核心数据结构（词汇）和工具目录（工具）互补。

`gen-persistence-catalog.ts` 使用 TypeScript AST 扫描每个所属及声明合并的 `SessionEventMap`。它从前置 JSDoc 开始渲染每个成员，直至完整的 payload 类型，保留嵌套属性注释且只移除其容器缩进；同时粘贴构成持久化信封的所属 `SessionEventType`、`SurfaceEventType`、`SurfaceOp` 和 `SessionEvent` 声明。派生的 surface 徽章、参考链接和源码位置仍位于声明块之外。文档同步新鲜度检查会拒绝目录尚未重新生成的词汇或信封变更。

具体选择：

- **强制保证 JSDoc 完整性。** 每个成员和渲染出的信封类型都必须带有描述正文，完整的源码 JSDoc 会在目录中保持附着于其声明。`@mode` 标签是硬错误：分派模式属于 Cordis 总线事件，持久化记录没有这种模式。所有违规会汇总为一条错误，列出每个违规项。
- **surface 徽章由派生得出，而非手工列举。** `SurfaceEventType`（产生 LLM（大语言模型）消息且可能携带 `surfaceOp` 的子集）从拥有方包中的 union 声明解析；如果 union 成员命名了一个未声明的事件，则为硬错误（否则陈旧的 union 成员会静默地不标注任何内容）。其余一律渲染为 **log-only**。
- **专用围栏。** 声明块使用 ` ```ts persistence-catalog ` 信息字符串，`doc-typecheck` 会识别并跳过这些块，将其排除在 opt-out 比例之外——处理方式与 `ts cordis-catalog` 相同（这些声明引用所属模块中的类型，无法独立编译）。
- **仓库范围。** 目录枚举本仓库中的包，与兄弟文档的 packages-only 范围一致；下游插件可以合并更多事件类型，它们在设计上不在目录范围内。遍历过程用硬错误保护自身假设：拥有方的顶层 `interface SessionEventMap` 必须是 `@deepseek-ai/dsh-session` 中唯一的导出声明（无关的、局部的或同名重复的接口不能被当作磁盘词汇编入目录）；任何声明不得携带 `extends`（继承的键会加入 `keyof SessionEventMap` 却没有对应的目录行）；每个成员必须是带有显式 payload 类型的属性签名（方法形式的成员会加入 `keyof` 却在静默遍历中被漏过）；跨声明的重复成员也会失败。

本方案取代了手工副本：session.md 的 `hook/*` 表格、精简版 README 的事件表格、hook-protocol README 的 payload 条目列表，以及会话 README 的名称列表现在链接到目录，而不再重述 payload（周围的语义说明文字保留原位）。hook-protocol 合并成员上的两个误加的 `@mode emit` 标签已被移除——新门禁将它们作为类别错误拒绝。

## 曾考虑的替代方案

- **基于启动的生成器（类似工具目录）**：日志词汇完全是静态的，AST 遍历无需启动任何东西即可读取全部真相。
- **保留手工副本**：手工副本只能检查作者已经写下的名称；目录落地时，会话 README 的合并说明已经漂移。

## 后果

- 目录不会发生漂移：提交文件未反映的词汇或信封变化会使 `doc-sync` 和 CI 中的 `verify-persistence-catalog` 失败，而没有 JSDoc 的新增合并事件会直接使生成器失败——插件不能再添加未记录的磁盘记录类型。
- 事件正文只有一个归属，即声明处的 JSDoc；目录会保留该 JSDoc 和所有嵌套字段注释，不会将其扁平化或复述。
- `SurfaceEventType` union 现在对文档具有结构性承载作用：重命名事件而不更新 union（或反过来）会导致生成器失败，而不仅仅是编译器失败。
- 徽章派生假设 union 始终是一组封闭的字符串字面量且只有一个拥有方；如果重构偏离了这一形状，必须在同一个变更中更新生成器。
