# Agent Note: 工具 schema 是系统提示词组装的一部分

Status: implemented
Archived: 2026-07-27

[English](2026-06-11-tool-schemas-in-prompt-assembly.md) | 中文

## 问题

在协议格式（wire format）层面，工具 schema 通过模型请求中专用的 `tools` 字段传输，而非嵌入提示词文本。然而从架构角度看，「模型被告知它能做什么」是一个统一的关注点：提示词段落与工具列表由相同的插件贡献组装，并在同一时刻被消费。

## 决策

`PromptAssembly { sections, tools }`：系统提示词服务同时收集有序的文本段落和工具 schema（工具注册表自动贡献一个提供方）。agent loop（智能体循环）每个步骤消费一份 assembly；适配器将 `sections` 映射到提供方的 system 槽位，将 `tools` 映射到协议格式的 `tools` 字段。因此 `system-prompt/assemble` waterfall（瀑布式事件）是模型预先获知的所有信息的唯一拦截点：工具过滤（ToolSearch / 渐进式披露）是一次 assembly 重写，与提示词编辑无异。

## 曾考虑的替代方案

**循环从工具注册表和提示词服务分别查询**：将一个统一的关注点拆到两个 seam 上；任何想影响「模型被告知什么」的拦截（工具过滤、plan 模式）都需要在两个接口上各挂一个监听器，而非一次 assembly 重写即可完成。

## 后果

- 一条 waterfall 统管模型的常驻上下文；plan 模式等插件可以在一个监听器中同时替换提示词文本和可见工具。
- assembly 接口通过声明合并实现可扩展（没有无类型的 `extras` 包——扩展即声明合并），为未来的槽位预留空间。
- 将 schema 放在「提示词」服务中略有概念上的意外感，已在本文及包 README 中加以说明。
