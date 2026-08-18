# @deepseek-ai/dsh-storage-json

[English](README.md) | 中文

[存储中心](../storage/README.md)的 JSON 后端：配置根目录下每个单元使用一个人类可读的 `<unit>.json` 文件，注册为后端 `json`。设计见[领域 KV 存储 Agent Note](../../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.zh.md)。

## 模型

- 内存中的单元状态具有最终决定权；每个写入原语都会通过临时文件写入 + fsync + 原子 `rename()` 替换重新发布整个文件。单元文件始终是完整的当前状态：可读性是该后端存在的理由，规模问题则属于 SQLite 后端。
- 缺失文件会作为空单元打开，并在第一次写入时物化。外来或无法解析的文件以 `malformed-medium` 拒绝；已存版本与描述符不同时以 `version-mismatch` 拒绝（预发布立场，不迁移）。
- 跨调用的写入顺序属于调用方（领域层的写入链）；每次调用都具备原子性，并在完成时已达到持久状态。

## 配置

| Key | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `root` | string | 必填，无默认值（cwd 回退会让文件散落各处） | 保存单元文件的目录；按需以 `0o700` 创建 |

## 模型体验

### 已存领域记录

#### 模型看到的内容

无。该后端不贡献提示词、工具或 schema；它在 `ctx.storage` 后面持久化非会话领域数据，只供宿主侧消费方使用。

#### Token 影响

实时请求 token 为零。

#### KV Cache 影响

无：该后端从不触碰实时请求前缀。

## 已知限制与暂缓事项

- Windows 持久性依赖 libuv 的 `rename()`（调用 `MoveFileExW` 并启用替换），没有显式 write-through 标志；追加日志分面落地时，计划把会话日志后端更严格的 Win32 write-through 发布辅助函数下移到此处（见 Agent Note 的迁移章节）。
- 没有跨进程写锁：两个进程写入同一根目录时，可能交错执行整文件替换（最后写入者胜出）。当前消费方采用单一宿主进程部署；多进程方案按 Agent Note 的范围外事项表暂缓。
