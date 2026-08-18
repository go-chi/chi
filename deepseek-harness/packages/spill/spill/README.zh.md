# @deepseek-ai/dsh-spill

[English](README.md) | 中文

**`SpillStore`**（`ctx.spillStore`）定义 spill 后端做什么，即持久化某个工具过大的文本，并返回面向模型的定位信息与取回指引；它不规定如何实现。

该包是 spill 能力的三个组成部分之一。拆分后，各项关注点可独立演进和替换：

| 包 | 职责 |
|---|---|
| `@deepseek-ai/dsh-spill`（本包） | Service Definition：抽象服务与词汇类型 |
| `@deepseek-ai/dsh-spill-local` | Service Provider：位于宿主文件系统中的私有会话级文件 |
| `@deepseek-ai/dsh-spill-policy` | Consumer：对过大最终结果执行 spill 的工具结果策略 |

这种拆分方式与 shell/fs seam 相同。未来的远程或虚拟后端（例如 `spill://…` URI、数据库键或后端专用取回工具）可实现此 Service Definition，无需修改策略插件。

## 服务 API（`ctx.spillStore`）

| 成员 | 语义 |
|---|---|
| `saveText(input)` | 逐字保存 `input.content`；成功时返回 `SpillRef`（不透明定位信息、写入的精确字节数和取回指引）。**发生真实存储故障时，调用会以拒绝状态结束**（权限、ENOSPC、后端不可用）；由调用方决定如何降级。 |

存储操作以请求的 `owner` 会话作为保存时命名空间进行分组；后端自行选择私有表示，并可以从调用方的 `suggestedName` 派生名称，但绝不能将其当作可信路径。该 seam 只负责存储：不提供保留策略（由 [`@deepseek-ai/dsh-output-retention`](../../util/output-retention) 负责），不替换工具结果（由 `@deepseek-ai/dsh-spill-policy` 负责），也不提供取回/搜索 API（后端的 `retrievalHint` 会告诉模型如何使用定位信息）。

## 词汇

`SaveTextSpill`（owner、source、suggestedName、content）是请求；`SpillRef`（locator、bytes、retrievalHint）是结果。`SpillLocator` 是[带品牌类型](../../util/brand)的值，并以不透明字符串的形式呈现给模型；对 `dsh-spill-local` 而言它是本地路径，但未来的后端可以返回 URI、键或命令 token，无需修改策略／工具消费方。`SpillOwner.sessionId` 是保存时存储命名空间：fork 后的会话会从种子日志继承现有定位信息，无需复制或更改其归属；fork 后新产生的 spill 使用子会话 id。`SpillSource` 记录产生该 spill 的 `toolName`、`callId` 和 `label`，供后端命名和检查使用，不用于访问控制。完整约定见 `src/types.ts`。

设计原理见[工具输出 spill Agent Note](../../../.agents/notes/implemented/architecture/2026-07-08-tool-output-spill-files.md)，其中说明了为什么创建操作应由运行时 spill seam 而非面向模型的 `write` 工具承担。

## 模型体验

通过渲染后端定位信息和取回指引的 spill 消费方间接影响模型。

#### KV Cache 影响

不会直接导致 KV Cache 失效；请求前缀变更由上述消费方负责。

## 已知限制与暂缓事项

- **该 seam 没有取回或删除 API**：消费方只能渲染后端的定位信息与指引；生命周期和访问语义仍由后端自行决定。
- **存储不等于访问控制**：`SpillOwner` 会区分写入命名空间，但不会授予通过定位信息读取内容的权限；每个后端和取回消费方都必须自行强制执行访问边界。
