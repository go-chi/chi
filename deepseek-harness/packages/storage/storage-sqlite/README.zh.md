# @deepseek-ai/dsh-storage-sqlite

[English](README.md) | 中文

[存储中心](../storage/README.md)的 SQLite 后端：注册为后端 `sqlite`，通过一个数据库提供 `kv` facet；该数据库由 `node:sqlite` 操作，可以是单个文件，也可以是 `:memory:`。设计与取舍见[领域 KV 存储 Agent Note](../../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.zh.md)。

## 存储模型

每行一个文档：每个单元表都会成为一个物理 STRICT 表 `"u_<unit>_<table>" (key TEXT PRIMARY KEY, value TEXT)`，其中 `value` 是记录的 JSON 文本，因此一个 key 只更新一行（高频变更领域路由到这里而非 JSON 后端的原因）。单元标识位于两个元数据表中：`units` 在单元首次打开时标记其格式版本，描述符不同时以 `version-mismatch` 拒绝；`unit_globals` 保存每个单元的全局单例行。物理布局版本位于 `PRAGMA user_version`；其他任何标记值都会被拒绝（未发布格式，不迁移）。单元名和表名在进入 DDL 之前依据中心的 `UNIT_NAME_RE` 进行验证，因此不会把外部输入插值到 SQL 标识符中。

每个写入原语都是一条预处理语句：SQLite 的逐语句原子性无需显式事务即可满足 KV 约定，写入顺序仍由调用方负责（领域层写入链）。缺失目录和数据库文件会以仅所有者可访问的权限创建（`0o700`／`0o600`），与会话持久化 SQLite 后端一致。

## 配置（schemastery）

```ts
interface Config {
  path: string   // SQLite database file path, or ':memory:' for an in-process DB
  journalMode?: 'wal' | 'delete' | 'truncate' | 'persist'   // journal_mode pragma; default 'wal'
}
```

## 模型体验

### 已存领域记录

#### 模型看到的内容

无。该后端不贡献提示词、工具或 schema；它在 `ctx.storage` 后面持久化非会话领域数据（工作区记录、未来的会话伴随元数据），只供主机侧消费方使用。

#### Token 影响

实时请求 token 为零。

#### KV Cache 影响

无：该后端从不触碰实时请求前缀。

## 已知限制与暂缓事项

- **`DatabaseSync` 是同步的**：每次写入都会在单条语句执行期间阻塞事件循环；在领域数据规模下可以接受。
- **没有忙等待或重试策略**：另一个连接持有写事务时，该操作会立即被拒绝；没有多进程写入保护。
- **只打开当前的 `STORAGE_SQLITE_SCHEMA_VERSION`**：其他任何已标记版本都会被拒绝而不是迁移（预发布立场）。
- **`openDatabase` 重复了会话持久化 SQLite 的打开顺序**：提取到共享介质层的工作暂缓至计划的会话后端迁移（见 Agent Note 的复用审计）。
