# session-query/：会话检索能力家族

[English](README.md) | 中文

本家族提供经过授权的实时与持久会话日志检索，且独立于压缩（compaction）。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`session-query/`](session-query/README.md) | 定义可信读取、关系查询和搜索操作 | `ctx.sessionQuery` |
| [`session-query-sqlite/`](session-query-sqlite/README.md) | 使用 SQLite 全文搜索实现会话查询 | `ctx.sessionQuery` |
| [`session-log-export/`](session-log-export/README.md) | 在 Host ZIP 端点之上增加 Web `/export` 命令、共享浏览器下载状态和结果弹窗 | `ctx.sessionLogDownload` |
| [`tool-session-query/`](tool-session-query/README.md) | 向模型公开经过工作区授权的会话查询 | 注册到 `ctx.tools` |

子系统参考——逻辑记录、有界读取、追踪、筛选器、结果页——见 [docs/subsystems/session-query.md](../../docs/subsystems/session-query.md)。
