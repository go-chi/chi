# Agent Note: 撤销独立的 subagent mock 包

Status: implemented
Archived: 2026-07-26

[English](2026-07-19-retire-subagent-mock-package.md) | 中文

## 问题

`@deepseek-ai/dsh-subagent-mock` 曾是一个以工作区插件形式发布的可配置测试替身。它仅有两个外部消费方：`tool-subagent` 单元测试和工具目录生成器；运行时包、示例、快照配置和真实提供方都不会加载它。

这个用途狭窄的 fixture（测试前置数据）需要维护 manifest（元数据清单）、导出、对等依赖（peer dependency）与开发依赖、项目引用、包（package）README 契约、Loader 组合测试、模块图成员关系以及文档例外。工具目录生成器挂载它，只是为了让生产消费方注册 schema，并不会执行子 agent。

## 决策

删除独立包。脚本化子 agent 行为现位于 `packages/subagent/tool-subagent/tests/scripted-provider.ts`；测试挂载真实的 `SubagentService`、提供方注册表、工具实现和任务运行时，只替换具有不确定性的子 agent 边界。

本地 fixture 保留确定性回复、结构化结果、停止原因、发布前后的取消、对话继承描述和作用域化的 dispose（资源释放）覆盖。由于 fixture 不再是可部署插件，删除包专用的 Schemastery 与 Loader 导出测试。

工具目录生成器在挂载 `ToolSubagent` 或工作流引擎之前，注册一个最小本地 `SubagentProvider` 描述。该描述无法启动子 agent；它只用于满足生产消费方的加载时依赖，同时从真实消费方提取 schema。

工作区项目引用、包依赖、锁文件条目、图元数据、支持包说明、配置目录条目和 README 门禁例外不再提及已撤销的包。

## 备选方案

**为未来测试保留可复用 mock 包。** 除一个测试文件和一个生成器外，复用需求始终没有出现。未来产生第二个行为消费方时，可以在共享契约明确后再提取 fixture；提前将其打包会使测试基础设施看起来像受支持的后端。

**不挂载生产消费方，直接生成 subagent schema。** 手工构造或直接导入 schema，会削弱目录门禁对真实注册表与工具组合是否公开文档结构的校验。最小提供方描述能保留该校验，而无需携带可执行的虚假后端行为。

## 影响

- 工作区减少一个可部署包，能力图与模块图也不再包含测试专用节点。
- `tool-subagent` 测试继续通过生产服务覆盖前台、后台任务、生命周期、取消、回复、停止原因和结构化结果。
- 工具目录输出仍根据生产注册生成，并保持字节级一致。
- 运行时包与示例包都不会依赖测试 fixture。
