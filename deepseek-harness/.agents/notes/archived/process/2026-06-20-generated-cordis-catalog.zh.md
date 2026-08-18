# Agent Note: 生成的 Cordis 事件与服务目录

Status: implemented
Archived: 2026-08-07

[English](2026-06-20-generated-cordis-catalog.md) | 中文

## 问题

插件作者需要两类此前没有任何单一文档能同时提供的参考信息：他们可以监听的每一个 Cordis **事件**（含精确签名与分发模式），以及他们可以调用的每一个 `ctx.<key>` **服务**（含精确接口）。相关信息虽然存在，但散落各处：`docs/architecture.md` 中一张手工维护的事件分类体系*表格*（名称 + 行文描述的 Mode/Purpose，由 `verify-event-taxonomy` 做名称集合校验）、一张服务映射表（8 行角色描述），以及 `interface Events` / `interface Context` 声明本身。分类体系表格还有一个盲区：它无法捕获全新的*未记录*事件——名称集合校验器只检查两侧已有的名称。

这是对[核心数据结构目录](../../../../docs/core-data-structures/core.md)（[其 Agent Note](2026-06-20-core-data-structures-catalog.md)）在接线维度上的补充：前者对循环传递的*数据结构*编目（经验证的手工粘贴），本文则对传递它们的*事件和服务*编目。

## 决策

从源码生成目录，取代手工维护表格并校验子集的方式。

`scripts/gen-cordis-catalog.ts` 使用 TypeScript 编译器 API，根据声明和源码 JSDoc 分别生成事件与服务参考。事件包含分派模式及其原始成员 JSDoc；服务包含公共签名及各方法的原始 JSDoc。确定性的 `--write` 和 `--check` 模式使两个页面成为生成产物，并由 `doc-sync` 强制检查新鲜度。

完全通过生成来构建目录在此处是正确的，因为代码库足够规范，AST 包含全部事实：每个事件/服务名称都是字符串字面量，可以往返映射到静态声明——不存在动态命名的事件，也不存在仅运行时的服务。因此生成的文档不可能出错，且从结构上消除了未记录事件的缺口（生成器枚举源码，而非校验手写子集）。

具体选择：

- **`@mode` 标签，交叉校验。** 每个 harness 事件的 JSDoc 携带一个显式的 `@mode emit|waterfall|parallel|serial` 标签；缺少标签时生成器直接报错。当签名形状具有决定性时——尾部参数为 `next: () => …` 在结构上即为 waterfall（瀑布式事件）——生成器断言标签与之一致，矛盾时直接报错。emit/parallel/serial 的区别在结构上不可见（`session/flush` 返回 `Promise<void> | void` 且无 `next`，有序的 `agent/pre-step` 检查点亦然），因此信任标签。编写规则见 [AGENTS.md](../../../../AGENTS.md)。
- **分层范围。** harness 层（8 个 `@deepseek-ai/dsh-*` 服务及其事件）从源码完整渲染。继承层（cordis-core 的 `ctx.on/emit/effect/provide/…` + `internal/*` 事件 + loader/hmr/timer）是插件同样可见的固定版本的 vendor 源码；它从生成器中一张人工维护的表格简洁渲染（名称 + 一行描述 + 源码位置），而非遍历 vendor AST。原因是 cordis-core 的 `Context` 混合了真正的 ctx 成员与非服务字段（`root`、`baseUrl`、`logger`），且 vendor 接口仅在有意的 vendor 同步时才变化。
- **指向数据结构目录的交叉链接。** 签名中由仓库拥有的每个类型名（`GenerateOptions`、`StreamChunk`、`ToolDefinition`……）都会通过人工维护的映射链接到其主要核心数据结构页面。AST 遍历采用默认拒绝放行的策略：每个参数、泛型约束/默认值和返回类型引用都必须已映射、是签名自身的类型参数、是点名的 TypeScript/Cordis 基础类型，或带有点名的例外及其非目录文档归属。违规会连同源码位置汇总报告，并点明相应的归属列表。该映射不会复用 `type-equiv.manifest.json`，因为后者记录 `…Map` 符号，而签名引用派生的联合类型名，并且会在多个页面列出某些符号。
- **专用围栏。** 签名块使用 ` ```ts cordis-catalog ` 信息字符串，并把原始事件或公共方法 JSDoc 直接放在其声明之前。`doc-typecheck` 会识别并跳过这些裸片段，将其排除在 opt-out 比例之外——与 `type-equiv` 块的处理相同。

本决策**取代** [doc-sync 强制](../../archived/process/2026-06-11-doc-sync-enforcement.md)中事件分类体系的那一半：`verify-event-taxonomy` 及其 `docs/architecture.md` 表格退役（architecture.md 的标题保留，正文改为指向目录；服务映射的角色表格作为人工行文保留）。doc-typecheck、verify-md-wrap、verify-md-links 和 verify-type-equiv 不受影响。

## 曾考虑的替代方案

- **校验而非生成（退役的分类体系检查所做的事）**：*仅对本参考面*反转了这一策略。此处的数据可以机械地完整获取，因此生成严格强于对手工表格做名称集合校验（完整签名、不会漂移、能捕获未记录事件）。
- **遍历 vendor AST 以获取继承层**：否决，改用人工维护表格。cordis-core 的 `Context` 混合了真正的 ctx 成员与非服务字段，且固定的 vendor 接口仅在有意同步时才变化。
- **复用 `type-equiv.manifest.json` 作为签名交叉链接映射**：否决，改用完整的人工维护常量和默认拒绝放行的覆盖检查。manifest 记录 `…Map` 符号，而签名引用派生的联合类型名，并且会在多个页面列出某些符号。显式映射让每个渲染目标和每个非目录例外都成为可评审的决策。

## 后果

- 目录不会发生漂移：提交文件未反映的源码变化会使 `doc-sync` 和 CI 中的 `verify-cordis-catalog` 失败。新事件缺少 `@mode` 标签、标签与其签名冲突，或签名类型未分类，都会直接使生成器失败。
- 事件与服务方法契约只有一个归属——声明处的 JSDoc。目录会在生成的签名块中重复该原始 JSDoc，并使用其描述部分作为条目正文，因此单薄的源码文档只会生成单薄的目录条目。
- 继承层是手工摘要，因此 vendor 同步若新增或重命名了 cordis-core 事件或 `ctx` 成员，需要同步编辑 `gen-cordis-catalog.ts` 中的人工维护表格。这是不遍历固定版本的 vendor 源码的有意代价；它很少变化，且在生成器中有明确标注。
- `verify-event-taxonomy.ts` 被删除，`docs/architecture.md` 的事件表格也已移除；之前链接到特定表格行的人现在会落在生成目录上。
