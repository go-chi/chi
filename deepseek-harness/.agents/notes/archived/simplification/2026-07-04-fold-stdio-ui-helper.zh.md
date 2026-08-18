# Agent Note: 将 stdio UI 辅助模块折入 stdio 应用

Status: implemented
Archived: 2026-07-26

[English](2026-07-04-fold-stdio-ui-helper.md) | 中文

后来的[冗余 agent（智能体）移除](2026-07-20-remove-stdio-and-echo-agents.md)取代了这项包放置决策，并完整移除合并后的包、应用和面向行的表面。

## 问题

readline UI 曾是一个完整的包（`packages/support/` 下的 `@deepseek-ai/dsh-ui-stdio`），其唯一的运行时导入方是应用包 `@deepseek-ai/dsh-stdio-demo`。示例通过加载应用来使用 readline UI，从不自行组合该辅助模块；仓库中所有其他引用都是因为包边界存在而存在的机械性或描述性表面：manifest（元数据清单）与 tsconfig 条目、生成的 module-graph 行、依赖图与 README 行，以及命名该包的文档注释。ui 组 README 记录了 support 放置的理由（"主要为示例和覆盖率门禁而存在，`ui/` 保留给作为产品交付的界面"），这留下了一个持续的张力：一个已交付的产品应用依赖一个被明确标注为非产品表面的 support 包。

这条边界换来的是：包元数据、workspace 与 tsconfig 引用、module-graph 行、README 条目，以及 publint 表面——服务于一个并不可独立替换的辅助模块：stdio 应用的前门集群始终包含 readline UI，且没有其他消费方能有意义地使用它。

## 决策

当时，该辅助函数移入 `@deepseek-ai/dsh-stdio`，成为终端通道插件。`createStdioChat`、其 `StdioRuntime` 测试 seam 和单元测试随之一同迁移，使 EOF 处理、渲染、释放以及管道/TTY 行为继续受逐文件覆盖率门禁约束，而不会劫持进程全局量。该模块保留应用挂载所消费的具名 `name`/`inject`/`Config`/`apply` 导出形状；当时的 Echo 和 REPL Loader 冒烟证明组合树，插件形状套件则固定显式 `unwrapExports` 行为。上方取代本文的移除记录负责当前包和示例状态。

早期的支持辅助包已移除：其清单、tsconfig 引用、模块图行和 README 行均已消失，其余文档改为描述包内模块。

## 曾考虑的替代方案

### 为什么不将其提升到 `ui/` 而是折入？

提升可以解决 support 与 product 之间的错位，同时保留边界——只有在 readline UI 是一个可独立替换的集成或有第二个组合方时才是正确选择，而消费方普查表明两者皆非。结构化的 ACP（Agent Client Protocol）桥接保留为独立包，因为它是具有自身契约和快照层级的自动化协议表面；readline 辅助模块只是一个应用前门的脚手架。在发布前重新拆分成本很低：如果将来有第二个产品应用需要 readline UI，届时再拆出来，由那个消费方来塑造包契约。

## 后果

- stdio 应用完整拥有自己的前门；叶子 `cordis.yml` 仍然只加载一个应用包，演示的形态没有变化。
- 未来如果有独立的终端 UI 需要将该辅助模块作为包使用，届时由那个第二消费方驱动重新引入，而非仓库为假设性的复用保留一条边界。
