# Agent Note: 共享应用 bin 的启动胶水代码，而非维护两份副本

Status: implemented
Archived: 2026-07-26

[English](2026-07-04-share-app-bin-boot-glue.md) | 中文

## 问题

stdio 和 ACP（Agent Client Protocol）两个 bin 各自重复了环境加载、fail-loud 处理、入口校验与启动逻辑，包括微妙的 Loader 失败行为。两份副本已经发生漂移，且位于自执行文件中、被排除在单元测试覆盖率之外，导致其导出的辅助函数无法被复用。

## 决策

辅助函数只存在一处：[`@deepseek-ai/dsh-app-boot`](../../../../packages/ui/app-boot)（`packages/ui/app-boot`，归入 `ui` 分组，因为 bin 是已发布产物，其运行时依赖本身也必须是已发布的包，而非 `support/`）。包含：`resolveConfigPath`（快照感知，两个 bin 共用的唯一路径解析器）、`loadEnv`、`installFailLoud`、`assertEntriesLoaded` 与 `boot`，每个函数都通过 bin 的诊断前缀参数化，并在其副作用 seam（warn sink、process slice）处支持注入，使单元测试套件能覆盖每个分支——包括 `boot()` 在进程内驱动真实 Loader、使用相对路径 specifier 配置的场景，既覆盖已稳定树的正常路径，也覆盖无 fiber 入口的拒绝路径。该包启用逐文件 100% 覆盖率门禁；Loader 失败的相关知识只有一个归属地。

每个 `bin.ts` 都是在共享辅助函数之上加应用特有生命周期的精简自执行组合（ACP bin：重放模式环境变量跳过和 stdin EOF 释放；stdio bin：没有额外逻辑）。这些 bin 仍排除在覆盖率之外且不导出任何内容；已发布产物守卫保持不变——按照“真实入口路径即已发布产物”的防御模式，已构建 bin 冒烟仍在具有 node_modules 形状的临时目录中用纯 node 运行每个 bin（现在也会符号链接 `ui/app-boot`），并继续断言缺失配置时以非零状态退出。[提取示例应用包 Agent Note（agent 决策记录）](../architecture/2026-06-20-extract-example-app-packages.md)中的 bin 归属事实已据此修改。

## 曾考虑的替代方案

### 为何不保留重复？

这些 bin 当时被定位为归属相互独立的已发布产物，而新包会带来固定开销（清单、README、tsconfig 引用、publint 表面），与去重的行数相当。但创建 bin 的 Agent Note 从未权衡应用间共享——它把三份示例 `start.ts` 副本合并进 bin 后便止步于此；漂移是已经观察到的事实；覆盖率缺口的理由也独立于去重理由：这是仓库中唯一免受逐文件 100% 门禁约束的非平凡运行时逻辑。记录的后备方案（只将纯逻辑提取到各应用模块）会结束豁免，但会继续让相关知识拥有两个归属。

## 后果

- 启动胶水代码的变更（新增守卫、修复路径解析）只需落地一次，两个已发布 bin 自动继承；bin 之间不会再次漂移。
- `dsh-app-boot` 保持轻量依赖（cordis + loader/include 对）——它是启动机制，不是应用表面积。
- bin 自身的文件几乎是平凡的组合；所有含分支的逻辑都在覆盖率门禁之下。
