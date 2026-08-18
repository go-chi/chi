# Agent Note: `docs/cordis-tutorial` 下的 Cordis 实操教程文档

Status: implemented
Archived: 2026-07-27

[English](2026-07-22-cordis-tutorial-docs.md) | 中文

## 问题

本仓库从两个层面介绍 Cordis：精简的 [cordis-primer](../../../../docs/cordis-primer.md) 阐述概念，`docs/user/develop/` 下的页面则讲解如何基于 harness 服务编写 harness 插件。但二者都不适合初次接触 Cordis 的开发者：primer 假定读者已经会编写插件，开发页面则直接从 `defineTool` 讲起，没有展示上下文、fiber、服务和 dispatch 的实际行为。此前没有一条学习路径让读者运行原生 Cordis、观察 fiber 进入 PENDING 状态，或看到 waterfall（瀑布式事件）否决实际发生。

## 决策

`docs/cordis-tutorial/` 包含一套七章实操教程（第一个插件 → 生命周期与 effect → 服务 → 事件 → 配置 → 组合与 HMR（热模块替换）→ harness 工具）。以下是教程的特性，按重要性从高到低排列：

- **每段 transcript（文本记录）都真实可复现。** 每章文件都通过 `node --import tsx ../../vendor/cordis/bin.js` 在 git 忽略的 `tmp/cordis-tutorial/` 临时目录中运行，展示的输出就是这些命令实际打印的内容。使用 harness 包（package）（`@deepseek-ai/dsh-tools` 和 `@deepseek-ai/dsh-llm`）的章节无需密钥即可运行。
- **采用 dsh 风格，而非纯 Cordis**：后续章节使用真实的 harness 服务和事件（`ctx.tools`、`tools/result`），使读者最终进入本仓库实际采用的组合模型，这遵循了提出请求的用户所作的选择。
- **仅提供英文版，但发布到网站的两个语言区域**：通过 [website/docs.ts](../../../../website/docs.ts) 中的 `mirroredPages()`，发布到开发侧边栏的 `Cordis 教程` / `Cordis tutorial` 分区。该方式与参考页面采用的模式相同，因此日后可以逐步纳入中文配对，而无需更改路由。
- 除两个围栏代码块外，其余代码块均通过 `doc-typecheck` 编译；这两个例外分别导入临时目录中的相对路径文件（`./stats.ts`）或有意抛出异常，因此标有 `ignore-check`。

## 考虑过的替代方案

**作为双语产品文档放在 `docs/user/develop/` 下。** 该层级要求在同一个 PR（Pull Request）中同时提供英文、中文和 i18n 记录，这会使变更量大致翻倍，并要求未来每次修改教程时都同步翻译。首次落地不采用此方案；镜像投影仍可保持同等的公开可见性。

**不使用任何 harness 包的纯 Cordis 教程。** 作为框架文档会更简洁，但目标读者是扩展此 harness 的 agent（智能体）开发者；以 `ctx.tools.execute` 和 `tools/result` 收尾，能讲清他们实际使用的组合方式。用户明确选择了此方案。

**扩充 primer，而非新建目录。** primer 是一份预算上限为 600 词的精简概念参考；在其中加入多章演练会破坏该文档层级的职责及其篇幅预算，而非形成补充。

## 结果

- 现在有了一份可运行的 Cordis 入门教程，涵盖 loader、fiber 状态、effect、服务注入、全部五种 dispatch 模式的契约、Schemastery 校验和 HMR。教程实际展示了依赖处于 PENDING 状态和配置校验失败；对于 loader 记录的配置项解析失败，教程只作说明，因为启动阶段的日志可能无法到达控制台导出器。
- 教程中的 transcript 以非正式方式固定了行为，但没有快照门禁；如果 loader 或 HMR 的行为发生变化，transcript 会逐渐偏离实际结果，直到有人重新运行各章。编译门禁只覆盖围栏代码块。
- 各章写明了具体的 harness API（`ctx.tools.execute`、`CallId`、`tools/result`）；这些 API 重命名时，必须像更新其他文档引用一样同步修改教程（`verify-md-links` 能发现文件移动，但无法发现 API 文字引用变化）。
