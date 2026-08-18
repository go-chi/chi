# @deepseek-ai/dsh-typert-generator

[English](README.md) | 中文

TypeScript 项目分析器和模型驱动的 Typert 生成器。在生成任何产物之前，它会先将开发者编写的源类型树转换为独立于编译器的 `FaceModel` 和 `TypeGraph` 数据。静态分析无需 Cordis 即可消费该模型；各产物生成组件均不会接收 TypeScript 抽象语法树（AST）或类型检查器对象。

分析器可以分别使用由 `tsconfig.host.json` 或 `tsconfig.client.json` 初始化的独立 `ts.Program`。直接项目引用确定编译器 face 的成员归属，而包子路径确定 Typert 运行时 face 的贡献：声明 `dsh.client` 的普通单项目包可以同时贡献 Host 与 Client 运行时模型；只有通过 `tsconfig.host.json` 或 `tsconfig.client.json` 显式引用的拆分项目，才会被限制在相应 face。`package.json#exports` 确定所有跨包公开边界，跨 face 的边只能来自源码导入或重新导出。NPM 依赖拥有的类型（包括 `@types` 包中的全局声明）继续以 `external` 引用表示，不会被展开。

## 分析模型

每个 face 包含包导出、Cordis 服务与事件、显式标记的对象与 schema，以及涵盖其可达声明的类型图。类型图保留声明标识、泛型参数及应用、显式继承、条件类型与映射类型、导入属性、abstract 修饰符和源码 JSDoc。服务和 `@typert object` 对外接口仅暴露公共实例成员；构造函数、静态成员与非公共成员均被排除。

`WorkspaceAnalyzer` 默认采用 `check` 模式，遇到 TypeScript 语法或语义诊断、可达公开声明缺少类型标注、跨包私有引用，以及模型无法无损保留的可达声明合并时，分析会失败。`write` 模式会插入类型检查器推导出的类型标注，重建该程序，并返回无诊断的检查模式模型。

## 产物生成与选择性发布

`FaceModelEmitter` 只消费模型。它会生成可执行 JavaScript，其中包含受支持的 Zod schema 和一个 `TYPERT` contribution；同时生成声明文件，通过包的公开导出将其中的 schema 标注为 `z.ZodType<SourceType>`。遇到不支持的 Zod 投影时，生成会失败，不会展平或弱化源类型。

`WorkspaceTypertGenerator` 会遍历从 Cordis `Context` 或 `Events` 扩充声明及显式 `@typert` 声明可达的包公开导出，以发现贡献方。发布产物时，它要求宿主侧产物位于 `lib/typert.host.{js,d.ts}` 并以 `package/typert` 暴露，客户端侧产物位于 `lib/typert.client.{js,d.ts}` 并以 `package/client/typert` 暴露。生成的声明将 `TYPERT` 暴露为 `unknown`，因此参与贡献的业务包无需依赖运行时注册表。

各包可自行选择是否发布，未提供对应公开入口的业务包无需生成 Typert 产物。仓库的 Host tsdown 会以 `tsconfig.host.json` 为唯一 program 种子运行 workspace Typert 生成；它既生成 Host 反射产物，也把 Host Remote 约定投影为 Client 使用的 `typert.remote-client.*`。后续 Client tsdown 不启动 Typert，也不分析 `tsconfig.client.json`。静态消费方仍可直接调用 `WorkspaceAnalyzer`，显式选择 face 与包子集，并在不发布或加载运行时产物的情况下分批处理包。

## 本仓库的 Cordis 投影

包根导出中包含本仓库 Cordis 目录使用的模型驱动提取逻辑、完整性检查和确定性文本渲染器。它们接受 `CordisCatalogPolicy`；由仓库持有的类型链接、基础类型／豁免类型分类和继承的 Cordis 条目仍位于 `scripts/gen-cordis-catalog.ts`，并由调用方显式传入。因此，生成器包只包含投影机制，不会隐式复制本仓库的文档分类体系。

## 模型体验

无。该包仅在构建或测试时运行，不会向模型请求添加任何内容。

#### KV Cache 影响

无。

## 已知限制与暂缓事项

- 系统会跳过包导出中的模式匹配；参与贡献的包需要具体的导出目标。
- 跨 face 的具名重新导出和星号重新导出会生成链接；在 `TypeTargetModel` 能够不经展平便表示模块命名空间之前，命名空间重新导出会失败。
- Zod 产物生成组件仅支持 TypeScript 类型图中有意限定的部分。泛型 schema 声明，以及以条件类型或映射类型为 schema 根的计算构造，都会失败，直到存在明确的 schema 工厂策略。
- 跨 face 链接会在模型中表示以供分析，但当前生成的 schema 均不需要跨 face 的运行时 Zod 导入。
- 发现过程会遍历从具体公开导出可达的源文件；既未导出、也未由该图导入的声明会按设计排除在包模型之外。
