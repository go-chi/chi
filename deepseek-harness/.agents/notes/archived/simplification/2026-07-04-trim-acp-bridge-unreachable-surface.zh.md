# Agent Note: 裁剪不可达的 ACP 桥接层表面——品牌配置项与 kind 嗅探回退

Status: implemented
Archived: 2026-07-26

[English](2026-07-04-trim-acp-bridge-unreachable-surface.md) | 中文

> 握手标识简化仍然有效。通用卡片回退已随 [ACP 转为仅面向自动化](2026-07-23-acp-automation-only-protocol.md)一并移除；UI 传输层保留提供方无关的展示契约。

## 问题

`dsh-acp` 有两处对外表面在任何已交付的配置中都不可达：

1. **`AcpConfig.agentName` / `agentVersion`**（`packages/acp/acp/src/index.ts`）。已发布应用包只向 bridge 传递其 agent 的提供方/模型目标（`packages/examples/acp-demo/src/index.ts`），因此没有任何叶子 `cordis.yml`——唯一的生产配置表面——能够设置这些配置项；只有直接挂载 bridge 才能设置它们，而这种做法只存在于一个单元测试中。每份快照预期输出——包括钩子矩阵场景——都固定 schema 默认值（`deepseek-harness-acp` / `0.0.1`）。这对配置项还带有一个尚未解决的 `TODO(double-default)`：字面量存在两次（schema `.default(...)` 加 `??` 后备值），TODO 要求为它们选择一个归属。
2. **`toolKindFor` 名称启发式**（同一文件）在通用回退路径中对 `bash*`/`read*`/`write`/`edit*` 工具名做了特殊处理。自[render-intent 联合类型](../architecture/2026-07-02-tool-render-intent-union.md)以来，这些分支匹配到的每个第一方工具都自带 `presentCall` 并携带其 kind，而没有 presenter 的生产工具（`subagent`、`subagent_fork`）本来就落入 `other`。这些分支只有在工具拒绝自行呈现调用时才在生产中可达：`presentCall` 抛出异常（容错回退），或模型参数未通过工具 schema 导致 `defineTool` 的 `presentCall` 包装层返回 `undefined`（例如 `bash` 调用缺少必需的 `description`）。而桥接层自身的模块文档明确声明了该启发式所违反的设计规则："桥接层绝不对工具名做特殊处理"。

## 决策

在初始化时硬编码现有的握手标识 `{ name: 'deepseek-harness-acp', version: '0.0.1' }`，移除不可达的配置字段与重复默认值。最初的实现还在两个 presenter 回退处将 `toolKindFor` 替换为中性的 `'other'`；ACP 不再投影工具卡片，因此该回退已完全离开传输层。初始化测试和快照固定握手标识。

## 曾考虑的替代方案

### 为什么不保留？

品牌配置可以在 app 包将其暴露给部署环境时再回来。从未知工具名推断呈现方式违反了 render-intent 契约；中性回退卡片还能为格式错误的调用和损坏的 presenter 保留原始输入。

## 后果

桥接层不暴露品牌配置项。UI 传输层拥有不做工具名推断的通用展示回退，而 ACP 不承载任何工具卡片表面。
