# Agent Note: 为文件系统 seam 添加直接目录列举能力

Status: implemented
Archived: 2026-07-26

[English](2026-07-03-filesystem-directory-listing-seam.md) | 中文

## 问题

`@deepseek-ai/dsh-fs` 是文件系统访问的提供方 seam，本地后端与未来的非本地后端共享同一个 `ctx.fs` 契约。在本次变更之前，它能解析路径、stat 目标、读取文本、流式读取文本、写入文本和编辑文本。这对面向模型的文件工具已经足够，但对于需要枚举目录而又不想直接导入 `node:fs` 的非模型侧消费方来说还不够。

直接的压力来自 skill（技能）加载：读取单个 `SKILL.md` 已经可以走 `ctx.get('fs')`，但发现哪些 skill 根目录包含 `<name>/SKILL.md` 或 `<name>.md` 仍需要目录枚举。如果仅在 `dsh-skill` 中添加目录列举，要么保留对 Node 的直接依赖，要么在文件系统提供方栈之外发明一个一次性的本地辅助函数。

本决策只添加提供方能力，不涉及面向模型的 `ls`/`list` 工具或 skill 发现机制的变更。那些消费方需要独立的 UX、提示词与策略决策。

## 决策

在 `@deepseek-ai/dsh-fs` 中添加 `FileSystem.listDir(target, signal?)`。

`listDir` 仅列举一层目录。它以稳定的名称顺序返回直接子项，包含以下字段：

- `name`：子项的 basename；
- `type`：`file`、`directory` 或 `other`；
- `target`：已解析的子项 `FsTarget`；
- `version`：可用时返回的轻量元数据；
- `size`：可用时返回的常规文件大小。

它从不读取文件内容。递归遍历、glob 匹配、分页、搜索、文件监听和面向模型的渲染均有意不在范围内。

本地后端通过 `readdir({ withFileTypes: true })`、`resolveLocalTarget` 以及元数据 `stat`/`realpath` 探测来实现。结果顺序是确定性的（`name.localeCompare`），以保持未来消费方的提示词/列表输出稳定，并提高前缀缓存复用率。

损坏或已消失的子项可以表示为 `type: 'other'`（不带 `version`/`size`）；它们不会中止整个列举。在列举目录或解析/探测子项元数据时遇到权限或后端 I/O 故障，则以结构化的 `FsError` 错误码使整个列举失败：

- `FS_NOT_FOUND`：目标不存在；
- `FS_NOT_DIRECTORY`：目标存在但不是目录；
- `FS_PERMISSION_DENIED`：权限不足；
- `FS_IO_ERROR`：其他后端 I/O 故障；
- `FS_ABORTED`：调用被中止。

## 曾考虑的替代方案

**在添加 seam 的同时添加面向模型的 list 工具。** 否决。其提示词、schema 和渲染契约与提供方原语相互独立。

**让每个消费方自行枚举目录。** 否决。这会将 `dsh-skill` 等产品包绑定到 Node/本地文件系统行为上，绕过策略/远程/沙箱后端。

**让 `listDir` 支持递归或 glob 形式。** 暂时否决。skill 根发现只需要直接子项，而简单的单层列举是未来消费方可以安全组合的最小后端契约。

**跳过元数据解析失败的子项。** 否决。API 承诺返回已解析的子项 target，因此解析子项时的权限/IO 故障属于契约失败。损坏或已消失的子项是例外，因为它们仍可在不声称拥有一个活跃已解析文件的前提下被表示。

## 后果

每个文件系统后端现在必须多实现一个提供方原语。这是 harness 尚未发布时有意为之的基础工作，但也意味着未来的沙箱/远程后端需要定义等价的直接子项列举行为。

该能力仍停留在提供方层面。在消费方落地之前，ACP（Agent Client Protocol）/模型会话仍需使用 `bash` 等既有工具来列举目录。缺少面向模型的 `listdir` 工具是预期行为，而非接线错误。
