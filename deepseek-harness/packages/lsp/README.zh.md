# lsp/ - LSP 能力家族

[English](README.md) | 中文

语言服务器能力 seam：LSP Service Definition、通用 stdio 提供方，以及面向模型的 `lsp` 工具。这些全是**产品**包。

| 包 | 职责 | ctx key |
|---|---|---|
| `lsp/` | Service Definition（按品牌化 id + 扩展名映射组织的提供方注册表、逐查询选择、词汇、`LspError`） | `ctx.lsp` |
| `lsp-stdio/` | 基于 `ctx.fs` 与 `ctx.subprocess` 的通用多服务器 stdio 后端（JSON-RPC、查询时临时打开文档） | （在 `ctx.lsp` 上注册提供方） |
| `tool-lsp/` | 面向模型的 `lsp` 工具（四种操作、从 1 开始的 UTF-16 光标坐标） | （注册到 `ctx.tools`） |

Service Definition 位于 `lsp/lsp/`。该 seam 恰好公开四种语义操作：`goToDefinition`、`findReferences`、`goToImplementation`、`hover`，且不提供通用 JSON-RPC 逃生口；因此，替换提供方不会改变模型请求导航的方式，也不会让协议载荷或未经评审的修改进入模型约定。提供方注册的是**能力**而非工具；`tool-lsp` 是面向模型的名称、schema、提示词指引和呈现的唯一 owner。

设计原理见 [LSP 能力 seam Agent Note](../../.agents/notes/implemented/architecture/2026-07-15-lsp-capability-seam.md)，其中也解释了文档为何在每次查询时临时打开、stdio 主机为何使用共享的文件系统／子进程执行环境，以及扩展名归属为何在同一运行时内互斥。

子系统参考——操作、坐标、请求／结果、`LspError`——见 [docs/subsystems/lsp.md](../../docs/subsystems/lsp.md)；设计依据见 [LSP 能力 seam Agent Note](../../.agents/notes/implemented/architecture/2026-07-15-lsp-capability-seam.md)。
