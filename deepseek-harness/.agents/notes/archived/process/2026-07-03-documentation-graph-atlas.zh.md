# Agent Note: 面向维护者与 SDK 用户的文档关系图索引

Status: implemented
Archived: 2026-07-26

[English](2026-07-03-documentation-graph-atlas.md) | 中文

## 问题

仓库已经有若干高可信文档表面，各自覆盖不同维度：[module-graph.md](../../../../docs/module-graph.md) 根据包（package）的 `peerDependencies` 生成；生成式 [Cordis 事件](../../../../docs/cordis-catalog/events.md)和[服务](../../../../docs/cordis-catalog/services.md)目录根据 Cordis `Events` 和 `Context` 声明生成；[tool-catalog.md](../../../../docs/tool-catalog.md) 通过启动已发布工具插件生成；[core-data-structures/](../../../../docs/core-data-structures/core.md) 则使用 `ts type-equiv` 块使粘贴的类型定义与源码保持同步。

这些参考文档是准确的，但大多是目录式的。维护者仍需自行综合关系：哪些包构成一个能力 seam、哪个应用组装了具体的主干、哪些事件是持久的而哪些是实时的、钩子或策略插件在哪里可以拦截工作、以及哪个面向模型的工具依赖哪个服务。SDK 用户从另一个角度面临同样的问题：「我想要某种行为，应该安装或加载哪个包？应该扩展哪个事件/服务/工具？」

钩子子系统使事件的生产者/消费方拓扑与拦截点变得更加重要；文件系统 seam 使能力 seam、策略否决、工具呈现与 SDK 组装路径变得更加重要。如果关系图的范围仅限于一个小的 bash/todo/subagent 表面，它们会立即陈旧。

## 决策

新增生成式关系图文档，由聚焦的生成器产出并在 [docs/graph-atlas.md](../../../../docs/graph-atlas.md) 建立索引；作为 `doc-sync` 的一部分，通过 `pnpm run verify-doc-graphs` / 现有目录新鲜度检查进行验证。

该索引是既有目录之上的关系层。它不取代精确的参考文档，而是链接到它们并解释各部分如何组合在一起。

### 维护模式

每个关系图页面声明一种维护模式：

- **Generated（生成）**：所有节点和边均从源码发现；如果已提交的产物陈旧，`--check` 失败。
- **Hybrid generated（混合生成）**：源码发现清单，一个小型 manifest 对不可约的策略进行分类，完整性守卫在发现的条目未被分类时失败。
- **Curated（人工策划）**：图表解释设计意图、时序或归属；它由生成器输出以使关系图文档保持为可重新生成的整体，但内容是有意撰写的。

### 首批发布的索引

该索引链接十种关系表面。包拓扑和工具包所提供的功能位于已经拥有这些事实的现有生成式目录中；其余聚焦图表由 `scripts/gen-doc-graphs.ts` 生成。

| 关系图 | 维护模式 | 真源 |
|---|---|---|
| [模块依赖图](../../../../docs/module-graph.md) | 生成式 | `packages/*/*/package.json` 的对等依赖（peer dependency）与包分组路径 |
| [工具 schema 目录与包映射](../../../../docs/tool-catalog.md) | 生成式 | 启动后采集的工具 schema，以及工具包服务/效应元数据 |
| [能力 seam 与核心服务](../../../../docs/capability-seams.md) | 混合生成式 | Cordis 服务声明，以及 `gen-doc-graphs.ts` 中的角色清单 |
| [tui-agent 应用组合](../../../../examples/tui-agent/composition.md) | 混合生成式 | `examples/tui-agent/cordis.yml` 插件列表，以及人工维护的应用/bundle 展开 |
| [headless-agent 应用组合](../../../../examples/headless-agent/composition.md) | 混合生成式 | `examples/headless-agent/cordis.yml` 插件列表，以及人工维护的应用/bundle 展开 |
| [cordis-agent 应用组合](../../../../examples/cordis-agent/composition.md) | 混合生成式 | `examples/cordis-agent/cordis.yml` 插件列表，以及人工维护的应用/bundle 展开 |
| [acp-agent 应用组合](../../../../examples/acp-agent/composition.md) | 混合生成式 | `examples/acp-agent/cordis.yml` 插件列表加人工策划的应用/bundle 展开 |
| [事件生产者/消费方矩阵](../../../../docs/event-producer-consumer.md) | 混合生成式 | Cordis 事件声明、经 AST 扫描的 `ctx.on/emit/parallel/serial/waterfall` 位置，以及显式动态分派覆盖 |
| [agent 轮次与步骤生命周期](../../../../docs/agent-lifecycle.md) | 人工维护 | architecture.md 循环生命周期、Cordis 目录链接，以及会话事件语义 |
| [工具执行管线](../../../../docs/tool-execution-pipeline.md) | 人工维护 | 工具管线语义与 `tools/execute` waterfall（瀑布式事件）|

### 为什么由生成器拥有文档

包拓扑留在 `gen-module-graph.ts`，工具-包能力映射留在 `gen-tool-catalog.ts`，因为这些生成器已经拥有权威事实和新鲜度门禁。`gen-doc-graphs.ts` 拥有其余关系页面和索引。代价是人工策划的图表需要在 TypeScript 字符串块中编辑，而非直接编辑 Markdown。对于首版来说这是可接受的，因为面向用户的产物仍然是纯 Markdown/Mermaid；未来如果撰写体验比可重新生成更重要，可以将人工策划的页面拆分出去。

### 完整性守卫

混合生成的页面在其 manifest 陈旧时必须显式报错：

- 模块图读取每个包的 `peerDependencies`，并按 `packages/<group>/<pkg>` 路径对包进行分组。
- 工具目录通过启动收集已发布的工具，并从同一份 manifest 渲染包/服务/副作用映射（其完整性守卫已在检查该 manifest）。
- 能力 seam 图导入 Cordis 服务收集器，断言每个发现的 harness `ctx.<key>` 都已在 `SERVICE_ROLES` 中分类，且每个已分类的 key 仍然存在。
- 事件生产者/消费方矩阵标记为 hybrid，因为 subagent 生命周期事件有意使用 `ctx.events.dispatch` 实现逐监听器隔离；这些动态边是显式覆盖而非无声遗漏。
- `verify-mermaid` 使用 Mermaid 自身的解析器解析仓库中每个 ` ```mermaid ` 围栏，因此语法错误在本地和 CI 的 `doc-sync` 阶段即被捕获，而非在 GitHub 渲染时才显示为损坏的图表。

## 曾考虑的替代方案

已提交的图表使用 Mermaid，因为 GitHub 在 Markdown 中原生渲染它且不引入新的文档构建依赖；密集的多对多数据（如事件生产者/消费方关系）改用 Markdown 表格。**PlantUML、托管图表服务和生成的 SVG** 曾被考虑，但在 Mermaid 成为瓶颈之前有意不采用。

## 后果

- 维护者获得了拓扑、seam、事件流、生命周期与应用组合的可视化入口。
- SDK 用户获得了从用例到包组合的路径，而非仅有自底向上的包参考。
- `doc-sync` 现在包含 `verify-doc-graphs` 和 `verify-mermaid`，因此关系图漂移和 Mermaid 语法错误与其他文档新鲜度门禁一起被捕获。
- 未来的文件系统和钩子工作有了承载新复杂度的具体位置：文件系统应扩展能力文档和工具目录，钩子应扩展事件矩阵和工具执行流水线。
