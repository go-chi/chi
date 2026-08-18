# Agent Note: Doc-sync 强制

Status: implemented
Archived: 2026-07-26

[English](2026-06-11-doc-sync-enforcement.md) | 中文

## 问题

AGENTS.md 承诺文档与代码严格同步，但这一承诺此前仅靠人眼核查。评审曾两次发现漂移：一次是实操手册（cookbook）示例与类型策略矛盾，一次是 README 引用了错误的 `registerAdapter` 调用。失去同步的文档比没有文档更糟；而本代码库主要由 agent（智能体）构建，agent 遵守门禁远比遵守行文约定可靠（机械质量门禁）。有两类文档漂移可以被机械检查：不再能编译的代码块，以及与 `interface Events` 声明重复的事件分类体系表。

## 决策

两道门禁，沿用既有的 `scripts/` 风格（tsx ESM，每个脚本一项职责）：

1. **`doc-typecheck`** 从 `README.md`、`docs/**` 和 `packages/*/README.md` 中提取所有 ` ```ts ` 围栏代码块，写入一个继承根 `tsconfig.json` 的临时项目，然后用 `tsc -b` 编译。临时项目复用源码的 `paths` 映射和根 project references，因此文档示例能看到源码，而 vendor 代码仍在其自身的 tsconfig 设置下被检查。刻意作为草图的代码块可通过显式的 ` ```ts ignore-check ` 信息字符串来 opt-out；脚本会报告 opt-out 比例，超过一半即失败，防止该豁免机制悄然成为常态。
2. **`verify-event-taxonomy`** 从 `packages/*/src` 中的 `interface Events` 块和 `docs/architecture.md` 中的分类体系表分别提取事件名称，断言两个集合完全一致。只校验，不生成：表格保留手写的 Mode/Purpose 列，仅检查名称集合。（落地此门禁时发现了表格遗漏的三个事件：`tools/change`、`llm/adapter-change`、`system-prompt/change`。）**已被取代**：由[生成式 Cordis 目录](2026-06-20-generated-cordis-catalog.md)取代。此门禁及其 `architecture.md` 表格已退役，取而代之的是完全生成的 `docs/cordis-catalog/events.md` + `docs/cordis-catalog/services.md` 及其 `verify-cordis-catalog` 新鲜度门禁。本 Agent Note（agent 决策记录）中的其他门禁（`doc-typecheck` 以及下文修订中的 `verify-md-wrap`）不受影响。

两者都通过 package.json 中共享的 `doc-sync` 脚本运行；贡献者在相关文档变更中调用它，CI 则执行完整检查。[快速本地 Git 钩子](2026-07-22-fast-local-git-hooks.md)决策使这类按变更面选择的工作不进入 commit 和 push 钩子。

**修订（2026-06-17）：** 第三道门禁 **`verify-md-wrap`** 随后被纳入 `doc-sync`。它使用 `mdast-util-from-markdown` + GFM 解析范围内的每个 Markdown 文件（`README.md`、`docs/**`、`packages/*/README.md`，加上 `AGENTS.md` / `packages/AGENTS.md`），如果任何 `paragraph` 节点跨越多个源码行则失败，从而强制执行 docs/AGENTS.md 中「一个段落一个物理行」的写作规则。同样遵循只校验不生成的原则：它报告硬换行但从不重写，因此不会引入格式化噪音。`doc-sync` 现在包含三道门禁。

## 曾考虑的替代方案

- **API-extractor 基准报告**（[已推迟的提案](../../proposed/process/2026-06-11-api-extractor-reports.md)）：有意推迟。对于评审者已能直接看到源码 diff 的内部 monorepo 而言价值有限，且依赖重、配置繁琐。
- **从源码生成分类体系表**而非仅校验名称：否决，机制比问题本身更重；表格保留了手写的 Mode/Purpose 列，直到[生成式 Cordis 目录](2026-06-20-generated-cordis-catalog.md)完全取代了这项检查。

## 后果

- 可检查类别中的文档漂移会直接使 `doc-sync` 和 CI 失败，而不是等评审人发现。这是「机械门禁优于行文规范」原则的具体应用。
- 让文档代码片段可编译需要少量 stub import/`declare`；`ignore-check` 比例必须保持低位，否则门禁形同虚设（比例守卫强制执行此约束）。
- 分类体系检查仅限名称——Mode 或 Purpose 列的错误仍需人工评审。
- 如果包（package）未来对外发布，API 报告方案仍可重新考虑。
