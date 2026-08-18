# 事故复盘（postmortem） 0002：文件系统快照工具被永久禁用

[English](0002-js-expression-disabled-filesystem-tools.md) | 中文

状态：已解决

## 摘要

ACP（Agent Client Protocol）示例试图通过 `disabled: !!js ...` 有条件地启用文件系统插件，但 Cordis 仅在插件 `config` 内部对 JavaScript 表达式求值。原始的表达式对象为 truthy，因此文件系统栈始终处于禁用状态。快照刷新随后将 `UNKNOWN_TOOL` 结果接受为新的预期输出。修复方案改用显式的文件系统 overlay，并增加了静态配置守卫和快照结果守卫。

## 概述

默认的 ACP 组合有意只启用 bash，因为其沙箱无法约束进程内的文件系统提供方。文件系统快照场景仍然需要 `read`、`write` 和 `edit`，因此这些插件被放在默认的 `cordis.yml` 中，并附带一个 `disabled` 表达式，意图仅在全权限启动和快照模式下启用它们。

Cordis Include 将每个 `!!js` 标量解析为一个表达式对象。Loader 递归地对插件的 `config` 进行插值，但直接读取 `disabled` 等配置项元数据。因此每个文件系统配置项看到的都是一个 truthy 对象，在所有模式下均保持禁用。

## 影响

七个文件系统场景和一个混合工作区编辑场景调用了注册表中不存在的工具。其结构化会话日志携带 `ToolNotFoundError`（code 为 `UNKNOWN_TOOL`），stdout 渲染出通用的失败工具卡片。快照套件通过了，因为结构化会话日志和 stdout 渲染出的通用失败工具卡片均与刷新后的 fixture（测试前置数据）匹配；它证明的是回归的确定性回放，而非文件系统行为的正确性。

实际运行的受限默认模式并未获得意外的文件系统访问权限。草率地直接修复插值反而会带来这一风险：权限预设在运行时更新 bash 沙箱和审批状态，但无法挂载、卸载或约束文件系统栈。

## 时间线

- PR（Pull Request） #261 整合了 ACP 组合并刷新了文件系统快照，同时引入了条件式文件系统配置项。
- 所有单元测试、覆盖率、快照、文档、构建和 hygiene 检查均通过。
- 对刷新后的文件系统预期输出的评审发现了通用的失败卡片和结构化的 `UNKNOWN_TOOL` 结果。
- 一次真实的 Loader 启动确认：每个 `disabled` 值仍为表达式对象，每个文件系统 fiber 均未创建。

## 根因

实现时假设 `!!js` 适用于整个 Loader 配置项。实际只有 `entry.options.config` 使用它：`Entry._resolveConfig()` 对该字段进行插值，而 `Entry.disabled` 直接测试 `entry.options.disabled`，不经过插值。YAML 标签在语法上合法，因此加载过程不产生任何诊断信息。

快照框架将任何确定性的 transcript（文本记录）视为有效行为。Header pin 验证了组合后的工具 schema，但文件系统场景共享来自默认组合的 pin，因此未独立证明其所需工具已注册。刷新在任何语义断言拒绝缺失工具之前，就已重写了预期的 stdout 和会话日志。

## 已添加的防护措施

- 文件系统场景启动 `fs.cordis.yml`：一个显式的固定全权限 overlay，配有对应的回放配置和独立的 request-header 类。
- [`AGENTS.md`](../../AGENTS.md) 与 [Cordis 入门](../cordis-primer.md#loader-configuration)明确说明 `!!js` 仅在插件 `config` 内有效，条件式组合应使用 overlay。
- `verify-cordis-config` 解析仓库中的 Cordis YAML，拒绝 Loader 配置项元数据中的表达式节点（包括 include patch 和插入的配置项）。
- `dsh-acp-snapshot` 在全新运行和已提交的会话 fixture 中拒绝结构化的 `UNKNOWN_TOOL` 结果，防止其被提交为预期输出。

## 教训

- 语法上被接受的配置值不一定在该位置被求值；应记录并验证具体对哪些字段进行插值。
- 快照刷新是 fixture 的生产过程，不是正确性审查。诸如已注册工具缺失这类语义上不可能的结果，需要独立于预期输出的断言。
- 权限控制只应描述其实际管辖的能力。组合时的文件系统访问无法安全地跟随运行时的 bash-only 预设。
