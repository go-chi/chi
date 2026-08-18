# Agent Note: 将包重组为模块化层级结构

Status: implemented
Archived: 2026-07-27

[English](2026-06-20-package-hierarchy.md) | 中文

[冗余 agent 移除](../simplification/2026-07-20-remove-stdio-and-echo-agents.md)直接删除最初的 `support/ui-stdio` 接口，而不是将其迁移；[仅面向自动化的 ACP 决策](../simplification/2026-07-23-acp-automation-only-protocol.md)把 ACP 放在 `packages/acp/acp` 下，而不是面向人类的 UI 组。这里拥有的决策仍是统一的二层目录深度。

## 问题

`packages/` 原先是扁平的：18 个包（package）全部位于 `packages/<name>/`，从路径上完全看不出一个包属于核心产品 API、可替换的能力 seam、提供方适配器、产品集成，还是示例/测试支撑。包的 README 带着 `FIXME(package-hierarchy)`，`scripts/publint-all.ts` 带着 `TODO(package-inventory)`，标记的正是这个问题。核心包、提供方集成、能力 seam、示例 UI 支撑和仅用于快照的回放支撑看起来同样基础。

这不仅仅是外观问题。由于每个顶层包看起来都属于同一个公开接口，未来移除更加困难，而 publish/lint/doc 脚本不得不通过注释或手工维护的静态列表来编码意图，而不是从布局中直接读取。

## 决策

按模块角色将包分组，统一放在 `packages/<group>/<pkg>/` 深度。分组目录是纯容器（没有 `package.json`）；每个包保留其 `@deepseek-ai/dsh-<pkg>` 名称——这是仓库结构与维护策略的调整，不是包的重命名。

```text
packages/
  core/                  (product API spine)
    session/
    system-prompt/
    tools/
    agent/
    agent-loop/
  llm/                   (product — capability family)
    llm/
    llm-deepseek/
    llm-pi-ai/
  bash/                  (product — capability family)
    bash/
    bash-local/
    tool-bash/
  session-persistence/   (product — capability family)
    session-persistence/
    session-persistence-jsonl/
    session-persistence-sqlite/
  acp/                   (product automation integration)
    acp/
  ui/                    (human interaction and presentation)
  support/               (dev/test/example infrastructure)
    invariants/
    ui-stdio/
    llm-replay/
```

### 放置决策

- **能力族使用同名嵌套。** 一个族的接口包位于 `packages/<group>/<group>/`（`llm/llm`、`bash/bash`、`session-persistence/session-persistence`），实现和消费方作为扁平兄弟并列。不设额外的 `adapters/`/`impls/` 子层——每个包恰好在深度 2，这使 workspace glob 保持简洁的 `packages/*/*`，并让一条 `@deepseek-ai/dsh-*` tsconfig 通配符即可解析所有包（唯一的目录名使 first-on-disk-wins 无歧义）。
- **`session` 留在 `core/`；持久化独立成族。** 会话日志是核心产品 API。其存储后端构成一个平行的能力族（`session-persistence/`），与 `llm/` 和 `bash/` 对称，而非嵌套在 `core/session/` 下。
- **`agent-loop` 在 `core/` 中。** 它是 `agent` seam 唯一的具体实现，但作为 harness 的默认产品循环交付，因此与核心主干同处。插件仍然依赖 `agent` 的词汇，从不依赖 `agent-loop`，所以循环仍可替换。
- **产品自动化与面向人类的 UI 是两个独立分组。** `acp` 是位于 `acp/` 下的产品传输层，而命令、审批、交互和展示适配器位于 `ui/` 下。仅开发用的 invariants 与回放基础设施仍留在 `support/` 中。

### 去重包列表

包列表此前在五个地方重复枚举。统一的深度 2 布局使大部分可以被推导：

- `tsconfig.base.json` 通过一条 `@deepseek-ai/dsh-*` `paths` 通配符（每个分组列一个候选）映射所有包，取代了逐包条目。聚合配置（`tsconfig.host.json`、`tsconfig.client.json`）复用该源映射，并携带显式 project references 以保持包/vendor 类型检查边界完整。（这里引入了一个细节：路径候选中包含 `/*/`，朴素的正则注释剥离器会将其误认为块注释——`scripts/doc-typecheck.ts` 正是因此通过 TypeScript 解析器读取 JSONC 配置，而非手动剥离注释。）
- `scripts/publint-all.ts` 通过读取层级结构（`packages/<group>/<pkg>`）推导列表，解决了 `TODO(package-inventory)`。
- 聚合配置的 project `references` 仍为显式列表——TypeScript project references 没有通配符形式。从 manifest（元数据清单）生成这些引用留作后续工作（见[通过发现机制获取包清单](../../proposed/process/2026-06-20-discover-package-inventory.md)）。

### 新增的护栏

两道 doc-sync/hygiene 门禁确保结构及其引用保持正确，使本次重组所需的手动检查无需日后重复：

- `scripts/verify-package-paths.ts` 标记 Markdown 或 `.ts` 注释/字符串中的 `packages/<path>` 引用，如果该引用无法解析**且**某个路径段命名了一个真实存在的包，即指向已移动包的陈旧路径。如果路径命名的包在任何地方都不存在（前瞻性提案），则不予标记，因此该门禁在 proposed/implemented/rejected 中统一适用。
- `scripts/check-workspace-constraints.ts` 断言 `packages/<group>/<pkg>` 形状：分组目录不带 `package.json`，且没有包扁平地位于根层或嵌套更深。分组名称保持开放——添加新分组无需修改门禁；只有深度 2 的形状是固定的。

## 曾考虑的替代方案

- **第三层（每个族下设 `adapters/`/`impls/`）**：否决。统一深度 2 使 workspace glob 保持简洁的 `packages/*/*`，并让一条 `@deepseek-ai/dsh-*` tsconfig 通配符即可解析所有包。
- **将持久化嵌套在 `core/session/` 下**：否决。存储后端构成一个平行的能力族，与 `llm/` 和 `bash/` 对称，而会话日志本身属于核心产品 API。
- **`ui-stdio` 放在 `ui/` 下**：否决。它曾是与示例耦合的开发支撑，不是产品接口。

## 后果

本次重组在一次协调的变更中搅动了 import、workspace glob、文档链接、构建引用和包路径。这种变动在发布前是可接受的（依据 AGENTS.md 中「基础优先于爆炸半径」的立场），因为它阻止了扁平布局将支撑包固化为产品契约，且这是一次性成本：通配符 `paths`、glob 推导的 publint 列表和形状门禁意味着新增一个包无需额外的结构性编辑。
