# storage/：非会话存储家族

[English](README.md) | 中文

本家族通过具名后端和类型化数据形式，持久化会话事件日志以外的应用数据。

| 包 | 职责 | ctx key |
|---|---|---|
| [`storage/`](storage/README.md) | 将已注册后端与类型化数据形式连接起来 | `ctx.storage` |
| [`storage-json/`](storage-json/README.md) | 在 JSON 文件中存储数据 | 注册后端 `json` |
| [`storage-sqlite/`](storage-sqlite/README.md) | 在 SQLite 中存储数据 | 注册后端 `sqlite` |
| [`storage-domain/`](storage-domain/README.md) | 提供经过验证的领域记录存储 | `ctx.storageDomain` |

消费方使用数据形式，而不是直接访问后端。[领域存储决策](../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md)记录了该家族的设计。

子系统参考——后端约定、`StorageForms`、`DomainSpec`/`Domain`、`domain/changed`——见 [docs/subsystems/storage.md](../../docs/subsystems/storage.md)。
