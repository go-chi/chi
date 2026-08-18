# Agent Note: 将示例应用提取为独立包

Status: implemented
Archived: 2026-07-26

[English](2026-06-20-extract-example-app-packages.md) | 中文

## 问题

示例目录本应是*精简的*——只包含演示的可变接线，而非演示的基础设施。在此次变更之前，它是臃肿的。每个示例都携带一份手写的 `start.ts` 启动引导、一段基础设施前导（`timer`，以及 stdio 演示所需的 `logger` + `hmr`（热模块替换））、三个共享 YAML 片段的嵌套引用（`base.yml` / `base-core.yml` / `acp-agent/acp-tail.yml`），还有各示例自身的 `agent-loop`/持久化/系统提示词配置。真正的应用——每个 agent（智能体）都需要的服务主干——散落在叶子配置和那些 include 中。

叶子配置还拥有耦合的前门。ACP（Agent Client Protocol）要求 stdout 纯净，并通过 `session/new` 创建 agent；终端应用和 Headless 应用则预创建 `main`，但进程 I/O 契约不同。防止错误组合的唯一屏障是文档中的文字警告，而三个 `start.ts` 文件重复着 Loader 引导和生命周期代码。

## 决策

每个示例现在**主要是对一个应用包（package）的调用**，沿着既有的[接口 / 实现 / 消费方 seam](2026-06-13-capability-seams.md) 拆分接线：**应用包拥有组合**，叶子 `cordis.yml` 只拥有**可替换的选择**（哪个 LLM（大语言模型）适配器、哪个 bash 执行器、模型、提示词、持久化根目录）。

- **`@deepseek-ai/dsh-agent-spine-demo`**（[packages/examples/agent-spine-demo](../../../../packages/examples/agent-spine-demo)）组合了不含提供方、不含执行器、不含 UI 的主干，并转发 agent loop（智能体循环）的 agent 列表配置。它对具体 loop 的依赖是有意为之，因为该包组合的是主干而非扩展主干；替换 loop 意味着提供另一个 bundle。
- **`@deepseek-ai/dsh-tui-demo`**、**`@deepseek-ai/dsh-cli-demo`** 和 **`@deepseek-ai/dsh-acp-demo`** 各自内置其进程角色。TUI 包含全屏 UI 和预创建的 `main`；Headless 包含 one-shot driver 和预创建的 `main`；ACP 包含 bridge 且不预创建 agent。三者都包含 JSONL 持久化，并省略 stdout logger。
- **`start.ts` 已移除。** 每个应用包都暴露一个 bin；`demo:*` 脚本调用它。Loader 引导、`.env` 加载和快速失败守卫位于共享的 [`@deepseek-ai/dsh-app-boot`](../../../../packages/ui/app-boot) 包（在逐文件覆盖率门禁下有单元测试——见[共享应用 bin 的启动胶水](../simplification/2026-07-04-share-app-bin-boot-glue.md)）；精简的自执行入口由 keyless 的 Loader 路径测试驱动。
- **每个叶子 `cordis.yml` 精简为**后端、可选产品工具，以及一个承载应用配置的 app 条目。TUI 和 Headless 把模型/会话选择路由到预创建的 agent；ACP 把初始提供方/模型路由到 bridge。
- **`base.yml`、`base-core.yml` 和 `acp-agent/acp-tail.yml` 已退役**——它们共享的主干现在位于 `dsh-agent-spine-demo` 中。

`bash-local` 和 LLM 适配器仍然是**叶子选择**：bundle 提供 `tool-bash`（消费方 schema），叶子选择执行器实现，因此沙箱执行器或回放适配器无需触碰应用即可替换。

### 实现修正：`hmr` 保留为叶子条目

提案最初将 `hmr` 列入交互式应用内置的前门集群。对照代码验证后发现，将 `hmr` 内置到应用包中会在两个方面与 Cordis 冲突，因此改为作为**叶子 `cordis.yml` 条目**交付：

1. `@cordisjs/plugin-hmr` 是一个仅限 Loader、仅限子进程的开发插件——它需要活跃的 `loader` 服务及其内部模块访问权限，因此只能在真实的 `demo:*`/bin 子进程中运行，不能在进程内的单元/覆盖率测试层运行。
2. 进程内测试层（vitest）甚至无法*导入* vendor 的 `hmr` 模块（其 class-decorator `@Inject` 形式在 Vite 的 transform 下会失败），因此一个 `apply` 静态导入了它的包永远无法满足其主函数的逐文件 100% 覆盖率门禁。

关键在于，`hmr` 不是 stdout 纯净隐患：ACP 配置中误加该条目不会破坏 JSON-RPC 帧。所有已交付应用都省略 stdout 控制台 logger；stdout 只归应用或协议 driver 所有。

## 曾考虑的替代方案

### 为什么不继续用共享 YAML include 来管理接线？

旧的 `base*.yml`/`acp-tail.yml` include 已经去重了*配置*，但 YAML include 无法**封装**前门耦合——它只能在注释中描述，并信任每个叶子遵守。它也无法拥有 `bin`，因此启动胶水一直在三个 `start.ts` 文件中重复。包将「ACP 应用绝不向 stdout 输出日志」从文字警告变成了产物的属性：叶子中不存在可以写错的 logger 条目。

## 验证

- 示例目录只包含配置、README 和测试：`start.ts`、基础设施前导和共享 YAML include 已移除。
- `demo:tui`、`demo:headless` 和 `demo:acp` 调用应用包的 bin。
- 每个新包都有 README 和逐文件 100% 覆盖率；每个应用包还有一个 keyless 的真实 Loader 路径 bin 冒烟测试，用于捕获[事后分析 0001](../../../../docs/postmortem/0001-acp-default-export-drops-inject.md) 中描述的导出形状故障。
- ACP 回放套件通过应用包的 bin 启动，因此协议接线与组装后的后端行为都跨越真实的 Loader 边界。

## 后果

- **裸插件树的教学性。** 主干现在隐藏在 bundle 之后，查看完整树意味着打开 `dsh-agent-spine-demo`。应用包的 README 承担了这份教学职责。
- **多了一层间接。**「这个演示加载了什么？」从扫描单个 YAML 变成了阅读一个包。

## 相关

- 取代[使共享示例基础配置与提供方无关](../../rejected/architecture/2026-06-20-providerless-example-base.md)：一旦主干移入 `dsh-agent-spine-demo` 且 `base*.yml` 文件被删除，将 `base.yml` 重命名为无提供方核心便不再有意义。
- 基于[能力 seam](2026-06-13-capability-seams.md)的接口/实现/消费方拆分——后端和展示层保持为叶子选择；主干是共享 bundle。
- 与[将包重组为模块化层级结构](2026-06-20-package-hierarchy.md)互补：新的 app/core 包按该层级结构归入既有分组（`core` 放可复用的主干 bundle，`ui` 放应用特有的前门）。
- 后续的[冗余 agent 移除](../simplification/2026-07-20-remove-stdio-and-echo-agents.md)拥有最终的 TUI/Headless 拆分，并移除行式与仅 mock 的叶子。
